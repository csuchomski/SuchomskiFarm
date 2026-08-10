import { describe, expect, it } from "vitest";
import {
  annualChargeCents,
  carryingValueCents,
  DEFAULT_ASSUMPTIONS,
  enteredProduction,
  gallonsToLb,
  isHerdInventory,
  latestValuations,
  perCwtCents,
  trailingYieldLb,
  type Assumptions,
  type Valuation,
} from "./depreciation";
import type { RealAnimal } from "./herd";

/**
 * The spec's own arithmetic is the fixture: $2,200 in, $900 out, 3.5
 * lactations is about $370/cow/year and $1.50–2.00/cwt at 20,000 lb.
 *
 * `carryingValueCents` is also the app's copy of what
 * `herd.mark_herd_values` does in SQL. The two have to agree — the rehearsal
 * of migration 035 marked Patience at $1,424.58 from a 2024-07-09 start, and
 * the test below holds this side to the same figure.
 */

const A: Assumptions = DEFAULT_ASSUMPTIONS;

describe("annualChargeCents", () => {
  it("is the spread over the productive lifetime", () => {
    // (220000 − 90000) / 3.5 = 37142.857… cents
    expect(Math.round(annualChargeCents(A)!)).toBe(37143);
  });

  it("matches the figure the spec quotes", () => {
    expect(Math.round(annualChargeCents(A)! / 100)).toBe(371);
  });

  it("is null rather than zero when there is no lifetime to divide by", () => {
    // Zero would quietly add nothing to cost of production, which is the exact
    // error this whole feature exists to correct.
    expect(annualChargeCents({ ...A, lifetimeLactations: 0 })).toBeNull();
    expect(annualChargeCents({ ...A, lifetimeLactations: -1 })).toBeNull();
  });

  it("refuses to depreciate her upwards", () => {
    expect(annualChargeCents({ ...A, cullCents: 300000 })).toBeNull();
  });
});

describe("perCwtCents", () => {
  it("lands in the range the spec quotes at 20,000 lb", () => {
    const perCwt = perCwtCents(annualChargeCents(A), 20000)! / 100;
    expect(perCwt).toBeGreaterThan(1.5);
    expect(perCwt).toBeLessThan(2.0);
    expect(perCwt).toBeCloseTo(1.86, 2);
  });

  it("moves with yield as much as with the spread", () => {
    // The same $371 a year is a materially different cost per hundredweight,
    // which is why the caller has to supply a yield rather than assume one.
    expect(perCwtCents(annualChargeCents(A), 16000)! / 100).toBeCloseTo(2.32, 2);
  });

  it("is null when there is no yield to divide by", () => {
    expect(perCwtCents(annualChargeCents(A), 0)).toBeNull();
    expect(perCwtCents(null, 20000)).toBeNull();
  });
});

describe("carryingValueCents", () => {
  it("is replacement cost for a springing heifer who has not calved", () => {
    expect(carryingValueCents(A, null, "2026-08-10")).toBe(220000);
  });

  it("agrees with what the SQL roll wrote for Patience", () => {
    // migration 035 rehearsal: entered production 2024-07-09, marked $1,424.58
    const value = carryingValueCents(A, "2024-07-09", "2026-08-10")!;
    expect(value / 100).toBeCloseTo(1424.58, 1);
  });

  it("floors at cull value however long she has been here", () => {
    // Ten years in: a straight line would be well below zero. She is worth her
    // cull cheque on the day she leaves.
    expect(carryingValueCents(A, "2016-08-10", "2026-08-10")).toBe(90000);
  });

  it("does not charge a year to a cow who freshened yesterday", () => {
    const value = carryingValueCents(A, "2026-08-09", "2026-08-10")!;
    expect(value).toBeGreaterThan(219800);
    expect(value).toBeLessThan(220000);
  });

  it("is null when the assumptions can't produce a charge", () => {
    expect(carryingValueCents({ ...A, lifetimeLactations: 0 }, "2024-01-01", "2026-08-10")).toBeNull();
  });
});

