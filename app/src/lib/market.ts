import { supabase } from "./supabase";
import type { SlidePoint } from "./sell-buy";

/**
 * The market reports, as a price slide.
 *
 * `market.latest_slide` is the most recent report from each source, one row
 * per weight class: a source, a report date, a class ("Steers"), a grade
 * ("1", "1-2", or none), a weight and a price per hundredweight. Migration
 * 068 is what lets the app read it.
 *
 * A **series** is one source, one class, one grade — Iowa's Medium and Large
 * 1 steers, say. That is the unit that makes a slide: mixing classes puts
 * slaughter cows in with feeders, and mixing grades compares cattle that are
 * not the same cattle. Sixteen rungs from 472 lb to 1,165 lb, falling from
 * $456 to $256, is what one looks like.
 *
 * Nothing here is farm data. These are USDA AMS auction summaries — public,
 * identical for every farm on the system, and behind the login only because
 * everything in this app is.
 */

/** One row of the view, as it arrives. */
interface SlideRow {
  source_id: number;
  label: string;
  is_local: boolean;
  report_date: string;
  class: string | null;
  grade: string | null;
  wt: number | null;
  cwt: number | null;
  head: number | null;
}

/** One source, class and grade — the unit that makes a usable slide. */
export interface MarketSeries {
  key: string;
  sourceId: number;
  /** The report it came from, for saying so on the page. */
  label: string;
  reportDate: string;
  isLocal: boolean;
  klass: string;
  /** Null where the report did not grade the lot. */
  grade: string | null;
  /** Head across every rung, which is how much of a market this is. A series
   *  built on nine head is a rumour; one on four thousand is a market. */
  head: number;
  rungs: SlidePoint[];
  /**
   * Rungs left out as impossible, with what they said.
   *
   * Never dropped silently. The page names them, because a farmer who knows
   * their barn will recognise a misread row faster than any rule will.
   */
  dropped: { weightLb: number; cwt: number }[];
}

/**
 * How far off the middle of its own series a rung may sit.
 *
 * Some AMS rows carry a **per-head price in the per-hundredweight column** —
 * Iowa's 2026-08-24 heifers report a 450 lb lot at "1900", which as a price
 * per hundredweight would make her worth $8,550. The two bad rows in that
 * series sit at 5.35 and 5.49 times its median; every real rung sits between
 * 0.79 and 1.10. There is a lot of daylight, and this sits in it.
 *
 * Relative to the series median rather than an absolute band on dollars,
 * because cattle prices move by multiples across a decade and a hard ceiling
 * written today would start throwing away real rungs in a strong market. A
 * slide's own middle is the only stable thing to measure against.
 */
const OUTLIER_HIGH = 2.5;
const OUTLIER_LOW = 0.4;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

const seriesKey = (r: SlideRow) => `${r.source_id}|${r.class ?? ""}|${r.grade ?? ""}`;

/** How a series reads in a picker: the ground it came from, then the cattle. */
export function seriesLabel(s: MarketSeries): string {
  return [s.label, s.klass, s.grade === null || s.grade === "N/A" ? null : `grade ${s.grade}`]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Group the view's rows into series, cleaning each one.
 *
 * A series needs at least two usable rungs to be a slide: one weight and one
 * price is a quote, and interpolating from it would return the same figure at
 * every weight — a flat market, which is not what one point means.
 */
export function seriesFrom(rows: SlideRow[]): MarketSeries[] {
  const groups = new Map<string, SlideRow[]>();
  for (const r of rows) {
    if (r.wt === null || r.cwt === null || r.wt <= 0 || r.cwt <= 0) continue;
    const key = seriesKey(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const out: MarketSeries[] = [];
  for (const [key, list] of groups) {
    const mid = median(list.map((r) => Number(r.cwt)));
    const rungs: SlidePoint[] = [];
    const dropped: { weightLb: number; cwt: number }[] = [];

    for (const r of list) {
      const cwt = Number(r.cwt);
      const weightLb = Number(r.wt);
      const off = mid > 0 ? cwt / mid : 1;
      if (off > OUTLIER_HIGH || off < OUTLIER_LOW) dropped.push({ weightLb, cwt });
      else rungs.push({ weightLb, cwt });
    }

    if (rungs.length < 2) continue;

    rungs.sort((a, b) => a.weightLb - b.weightLb);
    dropped.sort((a, b) => a.weightLb - b.weightLb);

    const first = list[0];
    out.push({
      key,
      sourceId: first.source_id,
      label: first.label,
      reportDate: first.report_date,
      isLocal: Boolean(first.is_local),
      klass: first.class ?? "Cattle",
      grade: first.grade,
      head: list.reduce((n, r) => n + (r.head ?? 0), 0),
      rungs,
      dropped,
    });
  }

  // The nearest barn first, then the widest market: a report from your own
  // state prices cattle you could actually haul there.
  return out.sort(
    (a, b) =>
      Number(b.isLocal) - Number(a.isLocal) ||
      b.head - a.head ||
      seriesLabel(a).localeCompare(seriesLabel(b)),
  );
}

export async function fetchMarketSeries(): Promise<MarketSeries[]> {
  const { data, error } = await supabase
    .schema("market")
    .from("latest_slide")
    .select("source_id, label, is_local, report_date, class, grade, wt, cwt, head");
  if (error) throw new Error(`market.latest_slide: ${error.message}`);
  return seriesFrom((data ?? []) as unknown as SlideRow[]);
}
