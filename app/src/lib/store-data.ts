import { supabase } from "./supabase";

/**
 * Real-data access for the Store screens: `public.products` and friends.
 *
 * Note this is a different `products` table than `herd.products` — the
 * public one is storefront goods (raw milk, eggs), the herd one is
 * veterinary drugs (withdrawal days, is_prescription). Same name, entirely
 * different things, and that's intentional per the farm's schema.
 */

export interface RealProduct {
  id: number;
  name: string;
  unit: string;
  price: number | null;
}

export interface RealBatch {
  id: number;
  product_id: number;
  produced_date: string;
  quantity: number;
  reserved: number;
  herd_animal_id: string | null;
}

export interface RealDiscard {
  id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  reason: string;
  batch_produced_date: string | null;
}

export interface RealProductionRecord {
  id: string;
  animal_id: string;
  product_id: number;
  product_name: string;
  quantity: number;
  unit: string;
  produced_date: string;
  batch_id: number | null;
}

/** A product with its inventory position derived from batches. The mockup's
 * four columns map onto the schema like this:
 *   on hand      = sum(batch.quantity)
 *   claimed      = sum(batch.reserved)
 *   open to shop = on hand - claimed
 *   held weekly  = needs public.schedules, which is empty — left null.
 */
export interface ProductWithInventory extends RealProduct {
  onHand: number;
  claimed: number;
  openToShop: number;
  batches: RealBatch[];
}

export interface StoreData {
  products: ProductWithInventory[];
  discards: RealDiscard[];
  production: RealProductionRecord[];
}

export async function fetchStoreData(): Promise<StoreData> {
  const [productsRes, batchesRes, discardsRes, productionRes] = await Promise.all([
    supabase.from("products").select("id, name, unit, price").order("name"),
    supabase.from("inventory_batches").select("id, product_id, produced_date, quantity, reserved, herd_animal_id"),
    supabase.from("discards").select("id, product_id, product_name, quantity, reason, batch_produced_date"),
    supabase
      .schema("herd")
      .from("production_records")
      .select("id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id"),
  ]);

  for (const [label, res] of [
    ["products", productsRes],
    ["inventory_batches", batchesRes],
    ["discards", discardsRes],
    ["herd.production_records", productionRes],
  ] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  const batches = (batchesRes.data ?? []) as RealBatch[];

  const products: ProductWithInventory[] = ((productsRes.data ?? []) as RealProduct[]).map((p) => {
    const mine = batches.filter((b) => b.product_id === p.id);
    const onHand = round3(mine.reduce((s, b) => s + Number(b.quantity), 0));
    const claimed = round3(mine.reduce((s, b) => s + Number(b.reserved), 0));
    return {
      ...p,
      onHand,
      claimed,
      openToShop: round3(onHand - claimed),
      batches: mine.sort((a, b) => b.produced_date.localeCompare(a.produced_date)),
    };
  });

  return {
    products,
    discards: (discardsRes.data ?? []) as RealDiscard[],
    production: (productionRes.data ?? []) as RealProductionRecord[],
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Insert a new inventory batch. Chosen as the first real write in the app
 * because it's the least entangled one available: public.inventory_batches
 * has no farm_id, no created_by/rev audit columns, and no soft-delete — so
 * if this fails, the cause is write permissions rather than a malformed
 * audit payload.
 *
 * `reserved` is NOT NULL in the schema, so it's always sent explicitly.
 */
export async function addInventoryBatch(input: {
  productId: number;
  producedDate: string;
  quantity: number;
  herdAnimalId?: string | null;
}): Promise<RealBatch> {
  const { data, error } = await supabase
    .from("inventory_batches")
    .insert({
      product_id: input.productId,
      produced_date: input.producedDate,
      quantity: input.quantity,
      reserved: 0,
      herd_animal_id: input.herdAnimalId ?? null,
    })
    .select("id, product_id, produced_date, quantity, reserved, herd_animal_id")
    .single();

  if (error) throw new Error(error.message);
  return data as RealBatch;
}

/** "$8.00 / gallon", or just the unit when the product has no price set. */
export function formatUnitPrice(p: RealProduct): string {
  if (p.price === null || p.price === undefined) return `— / ${p.unit}`;
  return `$${Number(p.price).toFixed(2)} / ${p.unit}`;
}