describe("enteredProduction", () => {
  it("takes the earlier of her first freshening and her first calving", () => {
    expect(enteredProduction(["2024-07-09"], ["2024-07-09"], "2026-08-10")).toBe("2024-07-09");
    expect(enteredProduction(["2025-01-01"], ["2024-07-09"], "2026-08-10")).toBe("2024-07-09");
  });

  it("starts her clock from whichever record exists", () => {
    // This herd was entered by hand and has calvings with no lactation and
    // lactations with no calving.
    expect(enteredProduction([], ["2024-07-09"], "2026-08-10")).toBe("2024-07-09");
    expect(enteredProduction(["2024-07-09"], [], "2026-08-10")).toBe("2024-07-09");
  });

  it("ignores anything after the date being asked about", () => {
    expect(enteredProduction(["2027-01-01"], [], "2026-08-10")).toBeNull();
  });

  it("is null for a heifer who has never calved", () => {
    expect(enteredProduction([], [], "2026-08-10")).toBeNull();
  });
});

describe("isHerdInventory", () => {
  const animal = (over: Partial<RealAnimal>): RealAnimal => ({
    id: "a",
    ear_tag: "1",
    barn_name: null,
    sex: "female",
    class: "cow",
    status: "active",
    birth_date: "2021-01-01",
    sire_id: null,
    dam_id: null,
    notes: null,
    purpose: "dairy",
    origin: "raised",
    record_type: "herd",
    ...over,
  });

  it("is the dairy string", () => {
    expect(isHerdInventory(animal({}))).toBe(true);
    expect(isHerdInventory(animal({ purpose: "dual" }))).toBe(true);
    expect(isHerdInventory(animal({ class: "heifer" }))).toBe(true);
  });

  it("leaves out a beef cow, because every assumption here is a dairy one", () => {
    expect(isHerdInventory(animal({ purpose: "beef" }))).toBe(false);
  });

  it("leaves out bulls, calves, catalogue animals and anyone gone", () => {
    expect(isHerdInventory(animal({ sex: "male", class: "bull" }))).toBe(false);
    expect(isHerdInventory(animal({ class: "calf" }))).toBe(false);
    expect(isHerdInventory(animal({ record_type: "reference" }))).toBe(false);
    expect(isHerdInventory(animal({ status: "sold" }))).toBe(false);
  });
});

describe("trailingYieldLb", () => {
  const day = (n: number) => {
    const d = new Date("2026-01-01T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const records = (days: number, gallonsPerDay: number) =>
    Array.from({ length: days }, (_, i) => ({ produced_date: day(i), quantity: gallonsPerDay, unit: "gallon" }));

  it("converts gallons to pounds and scales a partial year to a year", () => {
    const asOf = day(179);
    const got = trailingYieldLb(records(180, 5), asOf, 8.6)!;
    // 5 gal × 8.6 = 43 lb a day, every day of a year.
    expect(Math.round(got.lb)).toBe(43 * 365);
    expect(got.days).toBe(180);
  });

  it("refuses to divide by a week of records", () => {
    // Arithmetically correct, completely misleading: a week of milk would put
    // depreciation in the hundreds of dollars per hundredweight.
    expect(trailingYieldLb(records(7, 5), day(6), 8.6)).toBeNull();
  });

  it("is null when she has no records at all", () => {
    expect(trailingYieldLb([], "2026-08-10", 8.6)).toBeNull();
  });

  it("leaves pounds alone when that is what was logged", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ produced_date: day(i), quantity: 60, unit: "lb" }));
    expect(Math.round(trailingYieldLb(rows, day(119), 8.6)!.lb)).toBe(60 * 365);
  });
});

describe("gallonsToLb", () => {
  it("uses the farm's figure rather than a constant", () => {
    expect(gallonsToLb(10, 8.6)).toBeCloseTo(86);
    expect(gallonsToLb(10, 8.3)).toBeCloseTo(83);
  });
});

describe("latestValuations", () => {
  const v = (animalId: string, asOf: string, valueCents: number, basis = "marked"): Valuation => ({
    id: `${animalId}-${asOf}`,
    animalId,
    asOf,
    valueCents,
    basis,
    note: "",
  });

  it("keeps the most recent value on or before the date", () => {
    const rows = [v("cow-1", "2026-01-01", 200000), v("cow-1", "2026-06-01", 180000)];
    expect(latestValuations(rows, "2026-08-10").get("cow-1")!.valueCents).toBe(180000);
  });

  it("ignores a value dated after the date being asked about", () => {
    const rows = [v("cow-1", "2026-01-01", 200000), v("cow-1", "2027-01-01", 160000)];
    expect(latestValuations(rows, "2026-08-10").get("cow-1")!.valueCents).toBe(200000);
  });

  it("has nothing for a cow never valued", () => {
    expect(latestValuations([], "2026-08-10").get("cow-1")).toBeUndefined();
  });
});
