import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  dueDate,
  emptyCalf,
  latestCheck,
  likelyService,
  validateCalving,
  validateCheck,
  type PregnancyCheck,
} from "./repro";

const check = (over: Partial<PregnancyCheck> = {}): PregnancyCheck => ({
  id: "p1",
  animal_id: "cow-1",
  date: "2026-08-05",
  method: "palpation",
  result: "pregnant",
  estimated_days_bred: 35,
  estimated_conception_date: "2026-07-01",
  breeding_event_id: "b1",
  technician: "",
  notes: "",
  ...over,
});

describe("dueDate", () => {
  it("counts her gestation length forward from the service", () => {
    // Belted Galloway 283, Jersey 279 — from herd.breeds, resolved by
    // lib/gestation.ts rather than a species average.
    expect(dueDate("2026-08-01", 283)).toBe("2027-05-11");
    expect(dueDate("2026-08-01", 279)).toBe("2027-05-07");
  });

  it("is blank when nothing on file yields a figure, rather than a guess", () => {
    expect(dueDate("2026-08-01", null)).toBeNull();
    expect(dueDate("2026-08-01", undefined)).toBeNull();
  });
});

describe("addDays and daysBetween", () => {
  it("round-trip", () => {
    expect(daysBetween("2026-08-01", addDays("2026-08-01", 283))).toBe(283);
  });

  it("crosses a month and a year end", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
  });

  it("goes negative for a date already past", () => {
    expect(daysBetween("2026-08-10", "2026-08-01")).toBe(-9);
  });
});

describe("latestCheck", () => {
  it("takes the most recent check for that breeding", () => {
    // A recheck supersedes the check that asked for it.
    const rows = [
      check({ id: "a", date: "2026-08-05", result: "recheck" }),
      check({ id: "b", date: "2026-08-20", result: "pregnant" }),
    ];
    expect(latestCheck(rows, "b1")?.id).toBe("b");
  });

  it("ignores checks belonging to another breeding", () => {
    const rows = [check({ id: "a", breeding_event_id: "b2", date: "2026-09-01" })];
    expect(latestCheck(rows, "b1")).toBeNull();
  });

  it("is null when there are none", () => {
    expect(latestCheck([], "b1")).toBeNull();
  });
});

describe("validateCheck", () => {
  const base = { animalId: "cow-1", date: "2026-08-05", method: "palpation", result: "pregnant" };

  it("accepts a normal check", () => {
    expect(validateCheck(base)).toBeNull();
  });

  it("wants an animal, a date, a method and a result", () => {
    expect(validateCheck({ ...base, animalId: "" })).toMatch(/Which cow/);
    expect(validateCheck({ ...base, date: "" })).toMatch(/When was she checked/);
    expect(validateCheck({ ...base, method: "guessing" })).toMatch(/how she was checked/);
    expect(validateCheck({ ...base, result: "maybe" })).toMatch(/what it came back as/);
  });

  it("refuses a check dated before the breeding, and names the day", () => {
    // record_pregnancy_check refuses this too — this just says it sooner.
    expect(validateCheck({ ...base, bredOn: "2026-08-20" })).toMatch(/bred on 2026-08-20/);
  });

  it("accepts a check on the day she was bred", () => {
    expect(validateCheck({ ...base, bredOn: "2026-08-05" })).toBeNull();
  });
});

describe("validateCalving", () => {
  const live = { ...emptyCalf(), sex: "female", earTag: "99" };
  const base = { damId: "cow-1", date: "2026-08-08", calves: [live] };

  it("accepts a live heifer calf", () => {
    expect(validateCalving(base)).toBeNull();
  });

  it("accepts twins", () => {
    expect(validateCalving({ ...base, calves: [live, { ...emptyCalf(), outcome: "stillborn", sex: "male" }] })).toBeNull();
  });

  it("accepts a stillborn calf with no sex recorded", () => {
    expect(validateCalving({ ...base, calves: [{ ...emptyCalf(), outcome: "stillborn", sex: "" }] })).toBeNull();
  });

  it("wants a live calf to have a sex, because its animal record needs one", () => {
    // animals.sex is NOT NULL; the alternative is inventing one.
    expect(validateCalving({ ...base, calves: [{ ...emptyCalf(), sex: "" }] })).toMatch(/needs a sex/);
  });

  it("wants a dam, a date and at least one calf", () => {
    expect(validateCalving({ ...base, damId: "" })).toMatch(/Which cow or heifer calved/);
    expect(validateCalving({ ...base, date: "" })).toMatch(/When did she calve/);
    expect(validateCalving({ ...base, calves: [] })).toMatch(/even a stillborn one/);
  });

  it("refuses a birth weight that isn't a positive number", () => {
    expect(validateCalving({ ...base, calves: [{ ...live, birthWeight: "heavy" }] })).toMatch(/has to be a number/);
    expect(validateCalving({ ...base, calves: [{ ...live, birthWeight: "0" }] })).toMatch(/above zero/);
    expect(validateCalving({ ...base, calves: [{ ...live, birthWeight: "" }] })).toBeNull();
  });
});

describe("likelyService", () => {
  const svc = (id: string, date: string) => ({ id, date });

  it("picks the service whose due date lands nearest the calving", () => {
    // The case that matters: served in January, returned to heat, served
    // again three weeks later. At 280 days the January service is due on the
    // day she actually calved, so it — not the later one — made the calf.
    const services = [svc("first", "2026-01-01"), svc("second", "2026-01-22")];
    expect(likelyService("2026-10-08", services, 280)?.id).toBe("first");
    // Move the calving three weeks and the answer flips, which is the whole
    // point of dating it rather than taking the most recent.
    expect(likelyService("2026-10-29", services, 280)?.id).toBe("second");
  });

  it("ignores services on or after the calving", () => {
    const services = [svc("before", "2026-01-01"), svc("after", "2026-10-20")];
    expect(likelyService("2026-10-08", services, 280)?.id).toBe("before");
    expect(likelyService("2026-01-01", services, 280)).toBeNull();
  });

  it("falls back to the most recent when there's no gestation figure", () => {
    const services = [svc("first", "2026-01-01"), svc("second", "2026-01-22")];
    expect(likelyService("2026-10-08", services, null)?.id).toBe("second");
    expect(likelyService("2026-10-08", services, undefined)?.id).toBe("second");
  });

  it("has nothing to offer when she has no services", () => {
    expect(likelyService("2026-10-08", [], 280)).toBeNull();
  });

  it("takes a lone service whether or not the dates fit", () => {
    // A single service is the answer even when it's months out — the
    // alternative is a calf with no sire because the arithmetic disagreed.
    expect(likelyService("2026-10-08", [svc("only", "2026-03-01")], 280)?.id).toBe("only");
  });
});
