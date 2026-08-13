import { daysBetween, type GrazingPlan, type KeyArea, type MonitoringRecord } from "./grazing";

/**
 * When monitoring is due.
 *
 * "Due", never "overdue" and never "non-compliant". The cadence is the farm's
 * own, written into its plan; this arithmetic says how long it has been and
 * what the plan asked for, and stops there. Whether a gap matters is the
 * conservationist's call.
 *
 * Every figure comes from the plan. There is no default cadence here, because
 * a default would be this app inventing a monitoring recommendation — and a
 * farm with no plan gets silence rather than a number somebody would then have
 * to argue with.
 */

export type DueState =
  /** The plan says nothing about how often, so nothing is claimed. */
  | { state: "no-cadence" }
  /** Never looked at. Not the same as "late" — there is no interval to be
   * late against yet. */
  | { state: "never" }
  | { state: "ok"; lastOn: string; daysSince: number; everyDays: number | null }
  | { state: "due"; lastOn: string; daysSince: number; everyDays: number | null };

/**
 * How many days the plan's cadence works out to.
 *
 * `every_rotation` has no fixed number of days — a rotation is as long as it
 * is — so it returns null and the caller falls back to counting rounds.
 */
export function cadenceDays(plan: GrazingPlan | null): number | null {
  if (plan === null || plan.monitoringCadenceValue === null) return null;
  switch (plan.monitoringCadenceKind) {
    case "every_n_days":
      return plan.monitoringCadenceValue > 0 ? plan.monitoringCadenceValue : null;
    case "times_per_season": {
      if (plan.periodStart === null || plan.periodEnd === null) return null;
      const season = daysBetween(plan.periodStart, plan.periodEnd) + 1;
      const times = plan.monitoringCadenceValue;
      return season > 0 && times > 0 ? season / times : null;
    }
    default:
      return null;
  }
}

/**
 * Whether a key area is due a look.
 *
 * `roundsSince` is how many trips through the farm have happened since the
 * last record, and is only consulted for an `every_rotation` cadence — where
 * the answer is a count of rounds rather than a count of days.
 */
export function monitoringDue(input: {
  keyAreaId: string;
  records: MonitoringRecord[];
  plan: GrazingPlan | null;
  nowIso: string;
  roundsSince?: (lastOn: string) => number;
}): DueState {
  const { keyAreaId, records, plan, nowIso, roundsSince } = input;

  const mine = records
    .filter((r) => r.keyAreaId === keyAreaId)
    .map((r) => r.observedOn)
    .sort();
  const lastOn = mine[mine.length - 1];

  const everyDays = cadenceDays(plan);
  const byRotation = plan?.monitoringCadenceKind === "every_rotation";

  if (plan === null || (everyDays === null && !byRotation)) {
    return lastOn === undefined ? { state: "no-cadence" } : { state: "no-cadence" };
  }
  if (lastOn === undefined) return { state: "never" };

  const daysSince = daysBetween(lastOn, nowIso);

  if (byRotation) {
    const rounds = roundsSince?.(lastOn) ?? 0;
    return rounds >= 1
      ? { state: "due", lastOn, daysSince, everyDays: null }
      : { state: "ok", lastOn, daysSince, everyDays: null };
  }

  return daysSince >= everyDays!
    ? { state: "due", lastOn, daysSince, everyDays }
    : { state: "ok", lastOn, daysSince, everyDays };
}

/** How the cadence reads on screen, in the plan's own terms. */
export function cadenceInWords(plan: GrazingPlan | null): string | null {
  if (plan === null || plan.monitoringCadenceValue === null) return null;
  const n = plan.monitoringCadenceValue;
  switch (plan.monitoringCadenceKind) {
    case "every_rotation":
      return "every rotation";
    case "every_n_days":
      return `every ${n} day${n === 1 ? "" : "s"}`;
    case "times_per_season":
      return `${n} time${n === 1 ? "" : "s"} a season`;
    default:
      return null;
  }
}

/**
 * Ground cover, litter and bare ground should account for the whole surface.
 *
 * Returned as an observation rather than enforced: a reading is what somebody
 * saw, and refusing to save 97% would lose the reading to protect a sum. The
 * page shows the total and leaves it alone.
 */
export function coverTotal(record: MonitoringRecord): number | null {
  const parts = [record.groundCoverPct, record.litterPct, record.bareGroundPct];
  return parts.every((p) => p === null) ? null : parts.reduce<number>((s, p) => s + (p ?? 0), 0);
}

/** Key areas that have never been recorded against, which is the list worth
 * acting on when a plan is first written. */
export function neverObserved(keyAreas: KeyArea[], records: MonitoringRecord[]): KeyArea[] {
  const seen = new Set(records.map((r) => r.keyAreaId));
  return keyAreas.filter((k) => k.active && !seen.has(k.id));
}

/**
 * A photo series is only a series if it is the same spot on the same bearing.
 *
 * Without both, successive photographs are just pictures of grass — you cannot
 * tell change in the sward from a change in where somebody stood. This says
 * which half is missing so it can be filled in.
 */
export function photoPointGaps(area: KeyArea): string[] {
  const gaps: string[] = [];
  if (area.latitude === null || area.longitude === null) gaps.push("no location");
  if (area.photoAzimuthDeg === null) gaps.push("no bearing");
  return gaps;
}
