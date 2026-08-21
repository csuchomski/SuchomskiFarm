import { supabase } from "./supabase";
import { localDay } from "./local-time";

/**
 * A cow's milk, day by day, and what became of it.
 *
 * `production_records` says what she gave; it does not say what happened to
 * it afterwards. Three tables between them do:
 *
 * - the record carries `batch_id`, and a batch still in `inventory_batches`
 *   is milk **on hand** — `complete_pickup` deletes a batch once it is drawn
 *   down to nothing;
 * - `discards` carries the produced date of the batch it threw away, so a
 *   discard on that date for that product is milk **binned**;
 * - anything else is milk that left as an order — **sold**.
 *
 * **Value is an estimate, and says so.** A pickup attributes money to the
 * animals that supplied it across a date *range*, not per day, so no exact
 * per-day figure exists to show. This values a day at the milk product's
 * current price, which is right for what is on hand and approximate for what
 * was sold last month at a price that may since have changed. What she has
 * actually earned is on the money section, which reads the attribution rather
 * than guessing at it.
 *
 * **Every day in the window is returned, milked or not.** A cow milked on 12
 * of 30 days should show 18 gaps in her chart rather than 12 bars squeezed
 * together as if they were consecutive — the gaps are the fact.
 */

export type MilkStatus = "sold" | "inventory" | "discarded";

export interface MilkDay {
  key: string;
  /** Local ISO day. */
  date: string;
  gallons: number;
  /** False for a day with no milking on file: a gap, not a zero. */
  recorded: boolean;
  status: MilkStatus;
  /** What it earned, at the product's current price. Zero for a day that was
   *  thrown away — binned milk earns nothing. */
  valueCents: number;
  /** What a binned day would have fetched. Zero on every other day. Kept
   *  apart from `valueCents` so a discard can never be added into takings by
   *  a caller that forgets to check the status. */
  lostCents: number;
}

export interface MilkSummary {
  gallons: number;
  days: number;
  soldCents: number;
  onHandGallons: number;
  onHandCents: number;
  discardedGallons: number;
  discardedCents: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The day `back` days before `iso`, by calendar arithmetic rather than by
 *  adding milliseconds — a day is not always 86,400,000 ms of local time. */
export function dayBefore(iso: string, back: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const at = new Date(y, m - 1, d - back);
  return localDay(at.toISOString());
}

export function buildMilkDays(input: {
  records: { produced_date: string; quantity: number; batch_id: number | null }[];
  /** Batch ids still in `inventory_batches` — what is on hand. */
  liveBatchIds: Set<number>;
  /** Produced dates a discard was recorded against, for the milk product. */
  discardedDates: Set<string>;
  priceCents: number;
  days: number;
  today: string;
}): MilkDay[] {
  const from = dayBefore(input.today, input.days - 1);

  const byDate = new Map<string, { gallons: number; live: boolean }>();
  for (const r of input.records) {
    const date = r.produced_date.slice(0, 10);
    if (date < from || date > input.today) continue;
    const entry = byDate.get(date) ?? { gallons: 0, live: false };
    entry.gallons += Number(r.quantity);
    if (r.batch_id !== null && input.liveBatchIds.has(r.batch_id)) entry.live = true;
    byDate.set(date, entry);
  }

  const out: MilkDay[] = [];
  for (let i = input.days - 1; i >= 0; i--) {
    const date = dayBefore(input.today, i);
    const entry = byDate.get(date);
    if (!entry) {
      out.push({ key: date, date, gallons: 0, recorded: false, status: "sold", valueCents: 0, lostCents: 0 });
      continue;
    }
    const gallons = round1(entry.gallons);
    // Binned beats on-hand: a day partly thrown away is the day you want to
    // see marked, and the remainder is still counted in what she gave.
    const status: MilkStatus = input.discardedDates.has(date)
      ? "discarded"
      : entry.live
        ? "inventory"
        : "sold";
    out.push({
      key: date,
      date,
      gallons,
      recorded: true,
      status,
      valueCents: status === "discarded" ? 0 : Math.round(gallons * input.priceCents),
      lostCents: status === "discarded" ? Math.round(gallons * input.priceCents) : 0,
    });
  }
  return out;
}

export function summariseMilk(days: MilkDay[]): MilkSummary {
  const on = days.filter((d) => d.recorded);
  const withStatus = (status: MilkStatus) => on.filter((d) => d.status === status);
  const gallonsOf = (rows: MilkDay[]) => round1(rows.reduce((s, d) => s + d.gallons, 0));
  const centsOf = (rows: MilkDay[]) => rows.reduce((s, d) => s + d.valueCents, 0);
  const binned = withStatus("discarded");
  const held = withStatus("inventory");

  return {
    gallons: gallonsOf(on),
    days: on.length,
    soldCents: centsOf(withStatus("sold")),
    onHandGallons: gallonsOf(held),
    onHandCents: centsOf(held),
    discardedGallons: gallonsOf(binned),
    // What the binned milk would have fetched — worth knowing precisely
    // because it earned nothing.
    discardedCents: binned.reduce((s, d) => s + d.lostCents, 0),
  };
}

// ─── access ────────────────────────────────────────────────────────────

export interface MilkContext {
  priceCents: number;
  productId: number | null;
  liveBatchIds: Set<number>;
  discardedDates: Set<string>;
}

/**
 * The three reads that turn production records into a day's worth of story.
 *
 * A missing milk product is not an error — a farm that sells no milk still
 * has cows, and the section simply values her days at nothing rather than
 * refusing to draw.
 */
export async function fetchMilkContext(businessId: number): Promise<MilkContext> {
  const products = await supabase
    .from("products")
    .select("id, name, price, type_code")
    .eq("business_id", businessId);
  if (products.error) throw new Error(`products: ${products.error.message}`);

  const rows = (products.data ?? []) as { id: number; name: string; price: number | null; type_code: string | null }[];
  const milk = rows.find((p) => p.type_code === "milk") ?? rows.find((p) => /\bmilk\b/i.test(p.name)) ?? null;

  if (!milk) return { priceCents: 0, productId: null, liveBatchIds: new Set(), discardedDates: new Set() };

  const [batches, discards] = await Promise.all([
    supabase.from("inventory_batches").select("id").eq("product_id", milk.id).eq("business_id", businessId),
    supabase
      .from("discards")
      .select("batch_produced_date")
      .eq("product_id", milk.id)
      .eq("business_id", businessId),
  ]);
  if (batches.error) throw new Error(`inventory_batches: ${batches.error.message}`);
  if (discards.error) throw new Error(`discards: ${discards.error.message}`);

  return {
    priceCents: Math.round(Number(milk.price ?? 0) * 100),
    productId: milk.id,
    liveBatchIds: new Set(((batches.data ?? []) as { id: number }[]).map((b) => b.id)),
    discardedDates: new Set(
      ((discards.data ?? []) as { batch_produced_date: string | null }[])
        .map((d) => d.batch_produced_date)
        .filter((d): d is string => d !== null)
        .map((d) => d.slice(0, 10)),
    ),
  };
}
