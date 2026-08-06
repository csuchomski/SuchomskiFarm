import { describe, expect, it } from "vitest";
import {
  byFreshDateDesc,
  daysBetween,
  daysInMilk,
  explainWriteError,
  nextLactationNumber,
  openLactation,
  statusOf,
  validateDryOff,
  validateFreshening,
  type RealLactation,
} from "./lactations";

const lactation = (over: Partial<RealLactation> = {}): RealLactation => ({
  id: over.id ?? "l1",
  animal_id: over.animal_id ?? "a1",
  lactation_number: over.lactation_number ?? 1,
  fresh_date: over.fresh_date ?? "2026-01-10",
  dry_off_date: over.dry_off_date ?? null,
  calving_id: null,
  peak_milk_lb: null,
  peak_dim: null,
  total_yield_lb: null,
  me305_lb: null,
  termination_reason: "",
});

const TODAY = "2026-08-06";

describe("statusOf", () => {
  it("is in-milk between freshening and dry-off", () => {
    expect(statusOf(lactation({ fresh_date: "2026-01-10" }), TODAY)).toBe("in-milk");
  });

  it("is dry once the dry-off date has passed", () => {
    expect(statusOf(lactation({ dry_off_date: "2026-07-01" }), TODAY)).toBe("dry");
  });

  it("is still in-milk when dry-off is scheduled for the future", () => {
    // Recording a planned dry-off must not take her out of the milking count
    // before it happens.
    expect(statusOf(lactation({ dry_off_date: "2026-09-01" }), TODAY)).toBe("in-milk");
  });

  it("is scheduled when she hasn't freshened yet", () => {
    expect(statusOf(lactation({ fresh_date: "2026-12-01" }), TODAY)).toBe("scheduled");
  });

  it("counts the fresh date itself as in-milk", () => {
    expect(statusOf(lactation({ fresh_date: TODAY }), TODAY)).toBe("in-milk");
  });
});

describe("daysInMilk", () => {
  it("counts from freshening to today while she's milking", () => {
    expect(daysInMilk(lactation({ fresh_date: "2026-08-01" }), TODAY)).toBe(5);
  });

  it("freezes at the final length once she's dry", () => {
    // The failure this guards: a finished lactation whose DIM keeps climbing.
    const dried = lactation({ fresh_date: "2026-01-01", dry_off_date: "2026-06-01" });
    expect(daysInMilk(dried, TODAY)).toBe(151);
    expect(daysInMilk(dried, "2027-01-01")).toBe(151);
  });

  it("is null before she's freshened", () => {
    expect(daysInMilk(lactation({ fresh_date: "2026-12-01" }), TODAY)).toBeNull();
  });

  it("is zero on the day she freshens", () => {
    expect(daysInMilk(lactation({ fresh_date: TODAY }), TODAY)).toBe(0);
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
  });

  it("is unaffected by a daylight-saving boundary", () => {
    // Parsed as UTC precisely so a 23- or 25-hour local day can't round to
    // an off-by-one DIM.
    expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
    expect(daysBetween("2026-10-25", "2026-11-01")).toBe(7);
  });
});

describe("openLactation / nextLactationNumber", () => {
  it("finds the one she's currently milking", () => {
    const all = [
      lactation({ id: "old", lactation_number: 1, fresh_date: "2024-01-01", dry_off_date: "2024-11-01" }),
      lactation({ id: "now", lactation_number: 2, fresh_date: "2026-02-01" }),
    ];
    expect(openLactation(all, TODAY)?.id).toBe("now");
  });

  it("returns null when every lactation is finished", () => {
    expect(openLactation([lactation({ dry_off_date: "2026-06-01" })], TODAY)).toBeNull();
  });

  it("suggests one past her highest parity", () => {
    expect(nextLactationNumber([lactation({ lactation_number: 3 })])).toBe(4);
  });

  it("suggests 1 for a heifer with no history", () => {
    expect(nextLactationNumber([])).toBe(1);
  });

  it("suggests from the highest number, not the count", () => {
    // A gap in recorded history must not hand out a number already used.
    expect(nextLactationNumber([lactation({ lactation_number: 5 })])).toBe(6);
  });
});

