import { animalPath, fetchAnimals, herdOnly, type RealAnimal } from "./herd";
import { fetchBreedings, type Breeding } from "./breedings";
import { fetchBreeds, fetchComposition, fetchOverrides, gestationFor, type GestationInputs } from "./gestation";
import {
  daysBetween,
  fetchCalfOutcomes,
  fetchCalvings,
  fetchGestationDays,
  fetchPregnancyChecks,
  fetchVoluntaryWaitDays,
  type CalfOutcome,
  type Calving,
  type PregnancyCheck,
} from "./repro";
import { nextBreeding, toSeasons, untiedCalves, type BreedingStatus, type TimelineInput } from "./repro-timeline";

/**
 * Things that need attention, with the date they needed it.
 *
 * The app has been able to work all of this out for a while and never said
 * any of it out loud. Martha carried a confirmed pregnancy past her due date
 * with a daughter already on file, and the only place that noticed was her
 * own page — which you had to think to open. An alert is the difference
 * between a record that answers questions and one that asks them.
 *
 * Every rule here reads the same season assembly the timeline draws, through
 * `nextBreeding`, so a cow can't be "ready to breed" on one screen and
 * "carrying" on another.
 *
 * Nothing here is a notification. There is no email, no push, no cron — this
 * is a page and a panel that are right whenever you look at them. Sending
 * mail is a different problem with a different failure mode, and a list you
 * can trust is the thing that has to exist first.
 */

export type AlertKind =
  | "overdue"
  | "check-due"
  | "recheck"
  | "untied-calf"
  | "breed-back"
  | "due-soon";

/** How soon it wants dealing with. Drives ordering and the pill. */
export type Urgency = "now" | "soon" | "watch";

export interface Alert {
  id: string;
  kind: AlertKind;
  urgency: Urgency;
  animalId: string;
  animalName: string;
  earTag: string;
  /** The day it became due, or the day it will. */
  on: string;
  /** Positive when `on` has passed, negative when it hasn't. */
  daysLate: number;
  title: string;
  detail: string;
  /** Where to go to deal with it. */
  href: string;
}

/**
 * The thresholds, named and in one place.
 *
 * They are judgement calls, not arithmetic, which is exactly why they belong
 * somewhere a person can find and argue with rather than buried in three
 * different comparisons.
 */
export const RULES = {
  /** A service can be confirmed from about here — palpation or blood. */
  checkDueDays: 30,
  /** Past this with no check, it stops being "early days". */
  checkLateDays: 45,
  /** Far enough out to get her somewhere she can be watched. */
  dueSoonDays: 21,
  /** Past the waiting period by this much and it isn't a reminder any more. */
  breedBackLateDays: 21,
};

export interface AlertInputs {
  animals: RealAnimal[];
  calvings: Calving[];
  outcomes: CalfOutcome[];
  breedings: Breeding[];
  checks: PregnancyCheck[];
  gestation: GestationInputs;
  voluntaryWaitDays: number | null;
  today: string;
}

export async function fetchAlertInputs(farmId: string, today: string): Promise<AlertInputs> {
  const [animals, calvings, outcomes, breedings, checks, breeds, composition, overrides, bySpecies, wait] =
    await Promise.all([
      fetchAnimals(),
      fetchCalvings(farmId),
      fetchCalfOutcomes(farmId),
      fetchBreedings(farmId),
      fetchPregnancyChecks(farmId),
      fetchBreeds(farmId),
      fetchComposition(farmId),
      fetchOverrides(farmId),
      fetchGestationDays(),
      fetchVoluntaryWaitDays(),
    ]);

  return {
    animals,
    calvings,
    outcomes,
    breedings,
    checks,
    gestation: { breeds, composition, overrides, bySpecies },
    voluntaryWaitDays: wait,
    today,
  };
}

const nameOf = (a: RealAnimal) => a.barn_name?.trim() || (a.ear_tag ? `Tag ${a.ear_tag}` : "an unnamed animal");

