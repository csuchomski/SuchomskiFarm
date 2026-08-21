import { supabase } from "./supabase";
import { localDay } from "./local-time";

/**
 * A cow's milk, day by day, and what became of it.
 *
 * `production_records` says what she gave. What happened to it afterwards is
 * spread across three more tables, and the first version of this file read
 * them too coarsely — a batch still in `inventory_batches` was called "in
 * inventory", full stop. That is wrong the moment a day is *partly* sold,
 * which is the normal case: on 4 Aug this farm pooled 7 gallons, sold 1 of
 * them on the 7th, and still shows a live batch holding the other 6.
 *
 * So a day is a set of quantities rather than a state:
 *
 * - **produced** — every cow's contribution, from `production_records`. Milk
 *   here is *pooled*: `record_production` writes one batch for the day and
 *   several records against it, so the tank is what got sold, not her pail.
 * - **on hand** — what the day's batches still hold, of which **promised**
 *   is already reserved against an open order.
 * - **binned** — `discards` carrying that produced date. A discard with no
 *   produced date on it can't be pinned to a day and is left out rather than
 *   charged to an arbitrary one.
 * - **sold** — what is missing: produced, less what is still there, less what
 *   was thrown away.
 *
 * **And we do know when.** `complete_pickup` stamps every order with the
 * produced-date range it drew from, so an order whose range is a single day
 * dates that day's sale exactly. A pickup that drew across several days can't
 * be split, and is left undated rather than guessed at.
 *
 * **Her share of a pooled day is her share of the tank.** Five of the seven
 * gallons on 4 Aug were hers, so five sevenths of what that day earned is
 * hers. It is an apportionment, not a measurement, and it is the only honest
 * one available for milk that went into a shared tank.
 */

export type MilkStatus = "sold" | "inventory" | "discarded";

/** What became of the whole day's milk — the tank, not her pail. */
export interface MilkTank {
  produced: number;
  sold: number;
  /** Still in the shop and already spoken for by an open order. */
  promised: number;
  /** Still in the shop and free to sell. */
  free: number;
  binned: number;
}

