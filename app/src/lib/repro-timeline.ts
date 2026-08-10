import {
  addDays,
  daysBetween,
  dueDate,
  likelyService,
  type Calving,
  type CalfOutcome,
  type PregnancyCheck,
} from "./repro";
import { sireLabel, isActive as breedingStands, type Breeding } from "./breedings";
import type { RealLactation } from "./lactations";

/**
 * Her breeding record, assembled into rows that compare.
 *
 * The Breedings page is a flat list of services across the whole herd, which
 * answers "what did we do lately" and nothing else. The question a cow's
 * record has to answer is different: how long did she take to get back in
 * calf, is this season going better or worse than the last one, and what is
 * outstanding right now.
 *
 * Rows are seasons: every row starts the day she calved, so day 84 in one row
 * and day 84 in the next are the same point in her cycle and the columns line
 * up. That is what makes days-open comparable between them.
 *
 * A calendar-year reading was built alongside it, from the same mockup, and
 * removed on 2026-08-10. It laid the same events on Jan–Dec with pregnancies
 * clipped at the year break — correct, and not a question anyone asks about a
 * cow. What you want to know is how this season compares to the last one.
 *
 * Everything here is pure. Positions are days, not percentages; turning a
 * day into a percentage is the component's job, because it depends on the
 * axis it drew.
 */

// ─── shapes ────────────────────────────────────────────────────────────

/** What the checks said about a service, in the order they said it. */
export type ServiceOutcome = "pregnant" | "open" | "recheck" | "aborted" | "unchecked";

export interface Service {
  id: string;
  date: string;
  /** Days from the row's day 0. */
  day: number;
  /** "AI · Dutton", "Bull · Rook" — from lib/breedings so it matches the list. */
  sire: string;
  outcome: ServiceOutcome;
  /** "open", "recheck → open", "not checked yet" — the whole check story. */
  checkStory: string;
  /** When the last check on this service was. Null while it's unchecked. */
  lastCheckOn: string | null;
  /** True for the service that produced the calving (or the standing
   * pregnancy). Drawn solid; the others are drawn hollow. */
  conceived: boolean;
}

export interface Ending {
  calvingId: string;
  on: string;
  day: number;
  isTwin: boolean;
  /** "Twins", "Bull calf", "Heifer calf" — the headline. */
  headline: string;
  /** "live heifer Bess · one stillborn" — the calves, named where they live. */
  detail: string;
}

/** Why a row starts where it does. A calving is the real anchor; the others
 * are what's left when she hasn't calved here yet. */
export type Anchor = "calving" | "first-service" | "birth";

export interface Season {
  key: string;
  /** "Season 2", or "Before her first calving" for a maiden row. */
  title: string;
  anchor: Anchor;
  startsOn: string;
  lactationNumber: number | null;
  services: Service[];
  /** The service that took, if one did. */
  conception: Service | null;
  /** The calving that closed this season. Null while it's still running. */
  ending: Ending | null;
  /** Calving to conception. Null on a row with no calving to measure from —
   * days open is defined from a calving, and inventing a zero would put a
   * maiden heifer at the top of every "best cows" ordering. */
  daysOpen: number | null;
  /** Calving to calving. Null on the open row. */
  intervalDays: number | null;
  /** How far into this row today is, on the open row only. */
  runningDays: number | null;
  /** Where the current pregnancy is expected to end, if she's carrying. */
  dueOn: string | null;
  /** The whole row's width in days — its own length, not the shared axis. */
  lengthDays: number;
}

export interface TimelineInput {
  animal: { id: string; birth_date: string };
  calvings: Calving[];
  outcomes: CalfOutcome[];
  breedings: Breeding[];
  checks: PregnancyCheck[];
  lactations: RealLactation[];
  /** Animal id → what to call it. Sires and live calves are named through it. */
  names: Map<string, string>;
  /** Hers, resolved through her breeds. Null when nothing on file gives one. */
  gestationDays: number | null;
  voluntaryWaitDays: number | null;
  today: string;
}

// ─── the check story ───────────────────────────────────────────────────

const RESULT_WORD: Record<string, string> = {
  pregnant: "pregnant",
  open: "open",
  recheck: "recheck",
  aborted: "aborted",
};

/**
 * What the checks said, in order, collapsed to the distinct results.
 *
 * "recheck → open" rather than "recheck, recheck, open": the repetition is
 * noise, but the sequence is the point — it says the answer changed.
 */
