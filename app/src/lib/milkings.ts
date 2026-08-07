import { supabase, herdSchema } from "./supabase";
import type { RealLactation } from "./lactations";

/**
 * Recording a milking, and the two things it feeds.
 *
 * A milking is a row in herd.production_records: which cow, which product,
 * how much, what day. From there:
 *
 *   → the store, through inventory_batches. Milkings for one product on one
 *     day pool into a single batch, which is what the shop actually sells.
 *     production_records.batch_id points at it.
 *
 *   → lactations, by date window. There is no lactation_id on a production
 *     record; milk belongs to whichever lactation covers that cow on that
 *     date. Derived rather than stored, so correcting a fresh date corrects
 *     the history with it.
 *
 * Milk can also reach inventory without any milking behind it — the Store
 * screen writes a batch directly. Those batches are real stock and must not
 * be treated as an error, but they can't be attributed to a cow. See
 * `unattributedBatches`.
 */

export interface RealProductionRecord {
  id: string;
  animal_id: string;
  product_id: number;
  product_name: string;
  quantity: number;
  unit: string;
  produced_date: string;
  batch_id: number | null;
  note: string;
}

export const PRODUCTION_COLUMNS =
  "id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id, note";

/** One cow's share of a milking. */
export interface MilkingEntry {
  animalId: string;
  /** Blank means "not milked" rather than zero — see `enteredEntries`. */
  quantity: string;
}

// ─── pure logic ────────────────────────────────────────────────────────

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The entries a person actually filled in. A blank box means that cow
 * wasn't milked, which is different from milking her and getting nothing —
 * storing a 0.000 row for every dry cow every day would bury the real data.
 */
export function enteredEntries(entries: MilkingEntry[]): { animalId: string; quantity: number }[] {
  return entries
    .filter((e) => e.quantity.trim() !== "")
    .map((e) => ({ animalId: e.animalId, quantity: Number(e.quantity) }));
}

export function totalOf(entries: MilkingEntry[]): number {
  return round3(enteredEntries(entries).reduce((s, e) => s + (Number.isFinite(e.quantity) ? e.quantity : 0), 0));
}

/** A reason the milking can't be saved, or null. */
export function validateMilkings(entries: MilkingEntry[], todayIso: string, producedDate: string): string | null {
  if (!producedDate) return "A date is required.";
  if (producedDate > todayIso) return "Can't record a milking in the future.";

  const filled = entries.filter((e) => e.quantity.trim() !== "");
  if (filled.length === 0) return "Enter a quantity for at least one animal.";

  for (const e of filled) {
    const n = Number(e.quantity);
    if (!Number.isFinite(n)) return "Quantities must be numbers.";
    if (n < 0) return "A quantity can't be negative.";
  }
  return null;
}

/**
 * Milk recorded against a lactation: same cow, and produced between
 * freshening and dry-off. The dry-off day itself counts — she was milked
 * that morning.
 */
export function milkForLactation(lactation: RealLactation, records: RealProductionRecord[]): number {
  return round3(
    records
      .filter(
        (r) =>
          r.animal_id === lactation.animal_id &&
          r.produced_date >= lactation.fresh_date &&
          (lactation.dry_off_date === null || r.produced_date <= lactation.dry_off_date),
      )
      .reduce((s, r) => s + Number(r.quantity), 0),
  );
}

/**
 * The best single day of a lactation, and how many days in it fell.
 * Days are summed first: two milkings on one day are one day's yield, and
 * taking the max record rather than the max day would under-report a herd
 * milked twice.
 */
export function peakOf(
  lactation: RealLactation,
  records: RealProductionRecord[],
): { quantity: number; dim: number } | null {
  const byDay = new Map<string, number>();
  for (const r of records) {
    if (r.animal_id !== lactation.animal_id) continue;
    if (r.produced_date < lactation.fresh_date) continue;
    if (lactation.dry_off_date !== null && r.produced_date > lactation.dry_off_date) continue;
    byDay.set(r.produced_date, (byDay.get(r.produced_date) ?? 0) + Number(r.quantity));
  }
  if (byDay.size === 0) return null;

  let best: { date: string; quantity: number } | null = null;
  for (const [date, quantity] of byDay) {
    if (!best || quantity > best.quantity || (quantity === best.quantity && date < best.date)) {
      best = { date, quantity };
    }
  }
  const dim = Math.round(
    (Date.parse(`${best!.date}T00:00:00Z`) - Date.parse(`${lactation.fresh_date}T00:00:00Z`)) / 86_400_000,
  );
  return { quantity: round3(best!.quantity), dim };
}