export interface MilkDay {
  key: string;
  /** Local ISO day. */
  date: string;
  /** Hers. */
  gallons: number;
  /** False for a day with no milking on file: a gap, not a zero. */
  recorded: boolean;
  tank: MilkTank;
  /** Her share of the day's tank, 0–1. */
  share: number;
  /** The days a single-day pickup collected this day's milk. Empty when it
   *  has not sold, or when only a multi-day pickup covers it. */
  soldOn: string[];
  /** Whichever of sold, held and binned is the largest — what the bar is
   *  coloured by. The words in the table carry the rest. */
  status: MilkStatus;
  /** Her share of what this day is or was worth, at today's price, less
   *  anything thrown away. */
  valueCents: number;
  /** Her share of what the binned part would have fetched. */
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
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The day `back` days before `iso`, by calendar arithmetic rather than by
 *  adding milliseconds — a day is not always 86,400,000 ms of local time. */
export function dayBefore(iso: string, back: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const at = new Date(y, m - 1, d - back);
  return localDay(at.toISOString());
}

export interface MilkContext {
  priceCents: number;
  productId: number | null;
  /** produced date → what its batches still hold. */
  onHand: Map<string, { quantity: number; reserved: number }>;
  /** produced date → gallons thrown away. */
  binned: Map<string, number>;
  /** produced date → the days a single-day pickup collected it. */
  soldOn: Map<string, string[]>;
}

export const emptyMilkContext = (): MilkContext => ({
  priceCents: 0,
  productId: null,
  onHand: new Map(),
  binned: new Map(),
  soldOn: new Map(),
});

export function buildMilkDays(input: {
  /** Hers. */
  records: { produced_date: string; quantity: number }[];
  /** Every cow's, so a pooled day knows its own size. */
  allRecords: { produced_date: string; quantity: number }[];
  context: MilkContext;
  days: number;
  today: string;
}): MilkDay[] {
  const from = dayBefore(input.today, input.days - 1);
  const { context } = input;

  const sum = (rows: { produced_date: string; quantity: number }[]) => {
    const by = new Map<string, number>();
    for (const r of rows) {
      const date = r.produced_date.slice(0, 10);
      by.set(date, (by.get(date) ?? 0) + Number(r.quantity));
    }
    return by;
  };

  const hers = sum(input.records);
  const tankTotals = sum(input.allRecords);

  const out: MilkDay[] = [];
  for (let i = input.days - 1; i >= 0; i--) {
    const date = dayBefore(input.today, i);
    if (date < from) continue;

    const her = hers.get(date);
    if (her === undefined) {
      out.push({
        key: date, date, gallons: 0, recorded: false,
        tank: { produced: 0, sold: 0, promised: 0, free: 0, binned: 0 },
        share: 0, soldOn: [], status: "inventory", valueCents: 0, lostCents: 0,
      });
      continue;
    }

    const produced = round3(tankTotals.get(date) ?? her);
    const held = context.onHand.get(date) ?? { quantity: 0, reserved: 0 };
    // Stock added straight from the Store screen sits in a batch of its own
    // for the same day, so what is on hand can exceed what the cows gave.
    // Clamped, because "negative sold" is not a thing that happened.
    const onHand = Math.min(produced, round3(held.quantity));
    const promised = Math.min(onHand, round3(held.reserved));
    const binned = Math.min(produced - onHand, round3(context.binned.get(date) ?? 0));
    const sold = round3(Math.max(0, produced - onHand - binned));

    const share = produced > 0 ? her / produced : 0;
    const keeps = produced > 0 ? (produced - binned) / produced : 0;

    const biggest = Math.max(sold, onHand, binned);
    const status: MilkStatus = biggest === 0
      ? "inventory"
      : sold === biggest
        ? "sold"
        : onHand === biggest
          ? "inventory"
          : "discarded";

    out.push({
      key: date,
      date,
      gallons: round1(her),
      recorded: true,
      tank: { produced, sold, promised, free: round3(onHand - promised), binned },
      share,
      soldOn: context.soldOn.get(date) ?? [],
      status,
      valueCents: Math.round(her * keeps * input.context.priceCents),
      lostCents: Math.round(her * (1 - keeps) * input.context.priceCents),
    });
  }
  return out;
}

export function summariseMilk(days: MilkDay[], priceCents: number): MilkSummary {
  const on = days.filter((d) => d.recorded);
  // Her share of the tank, day by day. Apportioning is stated rather than
  // hidden: pooled milk has no per-cow gallon to point at.
  const hers = (pick: (d: MilkDay) => number) => round1(on.reduce((s, d) => s + pick(d) * d.share, 0));
  const cents = (pick: (d: MilkDay) => number) =>
    on.reduce((s, d) => s + Math.round(pick(d) * d.share * priceCents), 0);

  return {
    gallons: round1(on.reduce((s, d) => s + d.gallons, 0)),
    days: on.length,
    soldCents: cents((d) => d.tank.sold),
    onHandGallons: hers((d) => d.tank.free + d.tank.promised),
    onHandCents: cents((d) => d.tank.free + d.tank.promised),
    discardedGallons: hers((d) => d.tank.binned),
    discardedCents: on.reduce((s, d) => s + d.lostCents, 0),
  };
}

// ─── access ────────────────────────────────────────────────────────────

/**
 * Everything needed to say what became of a day's milk.
 *
 * A missing milk product is not an error — a farm that sells no milk still
 * has cows, and the section values her days at nothing rather than refusing
 * to draw.
 */
export async function fetchMilkContext(businessId: number): Promise<MilkContext> {
  const products = await supabase
    .from("products")
    .select("id, name, price, type_code")
    .eq("business_id", businessId);
  if (products.error) throw new Error(`products: ${products.error.message}`);

  const rows = (products.data ?? []) as { id: number; name: string; price: number | null; type_code: string | null }[];
  const milk = rows.find((p) => p.type_code === "milk") ?? rows.find((p) => /\bmilk\b/i.test(p.name)) ?? null;
  if (!milk) return emptyMilkContext();

  const [batches, discards, orders] = await Promise.all([
    supabase
      .from("inventory_batches")
      .select("produced_date, quantity, reserved")
      .eq("product_id", milk.id)
      .eq("business_id", businessId),
    supabase
      .from("discards")
      .select("batch_produced_date, quantity")
      .eq("product_id", milk.id)
      .eq("business_id", businessId),
    supabase
      .from("orders")
      .select("added_from, added_to, picked_up_date")
      .eq("product_id", milk.id)
      .eq("business_id", businessId)
      .eq("status", "completed"),
  ]);
  if (batches.error) throw new Error(`inventory_batches: ${batches.error.message}`);
  if (discards.error) throw new Error(`discards: ${discards.error.message}`);
  if (orders.error) throw new Error(`orders: ${orders.error.message}`);

  const onHand = new Map<string, { quantity: number; reserved: number }>();
  for (const b of (batches.data ?? []) as { produced_date: string; quantity: number; reserved: number }[]) {
    const date = b.produced_date.slice(0, 10);
    const entry = onHand.get(date) ?? { quantity: 0, reserved: 0 };
    entry.quantity += Number(b.quantity);
    entry.reserved += Number(b.reserved ?? 0);
    onHand.set(date, entry);
  }

  const binned = new Map<string, number>();
  for (const d of (discards.data ?? []) as { batch_produced_date: string | null; quantity: number }[]) {
    // No produced date means nobody said which day went down the drain. It
    // is real loss, but charging it to a day we picked would be a lie.
    if (!d.batch_produced_date) continue;
    const date = d.batch_produced_date.slice(0, 10);
    binned.set(date, (binned.get(date) ?? 0) + Number(d.quantity));
  }

  const soldOn = new Map<string, string[]>();
  for (const o of (orders.data ?? []) as { added_from: string | null; added_to: string | null; picked_up_date: string | null }[]) {
    // Only a pickup that drew from one day can date that day. One that drew
    // across a fortnight says nothing about any single day inside it.
    if (!o.added_from || !o.picked_up_date || o.added_from !== o.added_to) continue;
    const date = o.added_from.slice(0, 10);
    soldOn.set(date, [...(soldOn.get(date) ?? []), localDay(o.picked_up_date)]);
  }

  return {
    priceCents: Math.round(Number(milk.price ?? 0) * 100),
    productId: milk.id,
    onHand,
    binned,
    soldOn,
  };
}