export function checkStory(checks: PregnancyCheck[]): {
  outcome: ServiceOutcome;
  story: string;
  lastCheckOn: string | null;
} {
  if (checks.length === 0) return { outcome: "unchecked", story: "not checked yet", lastCheckOn: null };

  const ordered = [...checks].sort((a, b) => a.date.localeCompare(b.date));
  const words: string[] = [];
  for (const c of ordered) {
    const word = RESULT_WORD[c.result] ?? c.result;
    if (words[words.length - 1] !== word) words.push(word);
  }
  const last = ordered[ordered.length - 1];
  const outcome = (RESULT_WORD[last.result] ? last.result : "unchecked") as ServiceOutcome;
  return { outcome, story: words.join(" → "), lastCheckOn: last.date };
}

// ─── seasons ───────────────────────────────────────────────────────────

const byDateAsc = <T extends { date: string }>(rows: T[]) => [...rows].sort((a, b) => a.date.localeCompare(b.date));

function describeEnding(calving: Calving, outcomes: CalfOutcome[], names: Map<string, string>, day: number): Ending {
  const mine = outcomes.filter((o) => o.calving_id === calving.id);
  const live = mine.filter((o) => o.outcome === "live");

  const sexWord = (s: string) => (s === "female" ? "heifer" : s === "male" ? "bull" : "calf");
  const headline = calving.is_twin
    ? "Twins"
    : mine.length === 0
      ? "Calved"
      : live.length > 0
        ? `${sexWord(live[0].sex)} calf`
        : `${sexWord(mine[0].sex)} ${mine[0].outcome.replace(/_/g, " ")}`;

  const detail = mine
    .map((o) => {
      const named = o.calf_animal_id ? names.get(o.calf_animal_id) : undefined;
      return o.outcome === "live"
        ? `live ${sexWord(o.sex)}${named ? ` ${named}` : ""}`
        : `one ${o.outcome.replace(/_/g, " ")}`;
    })
    .join(" · ");

  return {
    calvingId: calving.id,
    on: calving.date,
    day,
    isTwin: calving.is_twin,
    // Capitalise the headline without touching "Twins" or a sex word mid-string.
    headline: headline.charAt(0).toUpperCase() + headline.slice(1),
    detail,
  };
}

/**
 * Her record as seasons — one row per calving, plus the row she's in now.
 *
 * A season runs from one calving to the next, so day 0 is always a calving
 * and the rows compare directly. Services logged before her first calving
 * can't belong to any of those rows, and they're the whole record for a cow
 * who hasn't calved here yet, so they get a row of their own anchored on the
 * first service.
 */
