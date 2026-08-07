import { occurrencesBetween, type Schedule } from "./schedules";

/**
 * Will there be enough?
 *
 * A cash-flow model, but for product: start from what's in the cooler, add
 * what you expect to produce each day, take out what's already promised, and
 * walk it forward day by day. The number that matters is the first day the
 * running balance goes negative — that's the day you disappoint someone, and
 * knowing it a fortnight early is the whole point.
 *
 * Everything here is pure. Estimates are labelled as estimates: production
 * is a rate derived from history (or one you set), not a promise, and the
 * model says which it used.
 */

const MS_DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const addDays = (iso: string, days: number) => new Date(parse(iso) + days * MS_DAY).toISOString().slice(0, 10);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface ForecastDay {
  date: string;
  /** Expected production landing that day. */
  production: number;
  /** Standing-order pickups due that day. */
  scheduled: number;
  /** One-off reserved orders expected that day. */
  reserved: number;
  /** production − scheduled − reserved. */
  net: number;
  /** Running stock at end of day. */
  balance: number;
  short: boolean;
}

export type ProductionBasis = "override" | "history" | "none";

export interface Forecast {
  productId: number;
  days: ForecastDay[];
  /** Per-day production rate used, and where it came from. */
  dailyProduction: number;
  basis: ProductionBasis;
  opening: number;
  /** First day the balance goes negative, or null if it never does. */
  firstShortfall: string | null;
  /** How deep it gets at the worst point — a positive number of units. */
  worstShortfall: number;
  totalScheduled: number;
  totalProduction: number;
}

/**
 * Average daily production from recent history.
 *
 * Measured over whole days that have passed, not including today: today's
 * milking may not have been entered yet, and dividing by a day that's only
 * half recorded drags the average down every morning.
 */
export function dailyProductionFromHistory(
  batches: { produced_date: string; quantity: number }[],
  todayIso: string,
  windowDays = 14,
): number | null {
  const from = addDays(todayIso, -windowDays);
  const recent = batches.filter((b) => b.produced_date >= from && b.produced_date < todayIso);
  if (recent.length === 0) return null;
  const total = recent.reduce((s, b) => s + Number(b.quantity), 0);
  return round3(total / windowDays);
}

/**
 * The projection.
 *
 * `forecastOverride` is products.forecast_override, which the schema treats
 * as a weekly figure — product_stats() compares it against a week of
 * production — so it's divided by 7 here rather than used as a daily rate.
 */
export function buildForecast(input: {
  productId: number;
  openingOnHand: number;
  batches: { produced_date: string; quantity: number }[];
  schedules: Schedule[];
  /** Open one-off orders, with the day they're expected to be collected. */
  reservations?: { date: string; quantity: number }[];
  forecastOverride?: number | null;
  todayIso: string;
  days?: number;
}): Forecast {
  const {
    productId,
    openingOnHand,
    batches,
    schedules,
    reservations = [],
    forecastOverride,
    todayIso,
    days = 28,
  } = input;

  const fromHistory = dailyProductionFromHistory(batches, todayIso);
  const dailyProduction =
    forecastOverride !== null && forecastOverride !== undefined
      ? round3(Number(forecastOverride) / 7)
      : (fromHistory ?? 0);
  const basis: ProductionBasis =
    forecastOverride !== null && forecastOverride !== undefined
      ? "override"
      : fromHistory !== null
        ? "history"
        : "none";

  const last = addDays(todayIso, days - 1);

  // Standing orders for this product only, expanded into dated pickups.
  const scheduledByDate = new Map<string, number>();
  for (const s of schedules) {
    if (s.product_id !== productId) continue;
    for (const date of occurrencesBetween(s, todayIso, last)) {
      scheduledByDate.set(date, (scheduledByDate.get(date) ?? 0) + Number(s.quantity));
    }
  }

  const reservedByDate = new Map<string, number>();
  for (const r of reservations) {
    if (r.date < todayIso || r.date > last) continue;
    reservedByDate.set(r.date, (reservedByDate.get(r.date) ?? 0) + Number(r.quantity));
  }

  const out: ForecastDay[] = [];
  let balance = openingOnHand;
  let firstShortfall: string | null = null;
  let worstShortfall = 0;
  let totalScheduled = 0;
  let totalProduction = 0;

  for (let i = 0; i < days; i++) {
    const date = addDays(todayIso, i);
    const scheduled = round3(scheduledByDate.get(date) ?? 0);
    const reserved = round3(reservedByDate.get(date) ?? 0);
    const production = dailyProduction;
    const net = round3(production - scheduled - reserved);
    balance = round3(balance + net);

    const short = balance < 0;
    if (short) {
      if (firstShortfall === null) firstShortfall = date;
      worstShortfall = Math.max(worstShortfall, -balance);
    }

    totalScheduled = round3(totalScheduled + scheduled + reserved);
    totalProduction = round3(totalProduction + production);

    out.push({ date, production, scheduled, reserved, net, balance, short });
  }

  return {
    productId,
    days: out,
    dailyProduction,
    basis,
    opening: round3(openingOnHand),
    firstShortfall,
    worstShortfall: round3(worstShortfall),
    totalScheduled,
    totalProduction,
  };
}

/**
 * A sentence for the top of the page.
 *
 * The shortfall is reported first even when there's no production history to
 * go on — a projected shortfall with nothing coming in is the most urgent
 * case there is, and burying it under "no production recorded" would hide
 * exactly the warning worth reading. The missing basis is a caveat appended
 * to it, not a replacement for it.
 */
export function summarise(forecast: Forecast, unit: string): string {
  const caveat =
    forecast.basis === "none" ? " No production recorded recently, so this only counts what's in the cooler." : "";

  if (forecast.firstShortfall !== null) {
    // Two different numbers, kept apart on purpose: the day it first goes
    // short, and how deep the hole gets later. "Short of 12 by the 13th"
    // would be wrong — on the 13th you are only 6 short.
    return `Runs short on ${forecast.firstShortfall}, down ${forecast.worstShortfall} ${unit} at the worst.${caveat}`;
  }
  if (forecast.basis === "none") {
    return "No production recorded recently, so this only counts what's already in the cooler.";
  }
  return `Covered for the next ${forecast.days.length} days.`;
}

/** Weekly commitment across every active standing order for a product —
 * what you've promised, whatever the shop does. */
export function weeklyCommitment(schedules: Schedule[], productId: number): number {
  return round3(
    schedules
      .filter((s) => s.product_id === productId && s.cancelled_at === null)
      .reduce((sum, s) => sum + Number(s.quantity), 0),
  );
}
