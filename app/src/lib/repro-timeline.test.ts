import { describe, expect, it } from "vitest";
import {
  atDay,
  axisDays,
  checkStory,
  summarise,
  toSeasons,
  toYears,
  whatsNext,
  type TimelineInput,
} from "./repro-timeline";
import type { Breeding } from "./breedings";
import type { CalfOutcome, Calving, PregnancyCheck } from "./repro";
import type { RealLactation } from "./lactations";

/**
 * Martha's record from the mockup, which is a good test case because it has
 * the two hard shapes in it: a season where she was served three times
 * before one took, and an open season with a service nobody has checked.
 */

const service = (over: Partial<Breeding> & { id: string; date: string }): Breeding => ({
  animal_id: "cow-1",
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

const check = (over: Partial<PregnancyCheck> & { id: string; date: string; result: string }): PregnancyCheck => ({
  animal_id: "cow-1",
  method: "palpation",
  estimated_days_bred: null,
  estimated_conception_date: null,
  breeding_event_id: null,
  technician: "",
  notes: "",
  ...over,
});

const calving = (over: Partial<Calving> & { id: string; date: string }): Calving => ({
  dam_id: "cow-1",
  calving_ease: 1,
  assistance: "unassisted",
  presentation: "anterior",
  retained_placenta: false,
  is_twin: false,
  breeding_event_id: null,
  notes: "",
  ...over,
});

const outcome = (over: Partial<CalfOutcome> & { id: string; calving_id: string }): CalfOutcome => ({
  calf_animal_id: null,
  outcome: "live",
  sex: "female",
  birth_weight_lb: null,
  is_freemartin: false,
  vigor_score: null,
  notes: "",
  ...over,
});

const lactation = (over: Partial<RealLactation> & { id: string; fresh_date: string }): RealLactation => ({
  animal_id: "cow-1",
  lactation_number: 1,
  dry_off_date: null,
  calving_id: null,
  peak_milk_lb: null,
  peak_dim: null,
  total_yield_lb: null,
  me305_lb: null,
  termination_reason: "",
  ...over,
});

const names = new Map([
  ["bull-1", "Dutton"],
  ["bull-2", "Rook"],
  ["calf-1", "Bess"],
]);

const base: TimelineInput = {
  animal: { id: "cow-1", birth_date: "2021-03-02" },
  calvings: [],
  outcomes: [],
  breedings: [],
  checks: [],
  lactations: [],
  names,
  gestationDays: 283,
  voluntaryWaitDays: 60,
  today: "2026-08-10",
};

/** The mockup's cow: calved Mar 2024, three services, calved Apr 2025. */
const martha: TimelineInput = {
  ...base,
  calvings: [
    calving({ id: "c1", date: "2024-03-10" }),
    calving({ id: "c2", date: "2025-04-25", is_twin: true, breeding_event_id: "s3" }),
  ],
  outcomes: [
    outcome({ id: "o1", calving_id: "c2", calf_animal_id: "calf-1", outcome: "live", sex: "female" }),
    outcome({ id: "o2", calving_id: "c2", outcome: "stillborn", sex: "male" }),
  ],
  breedings: [
    service({ id: "s1", date: "2024-06-02" }),
    service({ id: "s2", date: "2024-06-24" }),
    service({ id: "s3", date: "2024-07-16", method: "natural", sire_id: "bull-2" }),
    service({ id: "s4", date: "2025-07-14" }),
  ],
  checks: [
    check({ id: "p1", date: "2024-07-04", result: "open", breeding_event_id: "s1" }),
    check({ id: "p2", date: "2024-07-10", result: "recheck", breeding_event_id: "s2" }),
    check({ id: "p3", date: "2024-07-15", result: "open", breeding_event_id: "s2" }),
    check({ id: "p4", date: "2024-08-20", result: "pregnant", breeding_event_id: "s3" }),
  ],
  lactations: [
    lactation({ id: "l1", fresh_date: "2024-03-10", lactation_number: 3 }),
    lactation({ id: "l2", fresh_date: "2025-04-25", lactation_number: 4, calving_id: "c2" }),
  ],
};

describe("checkStory", () => {
  it("collapses repeats but keeps the sequence, because the answer changed", () => {
    expect(checkStory([check({ id: "a", date: "2026-01-01", result: "recheck" }), check({ id: "b", date: "2026-01-20", result: "open" })]))
      .toEqual({ outcome: "open", story: "recheck → open", lastCheckOn: "2026-01-20" });

    expect(checkStory([check({ id: "a", date: "2026-01-01", result: "recheck" }), check({ id: "b", date: "2026-01-20", result: "recheck" })]))
      .toEqual({ outcome: "recheck", story: "recheck", lastCheckOn: "2026-01-20" });
  });

  it("reads in date order however the rows arrive", () => {
    const late = check({ id: "b", date: "2026-02-01", result: "pregnant" });
    const early = check({ id: "a", date: "2026-01-01", result: "open" });
    expect(checkStory([late, early]).story).toBe("open → pregnant");
    expect(checkStory([late, early]).outcome).toBe("pregnant");
  });

  it("says so when nobody has checked", () => {
    expect(checkStory([])).toEqual({ outcome: "unchecked", story: "not checked yet", lastCheckOn: null });
  });
});

describe("toSeasons", () => {
  it("starts every row on a calving, so the days line up", () => {
    const rows = toSeasons(martha);
    expect(rows.map((r) => r.title)).toEqual(["Season 1", "Season 2"]);
    expect(rows[0].startsOn).toBe("2024-03-10");
    expect(rows[1].startsOn).toBe("2025-04-25");
    // Day numbers are from that row's calving, not from the epoch.
    expect(rows[0].services.map((s) => s.day)).toEqual([84, 106, 128]);
  });

  it("puts each service in the season it happened in", () => {
    const rows = toSeasons(martha);
    expect(rows[0].services.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(rows[1].services.map((s) => s.id)).toEqual(["s4"]);
  });

  it("credits the service the calving names, not the last one before it", () => {
    const rows = toSeasons(martha);
    expect(rows[0].conception?.id).toBe("s3");
    expect(rows[0].services.filter((s) => s.conceived).map((s) => s.id)).toEqual(["s3"]);
    // Days open is measured to that service.
    expect(rows[0].daysOpen).toBe(128);
    expect(rows[0].intervalDays).toBe(411);
  });

  it("falls back to the last pregnant check when no calving names a service", () => {
    const rows = toSeasons({
      ...martha,
      calvings: [calving({ id: "c1", date: "2024-03-10" })],
      outcomes: [],
    });
    expect(rows[0].conception?.id).toBe("s3");
  });

  it("tells the whole check story on each service", () => {
    const rows = toSeasons(martha);
    expect(rows[0].services[0].checkStory).toBe("open");
    expect(rows[0].services[1].checkStory).toBe("recheck → open");
    expect(rows[0].services[2].checkStory).toBe("pregnant");
    expect(rows[1].services[0].checkStory).toBe("not checked yet");
  });

  it("names the sire the way the Breedings list does", () => {
    const rows = toSeasons(martha);
    expect(rows[0].services[0].sire).toBe("AI · Dutton");
    expect(rows[0].services[2].sire).toBe("Bull · Rook");
  });

  it("describes the calving that closed the season", () => {
    const rows = toSeasons(martha);
    expect(rows[0].ending?.headline).toBe("Twins");
    expect(rows[0].ending?.detail).toBe("live heifer Bess · one stillborn");
    expect(rows[0].ending?.day).toBe(411);
    expect(rows[1].ending).toBeNull();
  });

  it("leaves the open season running, with today's figure and no interval", () => {
    const rows = toSeasons(martha);
    const open = rows[1];
    expect(open.intervalDays).toBeNull();
    expect(open.runningDays).toBe(472); // 2025-04-25 → 2026-08-10
    expect(open.dueOn).toBeNull(); // s4 was never checked, so nothing is carrying
  });

  it("projects a due date once something has taken", () => {
    const rows = toSeasons({
      ...martha,
      checks: [...martha.checks, check({ id: "p5", date: "2025-08-14", result: "pregnant", breeding_event_id: "s4" })],
    });
    expect(rows[1].conception?.id).toBe("s4");
    expect(rows[1].dueOn).toBe("2026-04-23"); // 2025-07-14 + 283
  });

  it("takes the lactation number from the calving's own link, then the date", () => {
    const rows = toSeasons(martha);
    expect(rows[0].lactationNumber).toBe(3); // matched on fresh_date
    expect(rows[1].lactationNumber).toBe(4); // matched on calving_id
  });

  it("gives a cow who has never calved one row anchored on her first service", () => {
    const rows = toSeasons({
      ...base,
      breedings: [service({ id: "s1", date: "2025-08-30" }), service({ id: "s2", date: "2025-10-20" })],
      checks: [check({ id: "p1", date: "2025-10-01", result: "open", breeding_event_id: "s1" })],
    });
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("First season");
    expect(rows[0].anchor).toBe("first-service");
    expect(rows[0].startsOn).toBe("2025-08-30");
    // Days open is measured from a calving. There isn't one, so there is no
    // figure — not zero, which would rank her first among the whole herd.
    expect(rows[0].daysOpen).toBeNull();
  });

  it("keeps services logged before her first calving in their own row", () => {
    const rows = toSeasons({
      ...base,
      breedings: [service({ id: "s0", date: "2023-05-01" })],
      calvings: [calving({ id: "c1", date: "2024-03-10" })],
    });
    expect(rows.map((r) => r.title)).toEqual(["Before her first calving", "Season 1"]);
    expect(rows[0].services.map((s) => s.id)).toEqual(["s0"]);
    expect(rows[1].services).toEqual([]);
  });

  it("still returns a row when nothing has ever been logged", () => {
    const rows = toSeasons(base);
    expect(rows.length).toBe(1);
    expect(rows[0].anchor).toBe("birth");
    expect(rows[0].services).toEqual([]);
  });

  it("leaves a voided service out — it made nothing and dates nothing", () => {
    const rows = toSeasons({
      ...martha,
      breedings: martha.breedings.map((b) => (b.id === "s2" ? { ...b, voided: true } : b)),
    });
    expect(rows[0].services.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("ignores another cow's record entirely", () => {
    const rows = toSeasons({
      ...martha,
      breedings: [...martha.breedings, service({ id: "x1", date: "2024-05-01", animal_id: "cow-2" })],
      calvings: [...martha.calvings, calving({ id: "x2", date: "2024-09-01", dam_id: "cow-2" })],
    });
    expect(rows.map((r) => r.title)).toEqual(["Season 1", "Season 2"]);
    expect(rows.flatMap((r) => r.services).map((s) => s.id)).not.toContain("x1");
  });
});

describe("axisDays", () => {
  it("is one clock for every row — the longest, not each row's own length", () => {
    const rows = toSeasons(martha);
    const axis = axisDays(rows);
    expect(axis).toBeGreaterThanOrEqual(rows[0].lengthDays);
    expect(axis).toBeGreaterThanOrEqual(rows[1].lengthDays);
  });

  it("never drops below 400 days, so a normal season isn't exaggerated", () => {
    expect(axisDays([])).toBe(400);
    expect(axisDays(toSeasons({ ...base, breedings: [service({ id: "s1", date: "2026-08-01" })] }))).toBe(400);
  });

  it("grows in steps rather than tracking the longest row exactly", () => {
    const rows = toSeasons({
      ...base,
      calvings: [calving({ id: "c1", date: "2024-01-01" }), calving({ id: "c2", date: "2025-06-01" })],
    });
    expect(rows[0].intervalDays).toBe(517);
    expect(axisDays(rows)).toBe(550);
  });
});

describe("atDay", () => {
  it("maps a day onto the axis and clamps rather than overflowing the box", () => {
    expect(atDay(0, 400)).toBe(0);
    expect(atDay(200, 400)).toBe(50);
    expect(atDay(-10, 400)).toBe(0);
    expect(atDay(600, 400)).toBe(100);
  });
});

describe("toYears", () => {
  it("puts each event on the year it happened", () => {
    const rows = toYears(martha);
    expect(rows.map((r) => r.year)).toEqual([2024, 2025, 2026]);
    expect(rows[0].services.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(rows[1].services.map((s) => s.id)).toEqual(["s4"]);
    expect(rows[1].calvings.map((c) => c.on)).toEqual(["2025-04-25"]);
  });

  it("positions events by day of year, not by season day", () => {
    const rows = toYears(martha);
    // 2 June 2024 is day 153 of a leap year.
    expect(rows[0].services[0].day).toBe(153);
  });

  it("draws a pregnancy in both years and says which way it runs", () => {
    const rows = toYears(martha);
    const from2024 = rows[0].carrying[0];
    expect(from2024.intoNextYear).toBe(true);
    expect(from2024.fromPriorYear).toBe(false);

    const into2025 = rows[1].carrying[0];
    expect(into2025.fromPriorYear).toBe(true);
    expect(into2025.fromDay).toBe(0);
    expect(into2025.intoNextYear).toBe(false);
  });

  it("runs to this year even when the last event is older", () => {
    const rows = toYears({ ...martha, today: "2028-02-02" });
    expect(rows[rows.length - 1].year).toBe(2028);
  });

  it("has nothing to draw when nothing has happened", () => {
    expect(toYears(base)).toEqual([]);
  });
});

describe("summarise", () => {
  it("counts services per conception, and won't divide by no conceptions", () => {
    const s = summarise(toSeasons(martha));
    expect(s.calvings).toBe(1);
    expect(s.services).toBe(4);
    expect(s.perConception).toBe(4); // 4 services, 1 conception
    expect(s.averageInterval).toBe(411);
    expect(s.averageDaysOpen).toBe(128);

    const none = summarise(toSeasons({ ...base, breedings: [service({ id: "s1", date: "2026-01-01" })] }));
    expect(none.perConception).toBeNull();
    expect(none.averageInterval).toBeNull();
    expect(none.averageDaysOpen).toBeNull();
  });
});

describe("whatsNext", () => {
  const next = (input: TimelineInput) => {
    const rows = toSeasons(input);
    return whatsNext(rows[rows.length - 1], { today: input.today, voluntaryWaitDays: input.voluntaryWaitDays });
  };

  it("says nothing about a season that already ended", () => {
    const rows = toSeasons(martha);
    expect(whatsNext(rows[0], { today: martha.today, voluntaryWaitDays: 60 })).toBeNull();
  });

  it("calls out a due date that has passed with no calving — the real case here", () => {
    // Martha's actual record: bred 20 Oct 2025, confirmed pregnant, beef
    // gestation 283 days puts her due 30 Jul 2026, and today is past it.
    const msg = next({
      ...base,
      breedings: [service({ id: "s1", date: "2025-08-30" }), service({ id: "s2", date: "2025-10-20" })],
      checks: [
        check({ id: "p1", date: "2025-10-01", result: "open", breeding_event_id: "s1" }),
        check({ id: "p2", date: "2025-11-19", result: "pregnant", breeding_event_id: "s2" }),
      ],
    });
    expect(msg).toMatch(/Due 2026-07-30 — 11 days ago, and no calving recorded/);
  });

  it("counts down to a due date that hasn't arrived", () => {
    const msg = next({
      ...base,
      breedings: [service({ id: "s1", date: "2026-06-01" })],
      checks: [check({ id: "p1", date: "2026-07-01", result: "pregnant", breeding_event_id: "s1" })],
    });
    expect(msg).toMatch(/Carrying — due 2027-03-11, 213 days away/);
  });

  it("distinguishes too-early-to-check from nobody-checked", () => {
    expect(next({ ...base, breedings: [service({ id: "s1", date: "2026-08-01" })] })).toMatch(/Too early to check/);
    expect(next({ ...base, breedings: [service({ id: "s1", date: "2026-05-01" })] })).toMatch(
      /101 days ago and not checked/,
    );
  });

  it("says she's ready again when the check came back open", () => {
    const msg = next({
      ...base,
      breedings: [service({ id: "s1", date: "2026-05-01" })],
      checks: [check({ id: "p1", date: "2026-06-01", result: "open", breeding_event_id: "s1" })],
    });
    expect(msg).toMatch(/Open since the check on 2026-06-01/);
  });

  it("won't let a recheck pass for an answer", () => {
    const msg = next({
      ...base,
      breedings: [service({ id: "s1", date: "2026-05-01" })],
      checks: [check({ id: "p1", date: "2026-06-01", result: "recheck", breeding_event_id: "s1" })],
    });
    expect(msg).toMatch(/Nothing is settled until it's repeated/);
  });

  it("counts the voluntary wait on a cow who has calved and not been bred back", () => {
    const soon = next({ ...base, calvings: [calving({ id: "c1", date: "2026-07-20" })] });
    expect(soon).toMatch(/the waiting period is up 2026-09-18, 39 days away/);

    const overdue = next({ ...base, calvings: [calving({ id: "c1", date: "2026-01-20" })] });
    expect(overdue).toMatch(/The waiting period was up 2026-03-21/);
  });
});