/** Milk with no lactation covering it — recorded against a cow who has no
 *  lactation open on that date, so it counts for the store but for no
 *  lactation total. Worth showing rather than silently dropping. */
export function unattributedMilk(records: RealProductionRecord[], lactations: RealLactation[]): RealProductionRecord[] {
  return records.filter(
    (r) =>
      !lactations.some(
        (l) =>
          l.animal_id === r.animal_id &&
          r.produced_date >= l.fresh_date &&
          (l.dry_off_date === null || r.produced_date <= l.dry_off_date),
      ),
  );
}

/**
 * Production totalled per animal.
 *
 * The Store screen used to render one cell per production record, which is
 * unbounded — two cows milked daily is well over a thousand cells in a
 * year, all-time, with no way to read "how much has she given". Grouping by
 * animal bounds it to the size of the herd and answers the question the
 * section is actually asking.
 *
 * `days` counts distinct dates rather than records, so a cow milked twice
 * on one day counts as one day.
 */
export interface AnimalProduction {
  animalId: string;
  total: number;
  days: number;
  first: string;
  last: string;
}

export function byAnimal(
  // Structural rather than RealProductionRecord: store-data.ts declares its
  // own production record type without `note`, and this only ever reads
  // three fields. Taking the minimum lets both callers pass theirs.
  records: { animal_id: string; quantity: number; produced_date: string }[],
): AnimalProduction[] {
  const acc = new Map<string, { total: number; dates: Set<string> }>();

  for (const r of records) {
    const entry = acc.get(r.animal_id) ?? { total: 0, dates: new Set<string>() };
    entry.total += Number(r.quantity);
    entry.dates.add(r.produced_date);
    acc.set(r.animal_id, entry);
  }

  return [...acc]
    .map(([animalId, { total, dates }]) => {
      const sorted = [...dates].sort();
      return {
        animalId,
        total: round3(total),
        days: dates.size,
        first: sorted[0],
        last: sorted[sorted.length - 1],
      };
    })
    // Heaviest producer first — that's what the section is read for.
    .sort((a, b) => b.total - a.total || a.animalId.localeCompare(b.animalId));
}

/** Batches with no milking behind them — stock added straight from the
 *  Store screen. Real inventory, just not traceable to an animal. */
export function unattributedBatches(
  batches: { id: number; product_id: number; produced_date: string; quantity: number }[],
  records: RealProductionRecord[],
): typeof batches {
  const claimed = new Set(records.map((r) => r.batch_id).filter((id): id is number => id !== null));
  return batches.filter((b) => !claimed.has(b.id));
}

/**
 * The product a milking produces. Chosen by type_code, with a name match
 * as a fallback for before migration 008 — the same rule the dashboard
 * uses, so the two can't disagree about what counts as milk.
 *
 * Returns null rather than guessing when the business sells no milk: a
 * hardcoded product id would write eggs against a cow on any farm whose
 * ids happen to differ.
 */
export interface MilkProduct {
  id: number;
  name: string;
  unit: string;
}

export function findMilkProduct(
  products: { id: number; name: string; unit: string; type_code?: string | null }[],
): MilkProduct | null {
  const typed = products.find((p) => p.type_code === "milk");
  const chosen = typed ?? products.find((p) => /\bmilk\b/i.test(p.name)) ?? null;
  return chosen ? { id: chosen.id, name: chosen.name, unit: chosen.unit } : null;
}

// ─── access ────────────────────────────────────────────────────────────

/** Products for a business, enough to find the milk one. Retries without
 *  type_code for before migration 008, matching lib/dashboard-data.ts. */
export async function fetchMilkProduct(businessId: number): Promise<MilkProduct | null> {
  const withType = await supabase
    .from("products")
    .select("id, name, unit, type_code")
    .eq("business_id", businessId)
    .order("id");

  if (!withType.error) {
    return findMilkProduct((withType.data ?? []) as Parameters<typeof findMilkProduct>[0]);
  }
  if (!/type_code|column|schema cache/i.test(withType.error.message)) {
    throw new Error(`products: ${withType.error.message}`);
  }

  const without = await supabase.from("products").select("id, name, unit").eq("business_id", businessId).order("id");
  if (without.error) throw new Error(`products: ${without.error.message}`);
  return findMilkProduct((without.data ?? []) as Parameters<typeof findMilkProduct>[0]);
}

