import { supabase } from "./supabase";
import { cleanRungs } from "./market";
import { priceAt, type SlidePoint } from "./sell-buy";

/**
 * The market reports over time, one class at a time.
 *
 * `market.latest_slide` answers "what is a 700 lb steer worth today". This
 * answers "what has a 700 lb steer been worth, and how does that compare to a
 * heifer, a cow, a bull" — which is the question Bud Williams' sell/buy turns
 * on. His whole argument is that the absolute price is nobody's business:
 * what pays is the **relationship between classes on the same day**, because
 * you sell into that market and buy back out of it within the hour.
 *
 * A **track** is one class through time: one source, one commodity, one
 * class, one grade — Iowa's Feeder Cattle, Steers, grade 1 — with one point
 * per report date.
 *
 * ── Why a track is priced at a weight ─────────────────────────────────────
 *
 * Each report gives a class as a ladder of weight rungs, and which rungs came
 * to town changes week to week. Averaging the ladder makes a series that
 * moves when the *mix* moves, so a week that happened to sell light calves
 * reads as a rally. Pricing one weight off every week's ladder — the same
 * weight every time — is the like-for-like comparison, and it is the same
 * interpolation the sell/buy analyzer already uses on a single report.
 *
 * The head-weighted average is kept as the other way of asking, because it is
 * always defined: a fixed weight only has an answer on the weeks that class
 * covered it. Both are offered and the page says which is on.
 */

/** One weight rung of one class on one report date, as the view returns it. */
export interface HistoryRow {
  report_date: string;
  source_id: number;
  label: string;
  is_local: boolean;
  commodity: string | null;
  class: string | null;
  grade: string | null;
  wt: number | null;
  cwt: number | null;
  head: number | null;
}

/** One class on one report date. */
export interface TrackPoint {
  date: string;
  /**
   * Dollars per hundredweight — nominal, as reported.
   *
   * Null where the question has no answer that week: a fixed weight outside
   * the rungs that class brought, or a week with too few rungs to interpolate
   * across. A gap, not a zero — drawing it as zero would be a crash that
   * never happened.
   */
  cwt: number | null;
  head: number;
  /** The ladder behind the figure, for showing the week itself. */
  rungs: SlidePoint[];
}

export interface ClassTrack {
  key: string;
  sourceId: number;
  /** The report it came from. */
  label: string;
  isLocal: boolean;
  commodity: string | null;
  klass: string;
  grade: string | null;
  /** Head across every report, which is how much of a market this is. */
  head: number;
  /** The lightest and heaviest this class was ever quoted at. */
  lowLb: number;
  highLb: number;
  points: TrackPoint[];
}

/** How a track reads in a legend: the cattle first, the barn after. */
export function trackLabel(t: ClassTrack): string {
  return [t.klass, t.grade === null || t.grade === "N/A" ? null : `grade ${t.grade}`]
    .filter(Boolean)
    .join(" ");
}

/** The same, with everything that tells two of them apart. */
export function trackFullLabel(t: ClassTrack): string {
  return [t.label, t.commodity, trackLabel(t)].filter(Boolean).join(" · ");
}

const trackKey = (r: HistoryRow) =>
  `${r.source_id}|${r.commodity ?? ""}|${r.class ?? ""}|${r.grade ?? ""}`;

/** How a class's week is turned into one figure. */
export type Basis = { kind: "atWeight"; lb: number } | { kind: "average" };

/**
 * Group the view's rows into tracks.
 *
 * The outlier rule is `cleanRungs`, shared with the single-report page: a
 * per-head price sitting in the per-hundredweight column has to be a misread
 * in both places, or the same lot is in one chart and out of the other.
 */