/** The females this asks questions about: living, on the farm, past calf age. */
export function breedingFemales(animals: RealAnimal[]): RealAnimal[] {
  return herdOnly(animals).filter((a) => a.sex === "female" && a.status === "active" && a.class !== "calf");
}

/** Her record, in the shape the timeline assembles. */
export function timelineFor(animal: RealAnimal, input: AlertInputs): TimelineInput {
  return {
    animal,
    calvings: input.calvings,
    outcomes: input.outcomes,
    breedings: input.breedings,
    checks: input.checks,
    lactations: [],
    names: new Map(input.animals.map((a) => [a.id, nameOf(a)])),
    gestationDays: gestationFor(animal, input.gestation)?.days ?? null,
    voluntaryWaitDays: input.voluntaryWaitDays,
    today: input.today,
  };
}

/**
 * Where she is in her cycle, for the "Next breeding" column and for the
 * alerts below — the same call, so the two can't disagree.
 */
export function statusOf(animal: RealAnimal, input: AlertInputs) {
  const seasons = toSeasons(timelineFor(animal, input));
  const open = seasons[seasons.length - 1];
  return {
    season: open,
    breeding: nextBreeding(open, { today: input.today, voluntaryWaitDays: input.voluntaryWaitDays }),
  };
}

export function buildAlerts(input: AlertInputs): Alert[] {
  const out: Alert[] = [];
  const herd = breedingFemales(input.animals);

  for (const cow of herd) {
    const timeline = timelineFor(cow, input);
    const { breeding } = statusOf(cow, input);
    const base = {
      animalId: cow.id,
      animalName: nameOf(cow),
      earTag: cow.ear_tag,
      href: animalPath(cow),
    };

    // A calf on file that no calving accounts for. First, because it makes
    // every other figure for this cow wrong until it's dealt with.
    for (const calf of untiedCalves(timeline, input.animals)) {
      out.push({
        ...base,
        id: `untied:${calf.animalId}`,
        kind: "untied-calf",
        urgency: "now",
        on: calf.bornOn,
        daysLate: daysBetween(calf.bornOn, input.today),
        title: `${calf.name} has no calving recorded`,
        detail: `On file as born ${calf.bornOn}, out of ${base.animalName}. Until the calving is recorded her season stays open and her days-open and interval are missing.`,
      });
    }

    switch (breeding.state) {
      case "carrying": {
        if (!breeding.dueOn) break;
        const late = daysBetween(breeding.dueOn, input.today);
        if (late > 0) {
          out.push({
            ...base,
            id: `overdue:${cow.id}`,
            kind: "overdue",
            urgency: "now",
            on: breeding.dueOn,
            daysLate: late,
            title: `${base.animalName} is ${late} day${late === 1 ? "" : "s"} past due`,
            detail: `Due ${breeding.dueOn} and no calving recorded. If she has calved, recording it closes the season.`,
          });
        } else if (-late <= RULES.dueSoonDays) {
          out.push({
            ...base,
            id: `due:${cow.id}`,
            kind: "due-soon",
            urgency: -late <= 7 ? "now" : "soon",
            on: breeding.dueOn,
            daysLate: late,
            title: `${base.animalName} is due ${breeding.dueOn}`,
            detail: `${-late} day${-late === 1 ? "" : "s"} away.`,
          });
        }
        break;
      }

      case "bred": {
        if (breeding.daysSince < RULES.checkDueDays) break;
        const late = breeding.daysSince - RULES.checkDueDays;
        out.push({
          ...base,
          id: `check:${cow.id}`,
          kind: "check-due",
          urgency: breeding.daysSince >= RULES.checkLateDays ? "now" : "soon",
          on: breeding.on,
          daysLate: late,
          title: `${base.animalName} hasn't been checked`,
          detail: `Bred ${breeding.on}, ${breeding.daysSince} days ago, with no pregnancy check. Until she's checked nothing about this season is settled.`,
        });
        break;
      }

      case "recheck":
        out.push({
          ...base,
          id: `recheck:${cow.id}`,
          kind: "recheck",
          urgency: "now",
          on: breeding.since,
          daysLate: daysBetween(breeding.since, input.today),
          title: `${base.animalName} needs re-checking`,
          detail: `The check on ${breeding.since} came back "recheck", which settles nothing either way.`,
        });
        break;

      case "open":
        out.push({
          ...base,
          id: `open:${cow.id}`,
          kind: "breed-back",
          urgency: "soon",
          on: breeding.since,
          daysLate: daysBetween(breeding.since, input.today),
          title: `${base.animalName} is open`,
          detail: `Checked open on ${breeding.since}. She can go again on her next heat.`,
          href: "/breedings",
        });
        break;

      case "ready": {
        const late = daysBetween(breeding.readyOn, input.today);
        out.push({
          ...base,
          id: `ready:${cow.id}`,
          kind: "breed-back",
          urgency: late > RULES.breedBackLateDays ? "now" : "soon",
          on: breeding.readyOn,
          daysLate: late,
          title: `${base.animalName} is ready to breed`,
          detail:
            late === 0
              ? `Her waiting period is up today.`
              : `Her waiting period was up ${breeding.readyOn}, ${late} day${late === 1 ? "" : "s"} ago.`,
          href: "/breedings",
        });
        break;
      }

      case "wait": {
        const away = daysBetween(input.today, breeding.readyOn);
        if (away <= RULES.dueSoonDays) {
          out.push({
            ...base,
            id: `wait:${cow.id}`,
            kind: "breed-back",
            urgency: "watch",
            on: breeding.readyOn,
            daysLate: -away,
            title: `${base.animalName} can be bred from ${breeding.readyOn}`,
            detail: `${away} day${away === 1 ? "" : "s"} of her waiting period left.`,
            href: "/breedings",
          });
        }
        break;
      }

      case "none":
        break;
    }
  }

  return sortAlerts(out);
}

