import type { RealAnimal } from "./herd";
import type { RealLactation } from "./lactations";
import type { Calving } from "./repro";
import type { Breeding } from "./breedings";
import type { Disposition } from "./dispositions";
import { formatMoney } from "./sires";

/**
 * What a cow has done, in the order she did it.
 *
 * Her record held all of this already — calvings in one table, lactations in
 * another, services in a third — and showed none of it as a life. You could
 * read that she had two lactations and one calf without ever seeing that the
 * calf came first and the second lactation is the one she is in now.
 *
 * **Services are grouped by the calving they led to.** A cow served three
 * times before she held is three rows in `breeding_events` and one event in
 * her life; drawn separately they crowd out the calvings, which are the
 * things that actually happened.
 *
 * **The end is always drawn, even when it hasn't happened.** An animal on
 * the farm gets an open step saying nothing is recorded — the alternative is
 * a timeline that simply stops, which reads as missing data rather than as a
 * cow who is still here.
 */

export type LifeKind = "born" | "service" | "calving" | "lactation" | "gone" | "open";

export interface LifeEvent {
  key: string;
  /** The day it happened. Empty only for the open final step. */
  date: string;
  /** Set on a lactation that has ended, so the step can read as a span. */
  endDate: string | null;
  kind: LifeKind;
  title: string;
  detail: string;
  /** The step she is living now. At most one is true. */
  current: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `9 Jul 2024`, from an ISO day, without going through a Date and a
 *  timezone that could move it. */
export function lifeDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)} ${month} ${y}` : iso;
}

/** Whole days between two ISO days, for "15 days in milk". Calendar
 *  arithmetic, so a daylight-saving boundary can't shave a day off. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.round((end - start) / 86400000));
}

/** Whole months between two ISO days, for "24 months, then dried off". */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

const spanLabel = (from: string, to: string): string => {
  const months = monthsBetween(from, to);
  if (months >= 24) return `${months} months`;
  if (months >= 1) return `${months} month${months === 1 ? "" : "s"}`;
  return "under a month";
};

export function buildLife(input: {
  animal: RealAnimal;
  calvings: Calving[];
  lactations: RealLactation[];
  breedings: Breeding[];
  /** Everything out of her, so a calving can name the calf it produced. */
  offspring: RealAnimal[];
  /** How she left, when it has been recorded. Her status says only *that*
   *  she is gone; this is the day and the reason. */
  disposition?: Disposition | null;
  today: string;
}): LifeEvent[] {
  const { animal, today } = input;
  const events: LifeEvent[] = [];
  // Read up here because it decides more than the last step: a cow with a
  // departure on file is not in milk, whatever her lactation row says.
  const gone = input.disposition ?? null;

  const calvings = input.calvings
    .filter((c) => c.dam_id === animal.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const lactations = input.lactations
    .filter((l) => l.animal_id === animal.id)
    .sort((a, b) => a.fresh_date.localeCompare(b.fresh_date));
  const services = input.breedings
    .filter((b) => b.animal_id === animal.id && !b.voided)
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── born ───────────────────────────────────────────────────────────
  events.push({
    key: "born",
    date: animal.birth_date,
    endDate: null,
    kind: "born",
    title: "Born",
    detail: animal.origin === "born here" ? "On this farm" : "Bought in",
    current: false,
  });

  // ── services, one step per run of them ─────────────────────────────
  //
  // Grouped by the calving that follows: everything served before her first
  // calving is one attempt at that calf, however many straws it took.
  const groups: Breeding[][] = [];
  for (const service of services) {
    const boundary = calvings.find((c) => c.date > service.date)?.date ?? "";
    const last = groups[groups.length - 1];
    const lastBoundary =
      last === undefined
        ? null
        : (calvings.find((c) => c.date > last[0].date)?.date ?? "");
    if (last !== undefined && lastBoundary === boundary) last.push(service);
    else groups.push([service]);
  }

  groups.forEach((group, i) => {
    const first = group[0];
    const extra = group.length - 1;
    events.push({
      key: `service-${first.id}`,
      date: first.date,
      endDate: null,
      kind: "service",
      title: i === 0 ? "First service" : "Served",
      detail:
        extra === 0
          ? (first.method || "served").toUpperCase()
          : `${group.length} services · last ${lifeDate(group[group.length - 1].date)}`,
      current: false,
    });
  });

  // ── calvings ───────────────────────────────────────────────────────
  calvings.forEach((calving, i) => {
    const calf = input.offspring.find((o) => o.birth_date === calving.date);
    const named = calf ? (calf.barn_name ?? `tag ${calf.ear_tag}`) : null;
    const sex = calf ? (calf.sex === "female" ? "a heifer" : "a bull calf") : null;
    events.push({
      key: `calving-${calving.id}`,
      date: calving.date,
      endDate: null,
      kind: "calving",
      title: i === 0 ? "First calf" : `Calf ${i + 1}`,
      detail: named ? [named, sex].filter(Boolean).join(", ") : calving.is_twin ? "Twins" : "No calf on file",
      current: false,
    });
  });

  // ── lactations ─────────────────────────────────────────────────────
  for (const lactation of lactations) {
    const running = lactation.dry_off_date === null && animal.status === "active" && gone === null;
    events.push({
      key: `lactation-${lactation.id}`,
      date: lactation.fresh_date,
      endDate: lactation.dry_off_date,
      kind: "lactation",
      title: `Lactation ${lactation.lactation_number}`,
      detail: running
        ? "Fresh · she is here now"
        : lactation.dry_off_date
          ? `${spanLabel(lactation.fresh_date, lactation.dry_off_date)}, then dried off`
          : "No dry-off recorded",
      current: running,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  // ── how it ended, or that it hasn't ────────────────────────────────
  //
  // A recorded disposition is the honest version: the day she actually left
  // and how. Without one there is only her status, which says that she is
  // gone and nothing else — so the step is dated today, which is a lie the
  // step has to own up to rather than state.
  if (gone) {
    events.push({
      key: "gone",
      date: gone.date,
      endDate: null,
      kind: "gone",
      title: EXIT_TITLES[gone.exitChannel] ?? "Left the farm",
      detail: goneDetail(gone),
      current: false,
    });
  } else if (animal.status === "active") {
    events.push({
      key: "open",
      date: "",
      endDate: null,
      kind: "open",
      title: "Sold or processed",
      detail: "Nothing recorded",
      current: false,
    });
  } else {
    events.push({
      key: "gone",
      date: today,
      endDate: null,
      kind: "gone",
      title: STATUS_TITLES[animal.status] ?? "Left the farm",
      // Her status is the only thing on file, and it carries no date. Saying
      // so beats printing today's as though it were the day she went.
      detail: "Off the farm — the day isn't recorded",
      current: false,
    });
  }

  return events;
}

/** What the exit channel is called on a timeline. The five `exit_channel`
 *  allows, in the farm's words rather than the column's. */
const EXIT_TITLES: Record<string, string> = {
  sold_live: "Sold",
  processed: "To a processor",
  died_on_farm: "Died",
  leased_out: "Leased out",
  transferred: "Transferred",
};

/** Her status, for an animal marked gone before there was anywhere to record
 *  how. `died` — not `dead`, which is not one of the values the column
 *  allows and never matched. */
const STATUS_TITLES: Record<string, string> = {
  sold: "Sold",
  culled: "Culled",
  processed: "To a processor",
  died: "Died",
  leased_out: "Leased out",
};

function goneDetail(gone: Disposition): string {
  const parts: string[] = [];
  if (gone.isCull) parts.push("Culled");
  if (gone.sale) {
    const who = gone.sale.buyerName.trim();
    parts.push(who === "" ? "Sold" : who);
    if (gone.sale.netCents > 0) parts.push(`${formatMoney(gone.sale.netCents)} net`);
  }
  if (parts.length === 0) parts.push("Off the farm");
  return parts.join(" · ");
}