export function tracksFrom(rows: HistoryRow[], basis: Basis): ClassTrack[] {
  const groups = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    if (r.wt === null || r.cwt === null || Number(r.wt) <= 0 || Number(r.cwt) <= 0) continue;
    const key = trackKey(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const out: ClassTrack[] = [];
  for (const [key, list] of groups) {
    const byDate = new Map<string, HistoryRow[]>();
    for (const r of list) {
      const day = byDate.get(r.report_date);
      if (day) day.push(r);
      else byDate.set(r.report_date, [r]);
    }

    const points: TrackPoint[] = [];
    let lowLb = Infinity;
    let highLb = -Infinity;
    let head = 0;

    for (const [date, day] of [...byDate].sort((a, b) => a[0].localeCompare(b[0]))) {
      const { rungs } = cleanRungs(
        day.map((r) => ({ weightLb: Number(r.wt), cwt: Number(r.cwt) })),
      );
      const dayHead = day.reduce((n, r) => n + (r.head ?? 0), 0);
      head += dayHead;

      if (rungs.length > 0) {
        lowLb = Math.min(lowLb, rungs[0].weightLb);
        highLb = Math.max(highLb, rungs[rungs.length - 1].weightLb);
      }

      points.push({ date, cwt: figureFor(rungs, day, basis), head: dayHead, rungs });
    }

    if (points.length === 0) continue;

    const first = list[0];
    out.push({
      key,
      sourceId: first.source_id,
      label: first.label,
      isLocal: Boolean(first.is_local),
      commodity: first.commodity,
      klass: first.class ?? "Cattle",
      grade: first.grade,
      head,
      lowLb: Number.isFinite(lowLb) ? lowLb : 0,
      highLb: Number.isFinite(highLb) ? highLb : 0,
      points,
    });
  }

  // The nearest barn first, then the widest market — the same order the
  // single-report picker uses, for the same reason.
  return out.sort(
    (a, b) =>
      Number(b.isLocal) - Number(a.isLocal) ||
      b.head - a.head ||
      trackFullLabel(a).localeCompare(trackFullLabel(b)),
  );
}

function figureFor(rungs: SlidePoint[], day: HistoryRow[], basis: Basis): number | null {
  if (basis.kind === "average") {
    // Weighted by head: a class's price for the week is what the cattle that
    // sold went for, not what the middle of the ladder says. Ten rungs of
    // four head and one of nine hundred is one lot with some noise round it.
    let value = 0;
    let n = 0;
    for (const r of day) {
      const h = r.head ?? 0;
      if (h > 0 && r.cwt !== null) {
        value += Number(r.cwt) * h;
        n += h;
      }
    }
    if (n > 0) return value / n;
    // No head counts at all — a plain mean of the clean rungs is the only
    // thing left, and it is better than nothing on a report that omits them.
    return rungs.length > 0 ? rungs.reduce((s, r) => s + r.cwt, 0) / rungs.length : null;
  }

  // A fixed weight is only honest inside the ladder. `priceAt` clamps flat
  // past the ends, which would report the lightest rung's price for a weight
  // that class never brought to town — a straight line at a number nobody
  // was ever paid.
  if (rungs.length < 2) return null;
  if (basis.lb < rungs[0].weightLb || basis.lb > rungs[rungs.length - 1].weightLb) return null;
  return priceAt(rungs, basis.lb);
}

/**
 * A rolling mean over the last `window` reports, aligned to each point.
 *
 * Trailing rather than centred: a centred average would read the future, and
 * the last few weeks — the ones anybody actually acts on — would have no line
 * over them at all. Null until there are `window` figures behind a point, so
 * the line starts where it means something rather than easing in from a mean
 * of one.
 *
 * Gaps do not count. A week a class did not sell is not a zero and not a
 * repeat of the week before; the window steps over it and waits.
 */
export function rollingMean(values: (number | null)[], window: number): (number | null)[] {
  const w = Math.max(1, Math.floor(window));
  const out: (number | null)[] = [];
  const seen: number[] = [];
  for (const v of values) {
    if (v !== null) seen.push(v);
    if (seen.length > w) seen.shift();
    out.push(seen.length === w ? seen.reduce((a, b) => a + b, 0) / w : null);
  }
  return out;
}

/** Years between two ISO days, on a 365.25-day year. */
const yearsBetween = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365.25 * 86_400_000);

/**
 * Nominal dollars restated in the dollars of `asOf`.
 *
 * There is no price index in the database and this does not invent one: the
 * rate is the farm's own figure, and the page says so and says which year's
 * dollars it is showing. A CPI feed would be a second puller to keep alive
 * for a correction that, over the span of weekly auction reports, is small —
 * three percent a year against cattle that move thirty. It matters across
 * years, not across a season, and the page says that too.
 */
export function deflate(
  points: TrackPoint[],
  ratePerYear: number,
  asOf: string,
): (number | null)[] {
  return points.map((p) =>
    p.cwt === null ? null : p.cwt * (1 + ratePerYear) ** yearsBetween(p.date, asOf),
  );
}

/**
 * Every figure as a percentage of the first one there is.
 *
 * The comparison that actually answers "which class is doing better", and the
 * one that needs no deflator at all: inflation is in both the numerator and
 * the denominator of a ratio, so it divides out. Two classes on one indexed
 * chart is the whole of Bud Williams' point drawn — you are looking for the
 * one that has got dear relative to the other, whatever the money is doing.
 */
export function indexed(values: (number | null)[]): (number | null)[] {
  const base = values.find((v) => v !== null && v !== 0) ?? null;
  if (base === null) return values.map(() => null);
  return values.map((v) => (v === null ? null : (v / base) * 100));
}

/**
 * One class against another, on the dates they share.
 *
 * The sell/buy ratio: how many pounds of the second class a pound of the
 * first one buys. Above one and the first is the dearer animal — the one to
 * be selling — and that is the trade, whatever either is worth in dollars.
 */
export function spread(
  a: TrackPoint[],
  b: TrackPoint[],
): { date: string; ratio: number }[] {
  const byDate = new Map(b.map((p) => [p.date, p.cwt]));
  const out: { date: string; ratio: number }[] = [];
  for (const p of a) {
    const other = byDate.get(p.date);
    if (p.cwt === null || other === undefined || other === null || other === 0) continue;
    out.push({ date: p.date, ratio: p.cwt / other });
  }
  return out;
}

/** Every report date any track covers, oldest first. */
export function datesIn(tracks: ClassTrack[]): string[] {
  const all = new Set<string>();
  for (const t of tracks) for (const p of t.points) all.add(p.date);
  return [...all].sort();
}

export async function fetchMarketHistory(): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .schema("market")
    .from("quote_history")
    .select("report_date, source_id, label, is_local, commodity, class, grade, wt, cwt, head");
  if (error) throw new Error(`market.quote_history: ${error.message}`);
  return (data ?? []) as unknown as HistoryRow[];
}
