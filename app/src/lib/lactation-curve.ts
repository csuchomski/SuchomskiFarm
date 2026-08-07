import type { RealLactation } from "./lactations";

/**
 * The shape of a lactation, and how one compares with the next.
 *
 * A dairy cow's output is not flat: it climbs for six to ten weeks, peaks,
 * then declines for the rest of the lactation. That curve is the thing worth
 * looking at — a cow whose peak is lower than last time, or who falls away
 * faster, is telling you something a single total never would.
 *
 * Everything here is pure and works on days-in-milk rather than calendar
 * dates, which is what makes two lactations that started months apart
 * comparable at all.
 */

const MS_DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface ProductionRecord {
  animal_id: string;
  produced_date: string;
  quantity: number;
}

/** Days from freshening to a date. Day 0 is the day she freshened. */
export const dimOf = (lactation: Pick<RealLactation, "fresh_date">, dateIso: string): number =>
  Math.floor((parse(dateIso) - parse(lactation.fresh_date)) / MS_DAY);

export interface CurveBin {
  /** First day-in-milk this bin covers. */
  from: number;
  /** Last day-in-milk this bin covers, inclusive. */
  to: number;
  total: number;
  /** Distinct days inside the bin that have any milk recorded. */
  daysRecorded: number;
  /**
   * Average per day across the bin's *whole* width, not just the days with
   * records. A week with one milking recorded produced milk on one day, not
   * seven, and averaging over the recorded days alone would report her as if
   * she gave that much every day.
   */
  perDay: number;
}

/**
 * Milk binned by days-in-milk. Weekly by default, which is the granularity a
 * curve reads at — daily bars for a 305-day lactation are noise.
 *
 * Bins run to the end of the recorded data rather than a fixed 305 days, so
 * a cow forty days in gets six bars instead of six bars and thirty-seven
 * empty ones.
 */
export function curveBins(
  lactation: Pick<RealLactation, "animal_id" | "fresh_date" | "dry_off_date">,
  records: ProductionRecord[],
  binDays = 7,
): CurveBin[] {
  const mine = records.filter(
    (r) =>
      r.animal_id === lactation.animal_id &&
      r.produced_date >= lactation.fresh_date &&
      (lactation.dry_off_date === null || r.produced_date <= lactation.dry_off_date),
  );
  if (mine.length === 0) return [];

  const byBin = new Map<number, { total: number; days: Set<string> }>();
  let lastBin = 0;

  for (const r of mine) {
    const dim = dimOf(lactation, r.produced_date);
    if (dim < 0) continue;
    const bin = Math.floor(dim / binDays);
    lastBin = Math.max(lastBin, bin);
    const entry = byBin.get(bin) ?? { total: 0, days: new Set<string>() };
    entry.total += Number(r.quantity);
    entry.days.add(r.produced_date);
    byBin.set(bin, entry);
  }

  const out: CurveBin[] = [];
  for (let bin = 0; bin <= lastBin; bin++) {
    const entry = byBin.get(bin);
    const total = entry ? round3(entry.total) : 0;
    out.push({
      from: bin * binDays,
      to: bin * binDays + binDays - 1,
      total,
      daysRecorded: entry ? entry.days.size : 0,
      perDay: round3(total / binDays),
    });
  }
  return out;
}

export interface LactationSummary {
  lactationId: string;
  animalId: string;
  number: number;
  freshDate: string;
  /** Null while she's still milking. */
  dryOffDate: string | null;
  total: number;
  /** Best single day, and the days-in-milk it fell on. */
  peak: number | null;
  peakDim: number | null;
  /** Length so far, or the full length once dried off. */
  days: number;
  open: boolean;
}

/**
 * One row per lactation, oldest first — the comparison view.
 *
 * Peak is the best *day*, summed across that day's milkings, not the largest
 * single record: a cow milked twice at 4 gallons peaked at 8, not 4.
 */
