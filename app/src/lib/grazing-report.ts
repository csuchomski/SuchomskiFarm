import { stripAcres, type GrazingEvent, type GrazingGroup, type Paddock } from "./grazing";

/**
 * The 528 payment record: the farm's own moves, in the shape of the form the
 * conservationist hands out.
 *
 * The form's columns are Pasture or Paddock #, Acres, Livestock (Type and
 * Number), Date In, Forage Height in Inches, Date Out, Forage Height in
 * Inches. Every one of them is already recorded against a move — the module
 * has been collecting this all along without knowing what shape it would be
 * asked for.
 *
 * Nothing here decides whether the record satisfies anything. It lays out what
 * happened; whether that meets the standard is the conservationist's call.
 */

export interface ReportRow {
  eventId: string;
  /** `P4-3`: the third strip taken out of Paddock 4. See `stripNumbers`. */
  number: string;
  paddockId: string;
  paddockName: string;
  acres: number | null;
  livestockType: string | null;
  headCount: number | null;
  dateIn: string;
  heightInEntry: number | null;
  dateOut: string | null;
  heightOutExit: number | null;
  sweptFrom: number | null;
  sweptTo: number | null;
}

const dayOf = (iso: string): string => iso.slice(0, 10);

/**
 * A number for every strip on the farm, stable for good.
 *
 * Counted per paddock over the *whole* record rather than within the report's
 * window, so P4-3 is P4-3 in every report that contains it. Numbering within
 * the range would have been simpler and would have meant the same strip
 * carried different numbers on two overlapping printouts — which is the sort
 * of thing that makes a reviewer stop trusting the pile.
 *
 * Ties are broken by id so two moves entered at the same instant do not swap
 * places between one render and the next.
 */
export function stripNumbers(
  events: GrazingEvent[],
  paddocks: Paddock[],
): Map<string, string> {
  const codeOf = new Map(paddocks.map((p) => [p.id, p.code ?? p.name]));
  const byPaddock = new Map<string, GrazingEvent[]>();

  for (const e of events) {
    const list = byPaddock.get(e.paddockId);
    if (list) list.push(e);
    else byPaddock.set(e.paddockId, [e]);
  }

  const out = new Map<string, string>();
  for (const [paddockId, list] of byPaddock) {
    const code = codeOf.get(paddockId) ?? "?";
    list
      .slice()
      .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt) || a.id.localeCompare(b.id))
      .forEach((e, i) => out.set(e.id, `${code}-${i + 1}`));
  }
  return out;
}

/**
 * Whether a strip belongs in a window.
 *
 * Overlap, not "went in during". A mob that walked onto a strip in March and
 * came off in April is part of April's record — it is grazing that happened in
 * April — and a record that dropped it would understate the month. A strip
 * still open has no end, so it overlaps everything from its start onwards.
 */
export function overlaps(event: GrazingEvent, from: string, to: string): boolean {
  const start = dayOf(event.enteredAt);
  const end = event.exitedAt === null ? null : dayOf(event.exitedAt);
  if (start > to) return false;
  return end === null || end >= from;
}

/** How the form wants the livestock described: what they are, in a word. */
export function livestockType(group: GrazingGroup | null): string | null {
  if (group === null) return null;
  const kind = group.species ?? null;
  const klass = group.class ?? null;
  if (kind === null && klass === null) return null;
  const words = [kind, klass].filter((w): w is string => w !== null);
  const joined = words.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export function reportRows(input: {
  events: GrazingEvent[];
  paddocks: Paddock[];
  groups: GrazingGroup[];
  from: string;
  to: string;
}): ReportRow[] {
  const { events, paddocks, groups, from, to } = input;
  const numbers = stripNumbers(events, paddocks);
  const paddockById = new Map(paddocks.map((p) => [p.id, p]));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  return events
    .filter((e) => overlaps(e, from, to))
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt) || a.id.localeCompare(b.id))
    .map((e): ReportRow => {
      const paddock = paddockById.get(e.paddockId) ?? null;
      return {
        eventId: e.id,
        number: numbers.get(e.id) ?? "—",
        paddockId: e.paddockId,
        paddockName: paddock?.name ?? "Not on file",
        acres: paddock === null ? null : stripAcres(e, paddock),
        livestockType: livestockType(groupById.get(e.groupId) ?? null),
        headCount: e.headCount,
        dateIn: dayOf(e.enteredAt),
        heightInEntry: e.forageHeightInEntry,
        dateOut: e.exitedAt === null ? null : dayOf(e.exitedAt),
        heightOutExit: e.residualHeightInExit,
        sweptFrom: e.sweptFrom,
        sweptTo: e.sweptTo,
      };
    });
}

/** Acres grazed in the window, for the foot of the table. Strips that could
 *  not be measured are left out of the sum rather than counted as nothing. */
export function totalAcres(rows: ReportRow[]): { acres: number; measured: number; missing: number } {
  let acres = 0;
  let measured = 0;
  let missing = 0;
  for (const r of rows) {
    if (r.acres === null) missing += 1;
    else {
      acres += r.acres;
      measured += 1;
    }
  }
  return { acres, measured, missing };
}

/**
 * What the record does not say, listed plainly.
 *
 * A form handed over with silent gaps is worse than one that names them: the
 * farm can go and fill them in, and a reviewer can see the difference between
 * "nothing happened" and "nothing was written down".
 */
export function gaps(rows: ReportRow[]): string[] {
  const out: string[] = [];
  const noHeightIn = rows.filter((r) => r.heightInEntry === null).length;
  const noHeightOut = rows.filter((r) => r.heightOutExit === null && r.dateOut !== null).length;
  const stillOn = rows.filter((r) => r.dateOut === null).length;
  const noHead = rows.filter((r) => r.headCount === null).length;

  if (noHeightIn > 0) out.push(`${noHeightIn} without a forage height going in`);
  if (noHeightOut > 0) out.push(`${noHeightOut} left without a height coming off`);
  if (noHead > 0) out.push(`${noHead} without a head count`);
  if (stillOn > 0) out.push(`${stillOn} still open — no date out yet`);
  return out;
}
