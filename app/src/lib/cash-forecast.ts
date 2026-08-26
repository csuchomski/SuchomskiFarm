import type { Forecast } from "./forecast";
import { occurrencesBetween, type Schedule } from "./schedules";
import { directionOf, type RealTransaction, type TypeMap } from "./books-data";

/**
 * The thirteen-week rolling cash forecast — the report a business is
 * actually managed from.
 *
 * Not the accountant's statement. The question here is "which week do I run
 * out", and it is answered by walking cash forward a week at a time: what is
 * in the bank, plus what is coming in, less what goes out. The GAAP
 * three-section statement answers a different question, for a different
 * reader, after the fact.
 *
 * Thirteen weeks and not three months, because a monthly grid hides a
 * mid-month trough — and a trough is the whole point. Weekly is also the
 * grain this farm's income arrives on: a standing order is a weekday.
 *
 * ── Committed and expected are not the same money ───────────────────────
 *
 * The running balance counts **committed** receipts only: standing-order
 * pickups that are on the books, and the unpaid balance of orders somebody
 * has actually reserved. Forecast production beyond that is real product but
 * not a sale — it assumes a buyer — so it is carried alongside as
 * `expected`, and `closingWithExpected` shows where the balance would land
 * if it all sold.
 *
 * Mixing the two would flatter the number you act on, and the one thing a
 * cash forecast must never do is tell you that you are fine when you are
 * not.
 *
 * Everything here is pure. The production half comes from `buildForecast`,
 * which already walks stock forward day by day and is tested on its own —
 * this puts a price on the same walk rather than repeating it.
 */