const URGENCY_ORDER: Record<Urgency, number> = { now: 0, soon: 1, watch: 2 };

/** Most urgent first, then most overdue — a cow three weeks late outranks one
 *  that missed yesterday, within the same band. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      b.daysLate - a.daysLate ||
      a.animalName.localeCompare(b.animalName),
  );
}

/** "11 days late", "in 6 days", "today" — the same phrasing everywhere. */
export function whenInWords(daysLate: number): string {
  if (daysLate === 0) return "today";
  if (daysLate > 0) return `${daysLate} day${daysLate === 1 ? "" : "s"} late`;
  return `in ${-daysLate} day${daysLate === -1 ? "" : "s"}`;
}

/**
 * Her breeding status as a table cell: a date on the top line and a word
 * underneath. The date is the point — "when should she next be bred" is a
 * question with a calendar answer, and a status word alone sends you to
 * another screen to work it out.
 */
export function breedingCell(status: BreedingStatus): { value: string; note: string; accent: boolean } {
  switch (status.state) {
    case "carrying":
      return { value: status.dueOn ?? "carrying", note: status.dueOn ? "due — carrying" : "carrying", accent: true };
    case "wait":
      return { value: status.readyOn, note: "waiting period", accent: false };
    case "ready":
      return { value: status.readyOn, note: "ready now", accent: true };
    case "bred":
      return { value: status.on, note: `bred · ${status.daysSince}d, unchecked`, accent: false };
    case "recheck":
      return { value: status.since, note: "recheck", accent: true };
    case "open":
      return { value: status.since, note: "open — next heat", accent: true };
    case "none":
      return { value: "—", note: "", accent: false };
  }
}

export const KIND_LABEL: Record<AlertKind, string> = {
  overdue: "Past due",
  "check-due": "Check due",
  recheck: "Recheck",
  "untied-calf": "Calving missing",
  "breed-back": "Breeding",
  "due-soon": "Calving due",
};
