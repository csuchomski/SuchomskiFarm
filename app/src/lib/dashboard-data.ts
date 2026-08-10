import { supabase } from "./supabase";
import { summarise, typeMap, FALLBACK_TYPES, type RealTransaction, type TransactionType } from "./books-data";
import { herdOnly, type RealAnimal } from "./herd";

/**
 * Everything the Today screen needs, in one round trip's worth of parallel
 * queries.
 *
 * Some of the mockup's figures aren't here at all. "Cows in milk" needs
 * herd.lactations, which has no rows, so the screen shows total head
 * instead of a number that would look precise and mean nothing. A dashboard
 * that quietly invents its headline figure is worse than one that admits a
 * gap.
 */

export interface ProfitPerHead {
  animal: RealAnimal;
  costCents: number;
  revenueCents: number;
  netCents: number;
}

export interface DashboardData {
  today: string;
  animals: RealAnimal[];
  milkTodayQuantity: number;
  milkTodayUnit: string | null;
  batchesToday: number;
  claimed: number;
  openToShop: number;
  openOrders: number;
  monthIncome: number;
  monthExpenses: number;
  monthNet: number;
  monthEntries: number;
  transactionsToday: RealTransaction[];
  profitPerHead: ProfitPerHead[];
  hasCostData: boolean;
  /** True when products have no type_code yet and milk is being identified
   * by name — see migration 008. */
  milkIdentifiedByName: boolean;
}

/** Fallback only, for before migration 008 adds products.type_code. Matching
 * a product by its name is wrong in both directions — "Milk soap" counts as
 * production, "Raw Jersey" doesn't — which is why the column exists. */
const MILK_NAME_FALLBACK = /\bmilk\b/i;

interface ProductRow {
  id: number;
  name: string;
  unit: string;
  type_code?: string | null;
}

function milkProductIdsFrom(products: ProductRow[]): { ids: Set<number>; usedFallback: boolean } {
  const typed = products.filter((p) => p.type_code != null);
  if (typed.length > 0) {
    return { ids: new Set(typed.filter((p) => p.type_code === "milk").map((p) => p.id)), usedFallback: false };
  }
  return { ids: new Set(products.filter((p) => MILK_NAME_FALLBACK.test(p.name)).map((p) => p.id)), usedFallback: true };
}

/**
 * Selecting a column that doesn't exist is an error, not a null, so this
 * asks for type_code and retries without it when migration 008 hasn't run.
 * One wasted round trip in the un-migrated case, and none afterwards.
 */
async function fetchProducts(businessId: number): Promise<ProductRow[]> {
  const withType = await supabase
    .from("products")
    .select("id, name, unit, price, type_code")
    .eq("business_id", businessId);
  if (!withType.error) return (withType.data ?? []) as ProductRow[];

  if (!/type_code|column|schema cache/i.test(withType.error.message)) {
    throw new Error(`products: ${withType.error.message}`);
  }

  const without = await supabase.from("products").select("id, name, unit, price").eq("business_id", businessId);
  if (without.error) throw new Error(`products: ${without.error.message}`);
  return (without.data ?? []) as ProductRow[];
}

/**
 * Which business's Today this is. Herd records hang off a farm, the ledger
 * hangs off a business, and the two ids are not interchangeable — see
 * docs/books-herd-link.md.
 */
export interface DashboardScope {
  businessId: number;
  farmId: string | null;
}

/** Stands in for a query that wasn't worth running. A business with no farm
 * has no herd rows by definition, so asking is a round trip to learn nothing. */
const NO_ROWS = { data: [] as never[], error: null } as const;