const MS_DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const addDays = (iso: string, days: number) =>
  new Date(parse(iso) + days * MS_DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CashWeek {
  /** First day of the bucket, inclusive. */
  start: string;
  /** Last day of the bucket, inclusive. */
  end: string;
  opening: number;
  /** Standing-order pickups falling this week, at the product's price. */
  standing: number;
  /** Unpaid balances on reserved orders expected this week. */
  reserved: number;
  /** Production beyond what is already promised, at price. Not committed. */
  expected: number;
  /** What goes out. A positive number. */
  payments: number;
  /** Committed receipts less payments. Excludes `expected` on purpose. */
  net: number;
  /** Cash at the end of the week, on committed receipts only. */
  closing: number;
  /** Where it would land if the expected sales landed too. */
  closingWithExpected: number;
}

export type PaymentsBasis = "history" | "none";

export interface CashForecast {
  weeks: CashWeek[];
  openingCash: number;
  /** Start date of the first week that closes below zero, on committed
   * receipts. Null when it never does. */
  firstShortWeek: string | null;
  /** How deep it gets at the worst point, as a positive number. */
  worstShortfall: number;
  totalStanding: number;
  totalReserved: number;
  totalExpected: number;
  totalPayments: number;
  /**
   * Open orders carrying no price at all — `total_cost` null.
   *
   * Counted rather than skipped silently. Money that exists but has no
   * figure on it would otherwise be invisible, and this forecast would read
   * as complete when it is not.
   */
  unpricedOrders: number;
  paymentsBasis: PaymentsBasis;
}

/** An open order, reduced to the two things the money side needs. */
export interface OpenOrderCash {
  /** When it is expected to be collected and paid for. */
  dueDate: string;
  /** Still owed: total less anything already paid. */
  owed: number;
}

/**
 * What is still owed on the orders somebody has actually reserved.
 *
 * Only `reserved` counts. A `completed` order has been handed over and
 * settled, and a `cancelled` one is not coming — and the live ledger has a
 * cancelled order still carrying a $20 `total_cost` with nothing paid
 * against it, so filtering on "not completed" would forecast money that
 * nobody owes.
 *
 * An order with no `total_cost` is not guessed at from quantity and the
 * current price: the price may have been different when it was taken, and a
 * forecast that invents figures is worse than one that reports a gap.
 * Those come back in `unpriced` instead.
 */
export function orderReceipts(
  orders: {
    status: string;
    reserved_date: string | null;
    total_cost: number | null;
    amount_paid: number | null;
  }[],
  todayIso: string,
): { receipts: OpenOrderCash[]; unpriced: number } {
  const receipts: OpenOrderCash[] = [];
  let unpriced = 0;

  for (const o of orders) {
    if (o.status !== "reserved") continue;
    if (o.total_cost === null) {
      unpriced += 1;
      continue;
    }
    const owed = round2(Number(o.total_cost) - Number(o.amount_paid ?? 0));
    if (owed <= 0) continue;

    // A pickup date already past has not happened yet — the order is still
    // open. It belongs in the first week, not in a week that has gone.
    const day = (o.reserved_date ?? todayIso).slice(0, 10);
    receipts.push({ dueDate: day < todayIso ? todayIso : day, owed });
  }

  return { receipts, unpriced };
}

/**
 * Average weekly outgoings, from what has actually been spent.
 *
 * There is no scheduled-cost data on this farm — no payment terms, no
 * recurring bills, nothing that says what next Tuesday costs. The honest
 * options were to ask the farmer to type a figure or to read one from
 * history, and history is the one that is right on the first day rather
 * than after somebody fills a form in.
 *
 * It is an average and is labelled as one wherever it is shown. Divided by
 * the whole window rather than by the weeks that happen to have entries: a
 * quiet fortnight is part of the rate, and dropping it would overstate what
 * a normal week costs.
 */
export function averageWeeklyPayments(
  transactions: RealTransaction[],
  types: TypeMap,
  todayIso: string,
  weeks = 13,
): number | null {
  const from = addDays(todayIso, -weeks * 7);
  const spent = transactions.filter(
    (t) => t.date >= from && t.date < todayIso && directionOf(t, types) === "expense",
  );
  if (spent.length === 0) return null;
  const total = spent.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  return round2(total / weeks);
}

/**
 * The projection.
 *
 * `forecasts` are per-product walks from `buildForecast`, which already know
 * what is produced each day and what is promised out of it. This prices that
 * walk: what is promised becomes committed revenue, and what is left over
 * becomes expected revenue.
 *
 * Weeks are seven-day buckets from today rather than calendar weeks. A
 * calendar grid would open on a stub of two days and read as a collapse in
 * week one.
 */
export function projectCash(input: {
  todayIso: string;
  openingCash: number;
  /** Per-product production walks, already built. */
  forecasts: Forecast[];
  /** Price per unit, by product id. A product with no price contributes
   * nothing rather than a zero that looks like a decision. */
  priceOf: (productId: number) => number | null;
  schedules: Schedule[];
  /** What is still owed on reserved orders. */
  receipts: OpenOrderCash[];
  unpricedOrders?: number;
  /** Outgoings a week. Null when there is no history to average. */
  weeklyPayments: number | null;
  weeks?: number;
}): CashForecast {
  const {
    todayIso,
    openingCash,
    forecasts,
    priceOf,
    schedules,
    receipts,
    unpricedOrders = 0,
    weeklyPayments,
    weeks = 13,
  } = input;

  const lastDay = addDays(todayIso, weeks * 7 - 1);

  /** Which bucket a date falls in, or -1 when it is outside the window. */
  const bucketOf = (iso: string): number => {
    if (iso < todayIso || iso > lastDay) return -1;
    return Math.floor((parse(iso) - parse(todayIso)) / MS_DAY / 7);
  };

  const standing = new Array<number>(weeks).fill(0);
  const reserved = new Array<number>(weeks).fill(0);
  const expected = new Array<number>(weeks).fill(0);

  // ── committed: standing orders, priced ────────────────────────────────
  //
  // Straight from the schedules rather than from the forecast's `scheduled`
  // figure, because the forecast holds quantity per product per day and a
  // schedule is what actually carries the commitment. The two agree — both
  // expand through `occurrencesBetween` — and this way a product with no
  // price is visibly contributing nothing rather than silently zero.
  for (const s of schedules) {
    const price = priceOf(s.product_id);
    if (price === null) continue;
    for (const date of occurrencesBetween(s, todayIso, lastDay)) {
      const b = bucketOf(date);
      if (b >= 0) standing[b] += Number(s.quantity) * price;
    }
  }

  // ── committed: money owed on reserved orders ──────────────────────────
  for (const r of receipts) {
    const b = bucketOf(r.dueDate);
    if (b >= 0) reserved[b] += r.owed;
  }

  // ── expected: production nobody has claimed yet ───────────────────────
  //
  // Per day, what was produced less what was promised out of it. Floored at
  // zero a day at a time: a day that runs short is a day with nothing spare
  // to sell, not a day that cancels out the surplus of the day before.
  for (const f of forecasts) {
    const price = priceOf(f.productId);
    if (price === null) continue;
    for (const day of f.days) {
      const surplus = day.production - day.scheduled - day.reserved;
      if (surplus <= 0) continue;
      const b = bucketOf(day.date);
      if (b >= 0) expected[b] += surplus * price;
    }
  }

  const payments = weeklyPayments ?? 0;

  const out: CashWeek[] = [];
  let running = openingCash;
  let runningWithExpected = openingCash;
  let firstShortWeek: string | null = null;
  let worstShortfall = 0;

  for (let i = 0; i < weeks; i++) {
    const opening = round2(running);
    const s = round2(standing[i]);
    const r = round2(reserved[i]);
    const e = round2(expected[i]);
    const net = round2(s + r - payments);
    const closing = round2(opening + net);

    runningWithExpected = round2(runningWithExpected + net + e);

    if (closing < 0) {
      if (firstShortWeek === null) firstShortWeek = addDays(todayIso, i * 7);
      worstShortfall = Math.max(worstShortfall, -closing);
    }

    out.push({
      start: addDays(todayIso, i * 7),
      end: addDays(todayIso, i * 7 + 6),
      opening,
      standing: s,
      reserved: r,
      expected: e,
      payments: round2(payments),
      net,
      closing,
      closingWithExpected: runningWithExpected,
    });

    running = closing;
  }

  const sum = (pick: (w: CashWeek) => number) => round2(out.reduce((t, w) => t + pick(w), 0));

  return {
    weeks: out,
    openingCash: round2(openingCash),
    firstShortWeek,
    worstShortfall: round2(worstShortfall),
    totalStanding: sum((w) => w.standing),
    totalReserved: sum((w) => w.reserved),
    totalExpected: sum((w) => w.expected),
    totalPayments: sum((w) => w.payments),
    unpricedOrders,
    paymentsBasis: weeklyPayments === null ? "none" : "history",
  };
}

/** "2026-08-26" + "2026-09-01" -> "Aug 26 – Sep 1". */
export function weekLabel(startIso: string, endIso: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const part = (iso: string) => {
    const m = Number(iso.slice(5, 7));
    const d = Number(iso.slice(8, 10));
    return { month: names[m - 1] ?? iso.slice(5, 7), day: d };
  };
  const a = part(startIso);
  const b = part(endIso);
  // The month is not repeated inside a week that does not cross one.
  return a.month === b.month
    ? `${a.month} ${a.day} – ${b.day}`
    : `${a.month} ${a.day} – ${b.month} ${b.day}`;
}

/**
 * The sentence for the top of the page.
 *
 * The shortfall leads even when there is no payments history, for the same
 * reason it does in the product forecast: a projected shortfall is the most
 * urgent thing on the page, and burying it under a caveat hides the warning
 * worth reading. The caveat is appended, not substituted.
 */
export function summariseCash(forecast: CashForecast): string {
  const caveat =
    forecast.paymentsBasis === "none"
      ? " Nothing has been spent recently, so this counts money coming in and nothing going out."
      : "";

  if (forecast.firstShortWeek !== null) {
    const week = forecast.weeks.find((w) => w.start === forecast.firstShortWeek)!;
    return `Runs short in the week of ${weekLabel(week.start, week.end)}, down $${forecast.worstShortfall.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at the worst.${caveat}`;
  }
  return `Covered for the next ${forecast.weeks.length} weeks on what is already committed.${caveat}`;
}