export async function fetchProductionRecords(farmId: string): Promise<RealProductionRecord[]> {
  const { data, error } = await herdSchema()
    .from("production_records")
    .select(PRODUCTION_COLUMNS)
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("produced_date", { ascending: false });

  if (error) throw new Error(`herd.production_records: ${error.message}`);
  return (data ?? []) as RealProductionRecord[];
}

/**
 * Write a day's milkings and put the milk into inventory.
 *
 * The batch is found through the milkings already recorded for that product
 * and day, not by searching inventory_batches for a matching date. Two
 * batches can share a product and date — 15 and 16 already do — and picking
 * one of them by guesswork would add milk to a batch nobody attributed.
 * Following batch_id means we only ever touch a batch this flow created.
 *
 * Quantity is added to, never recomputed. A batch's quantity can include
 * stock entered by hand on the Store screen, and recomputing it from
 * milkings would silently delete that.
 */
export async function recordMilkings(input: {
  farmId: string;
  businessId: number;
  productId: number;
  productName: string;
  unit: string;
  producedDate: string;
  entries: { animalId: string; quantity: number }[];
  note?: string;
}): Promise<{ records: RealProductionRecord[]; batchId: number; batchQuantity: number }> {
  const { farmId, businessId, productId, producedDate } = input;
  const added = round3(input.entries.reduce((s, e) => s + e.quantity, 0));

  // An existing batch for this product and day, reached through the
  // milkings that already point at it.
  const prior = await herdSchema()
    .from("production_records")
    .select("batch_id")
    .eq("farm_id", farmId)
    .eq("product_id", productId)
    .eq("produced_date", producedDate)
    .not("batch_id", "is", null)
    .is("deleted_at", null)
    .limit(1);

  if (prior.error) throw new Error(`herd.production_records: ${prior.error.message}`);
  const existingId = (prior.data?.[0] as { batch_id: number } | undefined)?.batch_id ?? null;

  let batchId: number;
  let batchQuantity: number;

  if (existingId !== null) {
    const current = await supabase
      .from("inventory_batches")
      .select("id, quantity")
      .eq("id", existingId)
      .maybeSingle();
    if (current.error) throw new Error(`inventory_batches: ${current.error.message}`);

    const before = Number((current.data as { quantity: number } | null)?.quantity ?? 0);
    const updated = await supabase
      .from("inventory_batches")
      .update({ quantity: round3(before + added) })
      .eq("id", existingId)
      .select("id, quantity")
      .single();
    if (updated.error) throw new Error(`inventory_batches: ${updated.error.message}`);

    batchId = (updated.data as { id: number }).id;
    batchQuantity = Number((updated.data as { quantity: number }).quantity);
  } else {
    // business_id is required: migration 010's insert policy is
    // `with check (is_business_member(business_id))`, and
    // is_business_member(null) is false, so omitting it fails outright.
    const created = await supabase
      .from("inventory_batches")
      .insert({
        business_id: businessId,
        product_id: productId,
        produced_date: producedDate,
        quantity: added,
        reserved: 0,
      })
      .select("id, quantity")
      .single();
    if (created.error) throw new Error(`inventory_batches: ${created.error.message}`);

    batchId = (created.data as { id: number }).id;
    batchQuantity = Number((created.data as { quantity: number }).quantity);
  }

  // created_at/created_by/rev come from the herd.touch_row trigger.
  const rows = input.entries.map((e) => ({
    farm_id: farmId,
    animal_id: e.animalId,
    product_id: productId,
    product_name: input.productName,
    quantity: e.quantity,
    unit: input.unit,
    produced_date: producedDate,
    batch_id: batchId,
    note: input.note ?? "",
  }));

  const inserted = await herdSchema().from("production_records").insert(rows).select(PRODUCTION_COLUMNS);
  if (inserted.error) {
    // The batch was already moved. Say so rather than leaving the person to
    // discover inventory that no milking accounts for.
    throw new Error(
      `${inserted.error.message} — inventory batch ${batchId} was already updated to ${batchQuantity}; ` +
        `re-check the store before re-entering.`,
    );
  }

  return { records: (inserted.data ?? []) as RealProductionRecord[], batchId, batchQuantity };
}