export function toSeasons(input: TimelineInput): Season[] {
  const { animal, names, gestationDays, today } = input;

  const calvings = byDateAsc(input.calvings.filter((c) => c.dam_id === animal.id));
  const services = byDateAsc(input.breedings.filter((b) => b.animal_id === animal.id && breedingStands(b)));
  const checks = input.checks.filter((c) => c.animal_id === animal.id);
  const lactations = input.lactations.filter((l) => l.animal_id === animal.id);

  const checksFor = (serviceId: string) => checks.filter((c) => c.breeding_event_id === serviceId);

  /** The lactation that opened on this calving — by its link if it has one,
   * otherwise by the date, which is how freshening writes it. */
  const lactationFor = (calving: Calving | null): number | null => {
    if (!calving) return null;
    const linked = lactations.find((l) => l.calving_id === calving.id);
    if (linked) return linked.lactation_number;
    const sameDay = lactations.find((l) => l.fresh_date === calving.date);
    return sameDay ? sameDay.lactation_number : null;
  };

  const rows: Season[] = [];

  const build = (
    key: string,
    title: string,
    anchor: Anchor,
    startsOn: string,
    startedBy: Calving | null,
    endedBy: Calving | null,
  ): Season => {
    const upTo = endedBy ? endedBy.date : null;
    const mine = services.filter((s) => s.date >= startsOn && (upTo === null || s.date < upTo));

    const built: Service[] = mine.map((s) => {
      const { outcome, story, lastCheckOn } = checkStory(checksFor(s.id));
      return {
        id: s.id,
        date: s.date,
        day: daysBetween(startsOn, s.date),
        sire: sireLabel(s, s.sire_id ? names.get(s.sire_id) : undefined),
        outcome,
        checkStory: story,
        lastCheckOn,
        conceived: false,
      };
    });

    // Which service took. A calving names it outright since migration 030;
    // an open season falls back to the last one a check called pregnant,
    // and a later open or aborted check on a *later* service doesn't unsay it.
    let conception: Service | null = null;
    if (endedBy?.breeding_event_id) {
      conception = built.find((s) => s.id === endedBy.breeding_event_id) ?? null;
    }
    if (!conception) {
      conception = [...built].reverse().find((s) => s.outcome === "pregnant") ?? null;
    }
    if (conception) conception.conceived = true;

    const ending = endedBy ? describeEnding(endedBy, input.outcomes, names, daysBetween(startsOn, endedBy.date)) : null;

    const carryingDue = conception && !ending ? dueDate(conception.date, gestationDays) : null;
    const lastDay = ending
      ? ending.day
      : Math.max(
          daysBetween(startsOn, today),
          carryingDue ? daysBetween(startsOn, carryingDue) : 0,
          built.length > 0 ? built[built.length - 1].day : 0,
        );

    return {
      key,
      title,
      anchor,
      startsOn,
      lactationNumber: lactationFor(startedBy),
      services: built,
      conception,
      ending,
      daysOpen: anchor === "calving" && conception ? conception.day : null,
      intervalDays: ending ? ending.day : null,
      runningDays: ending ? null : daysBetween(startsOn, today),
      dueOn: carryingDue,
      lengthDays: Math.max(lastDay, 1),
    };
  };

  // The maiden row: services before her first calving. Present for a cow who
  // has never calved here, and for one whose first calving followed services
  // we logged.
  const firstCalving = calvings[0] ?? null;
  const beforeFirst = services.filter((s) => firstCalving === null || s.date < firstCalving.date);
  if (beforeFirst.length > 0) {
    rows.push(
      build(
        "maiden",
        firstCalving ? "Before her first calving" : "First season",
        "first-service",
        beforeFirst[0].date,
        null,
        firstCalving,
      ),
    );
  }

  calvings.forEach((calving, i) => {
    const next = calvings[i + 1] ?? null;
    rows.push(build(calving.id, `Season ${i + 1}`, "calving", calving.date, calving, next));
  });

  // Nothing at all on file. One empty row anchored on her birth, so the page
  // shows an axis and a prompt rather than a blank — she has a record, it's
  // just that nothing has happened in it.
  if (rows.length === 0) {
    rows.push(build("empty", "Nothing logged yet", "birth", animal.birth_date, null, null));
  }

  return rows;
}

/**
 * The shared axis for a set of rows.
 *
 * Rows are only comparable if they're drawn on one clock, so the axis is the
 * longest row rounded up — never the row's own length, which would make a
 * 380-day season and a 420-day season look identical. 400 days is the floor
 * because that's a normal season and a shorter axis would exaggerate it.
 */
export function axisDays(seasons: Season[]): number {
  const longest = seasons.reduce((max, s) => Math.max(max, s.lengthDays), 0);
  return Math.max(400, Math.ceil((longest + 20) / 50) * 50);
}

/** Where a day sits on the axis, as a percentage, clamped into the box. */
export const atDay = (day: number, axis: number): number => Math.max(0, Math.min(100, (day / axis) * 100));

// ─── a calf on file that no calving accounts for ───────────────────────

export interface UntiedCalf {
  animalId: string;
  name: string;
  bornOn: string;
  /** The service whose due date lands nearest her birth, when one does. */
  serviceId: string | null;
  /** Days between that service's due date and the birth. Null without one. */
  daysOff: number | null;
}

/**
 * Calves on file, out of her, that no calving accounts for.
 *
 * This exists because the pedigree link and the calving link are different
 * things and only the second one closes a season. Abigail was recorded as
 * Martha's daughter in August 2026 and there was no calving anywhere in the
 * database, so Martha's page went on reporting her overdue with the calf
 * standing next to her. Everything needed to notice that was already on file
 * — a daughter, a birth date, a confirmed pregnancy due six days later — and
 * nothing looked.
 *
 * It doesn't *infer* the tie. Recording a calving is a statement about what
 * happened, with an ease and an assistance only the farmer knows. This finds
 * the candidate and says so; the form does the rest.
 */
