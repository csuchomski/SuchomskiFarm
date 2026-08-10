import { describe, expect, it } from "vitest";
import { breedingFemales, buildAlerts, sortAlerts, statusOf, whenInWords, type AlertInputs } from "./alerts";
import type { RealAnimal } from "./herd";
import type { Breeding } from "./breedings";
import type { Calving, PregnancyCheck } from "./repro";

/**
 * The alert rules, driven from the herd's real shape on 2026-08-10: Martha
 * carrying past her due date with an untied daughter on file, Vera bred the
 * day before and unchecked, Patience confirmed pregnant.
 */

const animal = (over: Partial<RealAnimal> & { id: string; ear_tag: string }): RealAnimal => ({
  barn_name: null,
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2021-01-01",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "beef",
  origin: "purchased",
  record_type: "herd",
  ...over,
});

const service = (over: Partial<Breeding> & { id: string; date: string; animal_id: string }): Breeding => ({
  service_number: 1,
  method: "ai",
  technician: "",
  sire_id: "bull-1",
  semen_lot_id: null,
  semen_type: "",
  naab_code_snapshot: "",
  voided: false,
  void_reason: "",
  cost_entry_id: null,
  notes: "",
  ...over,
});

const check = (
  over: Partial<PregnancyCheck> & { id: string; date: string; result: string; animal_id: string },
): PregnancyCheck => ({
  method: "palpation",
  estimated_days_bred: null,
  estimated_conception_date: null,
  breeding_event_id: null,
  technician: "",
  notes: "",
  ...over,
});

const calving = (over: Partial<Calving> & { id: string; date: string; dam_id: string }): Calving => ({
  calving_ease: 1,
  assistance: "unassisted",
  presentation: "anterior",
  retained_placenta: false,
  is_twin: false,
  breeding_event_id: null,
  notes: "",
  ...over,
});

const martha = animal({ id: "martha", ear_tag: "1", barn_name: "Martha" });
const vera = animal({ id: "vera", ear_tag: "2", barn_name: "Vera", class: "heifer", purpose: "dairy" });

const inputs = (over: Partial<AlertInputs> = {}): AlertInputs => ({
  animals: [martha, vera],
  calvings: [],
  outcomes: [],
  breedings: [],
  checks: [],
  gestation: { breeds: [], composition: [], overrides: [], bySpecies: { beef: 283, dairy: 279 } },
  voluntaryWaitDays: 60,
  today: "2026-08-10",
  ...over,
});

describe("breedingFemales", () => {
  it("asks about living females past calf age, and nobody else", () => {
    const herd = [
      martha,
      vera,
      animal({ id: "bull", ear_tag: "9", sex: "male", class: "bull" }),
      animal({ id: "calf", ear_tag: "8", class: "calf" }),
      animal({ id: "sold", ear_tag: "7", status: "sold" }),
      animal({ id: "ai", ear_tag: "", sex: "male", class: "bull", record_type: "reference" }),
    ];
    expect(breedingFemales(herd).map((a) => a.id)).toEqual(["martha", "vera"]);
  });
});

describe("statusOf", () => {
  it("says carrying once a check confirms it", () => {
    const i = inputs({
      breedings: [service({ id: "s1", date: "2025-10-20", animal_id: "martha" })],
      checks: [check({ id: "p1", date: "2025-11-19", result: "pregnant", animal_id: "martha", breeding_event_id: "s1" })],
    });
    expect(statusOf(martha, i).breeding).toEqual({ state: "carrying", dueOn: "2026-07-30" });
  });

  it("recommends the calving date plus the farm's waiting period", () => {
    const i = inputs({ calvings: [calving({ id: "c1", date: "2026-07-01", dam_id: "martha" })] });
    // 1 July + 60 = 30 August, still ahead of today.
    expect(statusOf(martha, i).breeding).toEqual({ state: "wait", readyOn: "2026-08-30" });

    const older = inputs({ calvings: [calving({ id: "c1", date: "2026-05-01", dam_id: "martha" })] });
    expect(statusOf(martha, older).breeding).toEqual({ state: "ready", readyOn: "2026-06-30" });
  });

  it("has no recommendation for a cow who has never calved", () => {
    // Breeding a maiden heifer is a decision about her age and her weight,
    // and a date invented from her birthday would be a recommendation the
    // farm never made.
    expect(statusOf(vera, inputs()).breeding).toEqual({ state: "none" });
  });

  it("won't recommend a date when the farm has no waiting period on file", () => {
    const i = inputs({
      calvings: [calving({ id: "c1", date: "2026-05-01", dam_id: "martha" })],
      voluntaryWaitDays: null,
    });
    expect(statusOf(martha, i).breeding).toEqual({ state: "none" });
  });
});

