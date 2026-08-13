import {
  daysBetween,
  type ForageAvailability,
  type ForageDemand,
  type ForageRemoval,
  type Paddock,
} from "./grazing";

/**
 * The feed and forage balance — supply against demand, by unit and period.
 *
 * The 2025 revision names this as its own deliverable, and it is the reason
 * there is no single carrying-capacity figure anywhere in this module. A
 * carrying capacity is an answer with its workings thrown away; this keeps the
 * workings and lets the answer be argued with.
 *
 * **Pounds of dry matter and AUM are never converted into one another.** They
 * look like two units for one quantity and they are not: turning an AUM into
 * pounds needs an assumption about what an animal unit eats in a month, and
 * this app quietly inventing that number is exactly what it must not do. So
 * each is carried in the unit it was entered in, netted only against its own
 * kind, and a balance that cannot be struck says so rather than guessing.
 */

/** Inclusive: 1–31 May is 31 days, not 30. Somebody entering a month expects
 * a month. */
export function periodDays(startIso: string, endIso: string): number {
  return Math.max(0, daysBetween(startIso, endIso) + 1);
}

/** Does a dated thing fall inside a period? Both ends inclusive. */
export function inPeriod(dateIso: string, startIso: string, endIso: string): boolean {
  return dateIso >= startIso && dateIso <= endIso;
}

/**
 * Demand in pounds of dry matter.
 *
 * Either stated outright — which is how a wildlife estimate is entered — or
 * computed from head, weight and intake. **AUM is never computed**, only
 * carried when it was entered, for the reason in the header.
 *
 * Null when there is nothing to go on, rather than zero: "no demand recorded"
 * and "demand of nothing" are different, and only one of them means the
 * balance is trustworthy.
 */
export function demandLbDm(row: ForageDemand, planDefaultDmiPctBw: number | null): number | null {
  if (row.demandLbDm !== null) return row.demandLbDm;
  if (row.headCount === null || row.avgWeightLb === null) return null;
  const dmi = row.dmiPctBw ?? planDefaultDmiPctBw;
  if (dmi === null) return null;
  return row.headCount * row.avgWeightLb * (dmi / 100) * periodDays(row.periodStart, row.periodEnd);
}

/** Supply in pounds of dry matter, from a per-acre figure and the unit's
 * grazable acres. Null when either is missing — an availability row with no
 * acreage to stand on is not a supply of zero. */
export function supplyLbDm(row: ForageAvailability, paddock: Paddock | null): number | null {
  if (row.lbDmPerAcre === null) return null;
  const acres = paddock?.acresGrazable ?? paddock?.acresMeasured ?? null;
  return acres === null ? null : row.lbDmPerAcre * acres;
}

/** A window rows are netted within. */
export interface Period {
  start: string;
  end: string;
  label: string | null;
}

export function periodKey(p: { periodStart: string; periodEnd: string }): string {
  return `${p.periodStart}|${p.periodEnd}`;
}

export type BalanceGap =
  | null
  /** Demand recorded, nothing said about what is there to eat. */
  | "no-supply"
  /** Supply recorded, nothing said about what is eating it. */
  | "no-demand"
  /** One side in pounds, the other in AUM. Not convertible without an
   * assumption this app will not make on anyone's behalf. */
  | "different-units"
  /** Rows exist but a figure could not be worked out — usually a demand row
   * with head but no weight, or no intake rate anywhere. */
  | "incomplete";

export interface BalanceLine {
  /** Null means the row is against the whole farm rather than one unit,
   * which is the honest shape for a wildlife estimate. */
  paddockId: string | null;
  paddockName: string | null;
  period: Period;
  supplyLbDm: number | null;
  supplyAum: number | null;
  /** Hay that left in this window. Part of the balance because the standard
   * says so and because forage on a wagon is not forage in front of a cow. */
  hayLbDm: number | null;
  demandLbDm: number | null;
  demandAum: number | null;
  /** Supply less hay less demand. Null when it cannot honestly be struck. */
  balanceLbDm: number | null;
  balanceAum: number | null;
  gap: BalanceGap;
  availabilityRows: ForageAvailability[];
  demandRows: ForageDemand[];
  removals: ForageRemoval[];
}

/**
 * Strike the balance.
 *
 * Rows net against each other when they share a **unit and an exact period
 * window**. Overlapping-but-different windows are deliberately not
 * apportioned: splitting a June figure across two half-June windows means
 * assuming growth is even through the month, which is precisely the
 * assumption a grazier would dispute. Mismatched windows show up as their own
 * lines with a gap named on them, which is visible and fixable, rather than
 * silently blended.
 */