export async function fetchDashboardData(todayIso: string, scope: DashboardScope): Promise<DashboardData> {
  const monthStart = `${todayIso.slice(0, 7)}-01`;
  const { businessId, farmId } = scope;

  const [animalsRes, productionRes, batchesRes, productsRes, ordersRes, txnRes, typesRes, costRes, revenueRes] =
    await Promise.all([
      farmId
        ? supabase
            .schema("herd")
            .from("animals")
            // record_type is here to be filtered on, not shown: without it
            // the catalogue AI bulls count as head and sit in the profit
            // ranking below, where they can never earn anything.
            .select("id, ear_tag, barn_name, sex, class, status, birth_date, record_type")
            .eq("farm_id", farmId)
            .is("deleted_at", null)
            .order("barn_name")
        : Promise.resolve(NO_ROWS),
      farmId
        ? supabase
            .schema("herd")
            .from("production_records")
            .select("id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id")
            .eq("farm_id", farmId)
            .eq("produced_date", todayIso)
            .is("deleted_at", null)
        : Promise.resolve(NO_ROWS),
      // Scoped since migration 010 put business_id on all three.
      supabase
        .from("inventory_batches")
        .select("id, product_id, produced_date, quantity, reserved")
        .eq("business_id", businessId),
      fetchProducts(businessId),
      supabase.from("orders").select("id, status, picked_up_date, cancelled_date").eq("business_id", businessId),
      supabase
        .from("ledger_transactions")
        .select("id, business_id, date, type, category, amount, note, payer, account")
        .eq("business_id", businessId)
        .gte("date", monthStart)
        .lte("date", todayIso),
      supabase.from("transaction_types").select("code, label, direction, active, sort_order"),
      farmId
        ? supabase
            .schema("herd")
            .from("cost_entries")
            .select("animal_id, amount_cents")
            .eq("farm_id", farmId)
            .is("deleted_at", null)
        : Promise.resolve(NO_ROWS),
      farmId
        ? supabase
            .schema("herd")
            .from("revenue_entries")
            .select("animal_id, amount_cents")
            .eq("farm_id", farmId)
            .is("deleted_at", null)
        : Promise.resolve(NO_ROWS),
    ]);

  // productsRes is already unwrapped — fetchProducts() throws on failure
  // rather than returning a result object, because it has its own retry.
  for (const [label, res] of [
    ["herd.animals", animalsRes],
    ["herd.production_records", productionRes],
    ["inventory_batches", batchesRes],
    ["orders", ordersRes],
    ["ledger_transactions", txnRes],
    ["herd.cost_entries", costRes],
    ["herd.revenue_entries", revenueRes],
  ] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  // Livestock only. A straw bought from an AI stud is a cost against the cow
  // it was used on, never revenue against the bull, so a catalogue bull can
  // only ever sit at the bottom of "profit per head" at zero — and "Head"
  // counted him as an animal the farm owns.
  const animals = herdOnly((animalsRes.data ?? []) as RealAnimal[]);
  const production = (productionRes.data ?? []) as { product_id: number; quantity: number; unit: string }[];
  const batches = (batchesRes.data ?? []) as { product_id: number; produced_date: string; quantity: number; reserved: number }[];
  const products = productsRes;
  const orders = (ordersRes.data ?? []) as { status: string; picked_up_date: string | null; cancelled_date: string | null }[];
  const transactions = (txnRes.data ?? []) as RealTransaction[];

  const types: TransactionType[] = typesRes.error ? FALLBACK_TYPES : ((typesRes.data ?? []) as TransactionType[]);
  const monthTotals = summarise(transactions, typeMap(types));

  const { ids: milkProductIds, usedFallback: milkByName } = milkProductIdsFrom(products);
  const milkProduction = production.filter((r) => milkProductIds.has(r.product_id));
  const milkTodayQuantity = round3(milkProduction.reduce((s, r) => s + Number(r.quantity), 0));
  const milkTodayUnit = milkProduction[0]?.unit ?? products.find((p) => milkProductIds.has(p.id))?.unit ?? null;

  const milkBatches = batches.filter((b) => milkProductIds.has(b.product_id));
  const claimed = round3(milkBatches.reduce((s, b) => s + Number(b.reserved), 0));
  const onHand = round3(milkBatches.reduce((s, b) => s + Number(b.quantity), 0));

  const costByAnimal = tally((costRes.data ?? []) as { animal_id: string; amount_cents: number }[]);
  const revenueByAnimal = tally((revenueRes.data ?? []) as { animal_id: string; amount_cents: number }[]);

  const profitPerHead: ProfitPerHead[] = animals
    .map((animal) => {
      const costCents = costByAnimal.get(animal.id) ?? 0;
      const revenueCents = revenueByAnimal.get(animal.id) ?? 0;
      return { animal, costCents, revenueCents, netCents: revenueCents - costCents };
    })
    .sort((a, b) => b.netCents - a.netCents);

  return {
    today: todayIso,
    animals,
    milkTodayQuantity,
    milkTodayUnit,
    batchesToday: batches.filter((b) => b.produced_date === todayIso).length,
    claimed,
    openToShop: round3(onHand - claimed),
    openOrders: orders.filter((o) => !o.picked_up_date && !o.cancelled_date).length,
    monthIncome: monthTotals.income,
    monthExpenses: monthTotals.expenses,
    monthNet: monthTotals.net,
    monthEntries: transactions.length,
    transactionsToday: transactions.filter((t) => t.date === todayIso),
    profitPerHead,
    hasCostData: costByAnimal.size > 0 || revenueByAnimal.size > 0,
    milkIdentifiedByName: milkByName,
  };
}

function tally(rows: { animal_id: string; amount_cents: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.animal_id) continue;
    out.set(r.animal_id, (out.get(r.animal_id) ?? 0) + Number(r.amount_cents));
  }
  return out;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