describe("buildAlerts", () => {
  const marthaOverdue = inputs({
    breedings: [
      service({ id: "s1", date: "2025-08-30", animal_id: "martha" }),
      service({ id: "s2", date: "2025-10-20", animal_id: "martha" }),
    ],
    checks: [
      check({ id: "p1", date: "2025-10-01", result: "open", animal_id: "martha", breeding_event_id: "s1" }),
      check({ id: "p2", date: "2025-11-19", result: "pregnant", animal_id: "martha", breeding_event_id: "s2" }),
    ],
  });

  it("raises the real one: past due with no calving", () => {
    const alerts = buildAlerts(marthaOverdue);
    const overdue = alerts.find((a) => a.kind === "overdue")!;
    expect(overdue).toBeTruthy();
    expect(overdue.urgency).toBe("now");
    expect(overdue.on).toBe("2026-07-30");
    expect(overdue.daysLate).toBe(11);
    expect(overdue.title).toBe("Martha is 11 days past due");
    expect(overdue.href).toBe("/animals/1");
  });

  it("raises a calf on file that no calving accounts for", () => {
    const abigail = animal({
      id: "abigail",
      ear_tag: "3",
      barn_name: "Abigail",
      class: "heifer",
      dam_id: "martha",
      birth_date: "2026-07-24",
    });
    const alerts = buildAlerts({ ...marthaOverdue, animals: [martha, vera, abigail] });
    const untied = alerts.find((a) => a.kind === "untied-calf")!;
    expect(untied.title).toBe("Abigail has no calving recorded");
    expect(untied.urgency).toBe("now");
    expect(untied.detail).toContain("out of Martha");
  });

  it("wants a check once a service is old enough to be checked", () => {
    // 30 days is the earliest a palpation or blood test answers.
    const early = buildAlerts(inputs({ breedings: [service({ id: "s1", date: "2026-07-25", animal_id: "vera" })] }));
    expect(early.find((a) => a.kind === "check-due")).toBeUndefined();

    const due = buildAlerts(inputs({ breedings: [service({ id: "s1", date: "2026-07-05", animal_id: "vera" })] }));
    expect(due.find((a) => a.kind === "check-due")?.urgency).toBe("soon");

    const late = buildAlerts(inputs({ breedings: [service({ id: "s1", date: "2026-06-01", animal_id: "vera" })] }));
    expect(late.find((a) => a.kind === "check-due")?.urgency).toBe("now");
  });

  it("won't let a recheck pass for an answer", () => {
    const alerts = buildAlerts(
      inputs({
        breedings: [service({ id: "s1", date: "2026-06-01", animal_id: "vera" })],
        checks: [check({ id: "p1", date: "2026-07-01", result: "recheck", animal_id: "vera", breeding_event_id: "s1" })],
      }),
    );
    const recheck = alerts.find((a) => a.kind === "recheck")!;
    expect(recheck.urgency).toBe("now");
    expect(recheck.detail).toContain("settles nothing either way");
  });

  it("counts the waiting period down, then up", () => {
    const soon = buildAlerts(inputs({ calvings: [calving({ id: "c1", date: "2026-06-25", dam_id: "martha" })] }));
    const watch = soon.find((a) => a.kind === "breed-back")!;
    // 25 June + 60 = 24 August, a fortnight out.
    expect(watch.urgency).toBe("watch");
    expect(watch.title).toContain("can be bred from 2026-08-24");

    const ready = buildAlerts(inputs({ calvings: [calving({ id: "c1", date: "2026-06-05", dam_id: "martha" })] }));
    expect(ready.find((a) => a.kind === "breed-back")?.urgency).toBe("soon");

    const overdue = buildAlerts(inputs({ calvings: [calving({ id: "c1", date: "2026-04-01", dam_id: "martha" })] }));
    expect(overdue.find((a) => a.kind === "breed-back")?.urgency).toBe("now");
  });

  it("stays quiet about a waiting period still weeks away", () => {
    const alerts = buildAlerts(inputs({ calvings: [calving({ id: "c1", date: "2026-08-05", dam_id: "martha" })] }));
    // Ready 4 October — nothing to do about it today.
    expect(alerts.find((a) => a.kind === "breed-back")).toBeUndefined();
  });

  it("warns before a calving, not only after it", () => {
    const alerts = buildAlerts(
      inputs({
        breedings: [service({ id: "s1", date: "2025-11-01", animal_id: "martha" })],
        checks: [
          check({ id: "p1", date: "2025-12-01", result: "pregnant", animal_id: "martha", breeding_event_id: "s1" }),
        ],
      }),
    );
    // 1 Nov + 283 = 11 Aug 2026 — tomorrow.
    const due = alerts.find((a) => a.kind === "due-soon")!;
    expect(due.urgency).toBe("now");
    expect(due.daysLate).toBe(-1);
  });

  it("says nothing at all about a quiet herd", () => {
    expect(buildAlerts(inputs())).toEqual([]);
  });
});

describe("sortAlerts", () => {
  it("puts the urgent first, and the most overdue within them", () => {
    const a = (id: string, urgency: "now" | "soon" | "watch", daysLate: number) =>
      ({ id, urgency, daysLate, animalName: id }) as Parameters<typeof sortAlerts>[0][number];
    expect(sortAlerts([a("b", "soon", 40), a("a", "now", 2), a("c", "now", 30), a("d", "watch", 0)]).map((x) => x.id))
      .toEqual(["c", "a", "b", "d"]);
  });
});

describe("whenInWords", () => {
  it("reads the same everywhere", () => {
    expect(whenInWords(11)).toBe("11 days late");
    expect(whenInWords(1)).toBe("1 day late");
    expect(whenInWords(0)).toBe("today");
    expect(whenInWords(-1)).toBe("in 1 day");
    expect(whenInWords(-6)).toBe("in 6 days");
  });
});