describe("validateFreshening", () => {
  const existing = [
    lactation({ id: "l1", animal_id: "a1", lactation_number: 1, fresh_date: "2024-01-01", dry_off_date: "2024-11-01" }),
  ];

  it("accepts a well-formed freshening", () => {
    expect(
      validateFreshening({ animalId: "a1", lactationNumber: 2, freshDate: "2026-02-01" }, existing, TODAY),
    ).toBeNull();
  });

  it("rejects a duplicate parity", () => {
    expect(
      validateFreshening({ animalId: "a1", lactationNumber: 1, freshDate: "2026-02-01" }, existing, TODAY),
    ).toMatch(/already exists/);
  });

  it("rejects a second open lactation", () => {
    const withOpen = [...existing, lactation({ id: "l2", lactation_number: 2, fresh_date: "2026-02-01" })];
    expect(
      validateFreshening({ animalId: "a1", lactationNumber: 3, freshDate: "2026-07-01" }, withOpen, TODAY),
    ).toMatch(/open lactation/);
  });

  it("rejects a fresh date at or before the previous one", () => {
    expect(
      validateFreshening({ animalId: "a1", lactationNumber: 2, freshDate: "2023-06-01" }, existing, TODAY),
    ).toMatch(/must be after/);
  });

  it("ignores another animal's lactations", () => {
    // Parity is per-cow; a clash with a different animal isn't a clash.
    expect(
      validateFreshening({ animalId: "a2", lactationNumber: 1, freshDate: "2026-02-01" }, existing, TODAY),
    ).toBeNull();
  });

  it("rejects a missing date and a nonsense parity", () => {
    expect(validateFreshening({ animalId: "a1", lactationNumber: 2, freshDate: "" }, existing, TODAY)).toMatch(
      /fresh date/i,
    );
    expect(
      validateFreshening({ animalId: "a1", lactationNumber: 0, freshDate: "2026-02-01" }, existing, TODAY),
    ).toMatch(/1 or more/);
  });
});

describe("validateDryOff", () => {
  const l = lactation({ fresh_date: "2026-01-10" });

  it("accepts a date after freshening and not in the future", () => {
    expect(validateDryOff(l, "2026-07-01", TODAY)).toBeNull();
  });

  it("rejects drying off before she freshened", () => {
    expect(validateDryOff(l, "2025-12-01", TODAY)).toMatch(/before she freshened/);
  });

  it("rejects a future dry-off", () => {
    expect(validateDryOff(l, "2026-12-01", TODAY)).toMatch(/future/);
  });
});

describe("byFreshDateDesc", () => {
  it("puts the most recent lactation first", () => {
    const sorted = [
      lactation({ id: "a", fresh_date: "2024-01-01" }),
      lactation({ id: "c", fresh_date: "2026-02-01" }),
      lactation({ id: "b", fresh_date: "2025-01-01" }),
    ].sort(byFreshDateDesc);
    expect(sorted.map((l) => l.id)).toEqual(["c", "b", "a"]);
  });

  it("breaks a same-day tie on parity", () => {
    const sorted = [
      lactation({ id: "low", lactation_number: 1, fresh_date: "2026-02-01" }),
      lactation({ id: "high", lactation_number: 2, fresh_date: "2026-02-01" }),
    ].sort(byFreshDateDesc);
    expect(sorted[0].id).toBe("high");
  });
});

describe("explainWriteError", () => {
  // These fire only when the client check was working from stale data —
  // a second tab, or two people recording at once — so the message has to
  // say what to do, not name a Postgres index.
  it("explains a duplicate parity", () => {
    expect(
      explainWriteError('duplicate key value violates unique constraint "lactations_animal_parity_uniq"'),
    ).toMatch(/already exists for her.*Reload/s);
  });

  it("explains a second open lactation", () => {
    expect(
      explainWriteError('duplicate key value violates unique constraint "lactations_one_open_per_animal"'),
    ).toMatch(/already has an open lactation.*Reload/s);
  });

  it("explains a dry-off before freshening", () => {
    expect(
      explainWriteError('new row for relation "lactations" violates check constraint "lactations_dry_after_fresh"'),
    ).toBe("Dry-off can't be before she freshened.");
  });

  it("passes an unrecognised error through unchanged", () => {
    // Swallowing an unknown failure behind a friendly sentence is how a real
    // fault becomes invisible — see missingRelation in workspace.tsx.
    expect(explainWriteError("permission denied for table lactations")).toBe(
      "permission denied for table lactations",
    );
  });
});