export function untiedCalves(
  input: TimelineInput,
  offspring: { id: string; dam_id: string | null; birth_date: string }[],
): UntiedCalf[] {
  const tied = new Set(
    input.outcomes.map((o) => o.calf_animal_id).filter((id): id is string => id !== null),
  );
  const services = input.breedings.filter((b) => b.animal_id === input.animal.id && breedingStands(b));

  return offspring
    .filter((c) => c.dam_id === input.animal.id && !tied.has(c.id))
    .sort((a, b) => b.birth_date.localeCompare(a.birth_date))
    .map((c) => {
      const fit = likelyService(c.birth_date, services, input.gestationDays);
      const expected = fit ? dueDate(fit.date, input.gestationDays) : null;
      return {
        animalId: c.id,
        name: input.names.get(c.id) ?? "a calf",
        bornOn: c.birth_date,
        serviceId: fit?.id ?? null,
        daysOff: expected ? daysBetween(expected, c.birth_date) : null,
      };
    });
}

/** "six days early", "on the day", "45 days late" — how a birth sat against
 *  the service's own arithmetic, in words rather than a signed integer. */
export function fitInWords(daysOff: number | null): string {
  if (daysOff === null) return "no due date to compare it against";
  if (daysOff === 0) return "on the day it was due";
  const n = Math.abs(daysOff);
  return `${n} day${n === 1 ? "" : "s"} ${daysOff < 0 ? "early" : "late"}`;
}

// ─── the summary line ──────────────────────────────────────────────────

export interface ReproSummary {
  calvings: number;
  services: number;
  /** Services per conception. Null until something has actually conceived —
   * a bare service count divided by zero is not "0.0 per conception". */
  perConception: number | null;
  /** Average calving interval across completed seasons. */
  averageInterval: number | null;
  /** Average days open across seasons that have both figures. */
  averageDaysOpen: number | null;
}

export function summarise(seasons: Season[]): ReproSummary {
  const services = seasons.reduce((n, s) => n + s.services.length, 0);
  const calvings = seasons.filter((s) => s.ending !== null).length;
  const conceptions = seasons.filter((s) => s.conception !== null).length;

  const intervals = seasons.map((s) => s.intervalDays).filter((d): d is number => d !== null);
  const opens = seasons.map((s) => s.daysOpen).filter((d): d is number => d !== null);
  const mean = (xs: number[]) => (xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

  return {
    calvings,
    services,
    perConception: conceptions === 0 ? null : Math.round((services / conceptions) * 10) / 10,
    averageInterval: mean(intervals),
    averageDaysOpen: mean(opens),
  };
}

/**
 * What's outstanding on the open season, in one sentence, or null when
 * nothing is. This is the line that earns the page a place on the record:
 * everything else is history.
 */
export function whatsNext(season: Season, input: { today: string; voluntaryWaitDays: number | null }): string | null {
  if (season.ending) return null;

  const last = season.services[season.services.length - 1] ?? null;

  if (season.conception && season.dueOn) {
    const away = daysBetween(input.today, season.dueOn);
    if (away < 0) return `Due ${season.dueOn} — ${-away} days ago, and no calving recorded.`;
    if (away === 0) return `Due today.`;
    return `Carrying — due ${season.dueOn}, ${away} days away.`;
  }

  if (last && last.outcome === "unchecked") {
    const since = daysBetween(last.date, input.today);
    return since >= 30
      ? `Bred ${since} days ago and not checked. A check would settle it.`
      : `Bred ${since} days ago. Too early to check.`;
  }

  if (last && (last.outcome === "open" || last.outcome === "aborted")) {
    return `Open since the check on ${last.lastCheckOn ?? last.date}. She's ready to breed again.`;
  }
  if (last && last.outcome === "recheck") {
    return `Her last check said recheck. Nothing is settled until it's repeated.`;
  }

  // Nothing tried yet this season.
  if (season.anchor === "calving" && input.voluntaryWaitDays !== null) {
    const readyOn = addDays(season.startsOn, input.voluntaryWaitDays);
    const away = daysBetween(input.today, readyOn);
    return away > 0
      ? `Not bred back yet — the waiting period is up ${readyOn}, ${away} days away.`
      : `Not bred back yet. The waiting period was up ${readyOn}.`;
  }
  return `Nothing logged for her yet.`;
}