export function forageBalance(input: {
  paddocks: Paddock[];
  availability: ForageAvailability[];
  demand: ForageDemand[];
  removals?: ForageRemoval[];
  planDefaultDmiPctBw?: number | null;
}): BalanceLine[] {
  const { paddocks, availability, demand, removals = [], planDefaultDmiPctBw = null } = input;
  const nameOf = new Map(paddocks.map((p) => [p.id, p.name]));
  const byId = new Map(paddocks.map((p) => [p.id, p]));

  const lines = new Map<string, BalanceLine>();
  const touch = (paddockId: string | null, p: { periodStart: string; periodEnd: string; periodLabel: string | null }) => {
    const key = `${paddockId ?? "farm"}|${periodKey(p)}`;
    let line = lines.get(key);
    if (line === undefined) {
      line = {
        paddockId,
        paddockName: paddockId === null ? null : (nameOf.get(paddockId) ?? null),
        period: { start: p.periodStart, end: p.periodEnd, label: p.periodLabel },
        supplyLbDm: null, supplyAum: null, hayLbDm: null,
        demandLbDm: null, demandAum: null,
        balanceLbDm: null, balanceAum: null, gap: null,
        availabilityRows: [], demandRows: [], removals: [],
      };
      lines.set(key, line);
    }
    // A label on any row in the window names the window.
    if (line.period.label === null && p.periodLabel !== null) line.period.label = p.periodLabel;
    return line;
  };

  const add = (a: number | null, b: number | null): number | null =>
    a === null && b === null ? null : (a ?? 0) + (b ?? 0);

  for (const row of availability) {
    const line = touch(row.paddockId, row);
    line.availabilityRows.push(row);
    line.supplyLbDm = add(line.supplyLbDm, supplyLbDm(row, byId.get(row.paddockId) ?? null));
    line.supplyAum = add(line.supplyAum, row.aum);
  }

  for (const row of demand) {
    const line = touch(row.paddockId, row);
    line.demandRows.push(row);
    line.demandLbDm = add(line.demandLbDm, demandLbDm(row, planDefaultDmiPctBw));
    line.demandAum = add(line.demandAum, row.demandAum);
  }

  // Hay lands in every window it falls inside, on the unit it came off.
  for (const line of lines.values()) {
    if (line.paddockId === null) continue;
    const cut = removals.filter(
      (r) => r.paddockId === line.paddockId && inPeriod(r.removedOn, line.period.start, line.period.end),
    );
    if (cut.length === 0) continue;
    line.removals = cut;
    const weighed = cut.filter((r) => r.yieldLb !== null);
    line.hayLbDm = weighed.length === 0 ? null : weighed.reduce((s, r) => s + r.yieldLb!, 0);
  }

  for (const line of lines.values()) {
    if (line.supplyLbDm !== null && line.demandLbDm !== null) {
      line.balanceLbDm = line.supplyLbDm - (line.hayLbDm ?? 0) - line.demandLbDm;
    }
    if (line.supplyAum !== null && line.demandAum !== null) {
      line.balanceAum = line.supplyAum - line.demandAum;
    }
    if (line.balanceLbDm !== null || line.balanceAum !== null) {
      line.gap = null;
      continue;
    }

    // The gap turns on whether a row was *entered*, not on whether a figure
    // came out of it. A demand row with head but no weight is not "nothing
    // recorded about what is eating it" — it is a row somebody started and
    // did not finish, and telling them the first would send them to add a
    // second one.
    const hasSupply = line.availabilityRows.length > 0;
    const hasDemand = line.demandRows.length > 0;

    if (!hasSupply && hasDemand) line.gap = "no-supply";
    else if (hasSupply && !hasDemand) line.gap = "no-demand";
    else if (
      hasSupply &&
      hasDemand &&
      (line.supplyLbDm !== null || line.supplyAum !== null) &&
      (line.demandLbDm !== null || line.demandAum !== null)
    ) {
      // Both sides produced a figure, and they still did not net — so the
      // figures are in different units.
      line.gap = "different-units";
    } else line.gap = "incomplete";
  }

  return [...lines.values()].sort(
    (a, b) =>
      a.period.start.localeCompare(b.period.start) ||
      (a.paddockName ?? "").localeCompare(b.paddockName ?? ""),
  );
}

/** How the gap reads on screen. Plain sentences, because the point is to get
 * the missing figure entered rather than to label the row an error. */
export function gapInWords(gap: BalanceGap): string | null {
  switch (gap) {
    case "no-supply":
      return "Nothing recorded about what is there to eat in this window.";
    case "no-demand":
      return "Nothing recorded about what is eating it in this window.";
    case "different-units":
      return "One side is in pounds and the other in AUM. Netting them needs an assumption about what an animal unit eats in a month, which is yours to make, not this app's.";
    case "incomplete":
      return "Not enough on the rows to work a figure out — usually a demand row with head but no weight, or no intake rate on the row or the plan.";
    default:
      return null;
  }
}

/** Days of feed the balance represents, when there is a daily demand to
 * divide by. The figure a grazier actually wants: not "surplus 12,000 lb"
 * but "about a fortnight". */
export function daysOfFeed(line: BalanceLine, planDefaultDmiPctBw: number | null): number | null {
  if (line.balanceLbDm === null || line.balanceLbDm <= 0) return null;
  const daily = line.demandRows.reduce<number | null>((sum, row) => {
    const total = demandLbDm(row, planDefaultDmiPctBw);
    if (total === null) return sum;
    const days = periodDays(row.periodStart, row.periodEnd);
    return days <= 0 ? sum : (sum ?? 0) + total / days;
  }, null);
  return daily === null || daily <= 0 ? null : line.balanceLbDm / daily;
}