export function summarise(
  lactations: RealLactation[],
  records: ProductionRecord[],
  todayIso: string,
): LactationSummary[] {
  return lactations
    .map((l) => {
      const mine = records.filter(
        (r) =>
          r.animal_id === l.animal_id &&
          r.produced_date >= l.fresh_date &&
          (l.dry_off_date === null || r.produced_date <= l.dry_off_date),
      );

      const byDay = new Map<string, number>();
      for (const r of mine) byDay.set(r.produced_date, (byDay.get(r.produced_date) ?? 0) + Number(r.quantity));

      let peak: number | null = null;
      let peakDim: number | null = null;
      // Ties go to the earlier day: peaking early then holding is a
      // different animal from peaking late, and the first time she reached
      // it is the honest answer.
      for (const day of [...byDay.keys()].sort()) {
        const value = byDay.get(day)!;
        if (peak === null || value > peak) {
          peak = round3(value);
          peakDim = dimOf(l, day);
        }
      }

      const end = l.dry_off_date ?? todayIso;
      const days = Math.max(0, Math.floor((parse(end) - parse(l.fresh_date)) / MS_DAY));

      return {
        lactationId: l.id,
        animalId: l.animal_id,
        number: l.lactation_number,
        freshDate: l.fresh_date,
        dryOffDate: l.dry_off_date,
        total: round3([...byDay.values()].reduce((s, v) => s + v, 0)),
        peak,
        peakDim,
        days,
        open: l.dry_off_date === null,
      };
    })
    .sort((a, b) => a.number - b.number || a.freshDate.localeCompare(b.freshDate));
}

/**
 * Bar heights as percentages of the tallest bar across *every* series shown.
 *
 * One shared scale, deliberately: the whole point of putting two lactations
 * side by side is comparing them, and rescaling each to its own maximum
 * would draw a poor lactation exactly like a good one.
 */
export function scaleTo100(series: number[][]): number[][] {
  const peak = Math.max(0, ...series.flat());
  if (peak <= 0) return series.map((s) => s.map(() => 0));
  return series.map((s) => s.map((v) => Math.round((v / peak) * 100)));
}

export interface CurveComparison {
  /** The lactation being looked at. */
  current: LactationSummary;
  /** The one before it, if there is one — drawn faint behind. */
  previous: LactationSummary | null;
  /** Aligned by days-in-milk, so bar 3 is week 3 of both. */
  bins: { from: number; to: number; current: number; previous: number }[];
  /** Percent heights, on one shared scale. */
  heights: { current: number; previous: number }[];
}

/**
 * A lactation against the one before it, aligned on days-in-milk.
 *
 * Alignment is the reason this exists. Two lactations that started in
 * different seasons can only be compared week-of-lactation against
 * week-of-lactation; comparing them by calendar date would just show you
 * that one happened later.
 */
export function compareWithPrevious(
  lactation: RealLactation,
  all: RealLactation[],
  records: ProductionRecord[],
  todayIso: string,
  binDays = 7,
): CurveComparison {
  const summaries = summarise(all, records, todayIso);
  const current = summaries.find((s) => s.lactationId === lactation.id)!;

  const earlier = summaries
    .filter((s) => s.animalId === lactation.animal_id && s.number < lactation.lactation_number)
    .sort((a, b) => b.number - a.number);
  const previousSummary = earlier[0] ?? null;
  const previousLactation = previousSummary ? all.find((l) => l.id === previousSummary.lactationId)! : null;

  const currentBins = curveBins(lactation, records, binDays);
  const previousBins = previousLactation ? curveBins(previousLactation, records, binDays) : [];

  const length = Math.max(currentBins.length, previousBins.length);
  const bins = Array.from({ length }, (_, i) => ({
    from: i * binDays,
    to: i * binDays + binDays - 1,
    current: currentBins[i]?.total ?? 0,
    previous: previousBins[i]?.total ?? 0,
  }));

  const [currentHeights, previousHeights] = scaleTo100([bins.map((b) => b.current), bins.map((b) => b.previous)]);

  return {
    current,
    previous: previousSummary,
    bins,
    heights: bins.map((_, i) => ({ current: currentHeights[i], previous: previousHeights[i] })),
  };
}

/** Cows with something to draw, best producer first. A cow with a lactation
 * but no milk recorded has no curve and is left out of the picker. */
export function animalsWithCurves(
  lactations: RealLactation[],
  records: ProductionRecord[],
  todayIso: string,
): { animalId: string; lactations: LactationSummary[]; total: number }[] {
  const summaries = summarise(lactations, records, todayIso).filter((s) => s.total > 0);
  const by = new Map<string, LactationSummary[]>();
  for (const s of summaries) by.set(s.animalId, [...(by.get(s.animalId) ?? []), s]);

  return [...by.entries()]
    .map(([animalId, rows]) => ({
      animalId,
      lactations: rows,
      total: round3(rows.reduce((sum, r) => sum + r.total, 0)),
    }))
    .sort((a, b) => b.total - a.total || a.animalId.localeCompare(b.animalId));
}
