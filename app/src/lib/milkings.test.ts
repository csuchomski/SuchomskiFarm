import { describe, expect, it } from "vitest";
import {
  byAnimal,
  enteredEntries,
  findMilkProduct,
  milkForLactation,
  peakOf,
  totalOf,
  unattributedBatches,
  unattributedMilk,
  validateMilkings,
  type MilkingEntry,
  type RealProductionRecord,
} from "./milkings";
import type { RealLactation } from "./lactations";

const rec = (over: Partial<RealProductionRecord> = {}): RealProductionRecord => ({
  id: over.id ?? "r1",
  animal_id: over.animal_id ?? "a1",
  product_id: over.product_id ?? 1,
  product_name: "Milk",
  quantity: over.quantity ?? 5,
  unit: "gallon",
  produced_date: over.produced_date ?? "2026-08-04",
  // `??` would turn an explicit null back into 13, making a batch-less
  // record impossible to express — which is exactly the case being tested.
  batch_id: "batch_id" in over ? (over.batch_id ?? null) : 13,
  note: "",
});

const lac = (over: Partial<RealLactation> = {}): RealLactation => ({
  id: over.id ?? "l1",
  animal_id: over.animal_id ?? "a1",
  lactation_number: 1,
  fresh_date: over.fresh_date ?? "2026-01-01",
  dry_off_date: over.dry_off_date ?? null,
  calving_id: null,
  peak_milk_lb: null,
  peak_dim: null,
  total_yield_lb: null,
  me305_lb: null,
  termination_reason: "",
});

const TODAY = "2026-08-06";
const e = (animalId: string, quantity: string): MilkingEntry => ({ animalId, quantity });

describe("enteredEntries / totalOf", () => {
  it("ignores blank boxes rather than storing zeros", () => {
    // A blank means "not milked". Writing a 0.000 row for every dry cow
    // every day would bury the real production.
    const entries = [e("a1", "5"), e("a2", ""), e("a3", "  ")];
    expect(enteredEntries(entries)).toEqual([{ animalId: "a1", quantity: 5 }]);
  });

  it("keeps an explicit zero, which is a real answer", () => {
    expect(enteredEntries([e("a1", "0")])).toEqual([{ animalId: "a1", quantity: 0 }]);
  });

  it("totals what was entered", () => {
    expect(totalOf([e("a1", "5"), e("a2", "2"), e("a3", "")])).toBe(7);
  });

  it("doesn't accumulate floating-point noise", () => {
    expect(totalOf([e("a1", "0.1"), e("a2", "0.2")])).toBe(0.3);
  });
});

describe("validateMilkings", () => {
  it("accepts a normal entry", () => {
    expect(validateMilkings([e("a1", "5")], TODAY, "2026-08-04")).toBeNull();
  });

  it("rejects a future date", () => {
    expect(validateMilkings([e("a1", "5")], TODAY, "2026-09-01")).toMatch(/future/);
  });

  it("accepts today", () => {
    expect(validateMilkings([e("a1", "5")], TODAY, TODAY)).toBeNull();
  });

  it("rejects an empty sheet", () => {
    expect(validateMilkings([e("a1", ""), e("a2", "")], TODAY, TODAY)).toMatch(/at least one/);
  });

  it("rejects nonsense and negatives", () => {
    expect(validateMilkings([e("a1", "abc")], TODAY, TODAY)).toMatch(/numbers/);
    expect(validateMilkings([e("a1", "-2")], TODAY, TODAY)).toMatch(/negative/);
  });
});

describe("milkForLactation", () => {
  const records = [
    rec({ id: "r1", animal_id: "a1", produced_date: "2026-02-01", quantity: 5 }),
    rec({ id: "r2", animal_id: "a1", produced_date: "2026-03-01", quantity: 4 }),
    rec({ id: "r3", animal_id: "a2", produced_date: "2026-03-01", quantity: 9 }),
    rec({ id: "r4", animal_id: "a1", produced_date: "2025-12-01", quantity: 7 }),
  ];

  it("sums only this cow's milk inside the window", () => {
    expect(milkForLactation(lac({ animal_id: "a1", fresh_date: "2026-01-01" }), records)).toBe(9);
  });

  it("excludes milk from before she freshened", () => {
    // r4 predates the lactation; counting it would inflate the total with
    // the previous lactation's milk.
    expect(milkForLactation(lac({ animal_id: "a1", fresh_date: "2026-02-15" }), records)).toBe(4);
  });

  it("counts the dry-off day itself", () => {
    const l = lac({ animal_id: "a1", fresh_date: "2026-01-01", dry_off_date: "2026-03-01" });
    expect(milkForLactation(l, records)).toBe(9);
  });

  it("excludes milk after dry-off", () => {
    const l = lac({ animal_id: "a1", fresh_date: "2026-01-01", dry_off_date: "2026-02-15" });
    expect(milkForLactation(l, records)).toBe(5);
  });

  it("is zero when she has no milk recorded", () => {
    expect(milkForLactation(lac({ animal_id: "zzz" }), records)).toBe(0);
  });
});

describe("peakOf", () => {
  it("sums a day before comparing, so twice-a-day milking isn't halved", () => {
    // The failure this guards: taking the largest single record would
    // report 4 as the peak when she actually gave 7 that day.
    const records = [
      rec({ id: "am", produced_date: "2026-02-10", quantity: 4 }),
      rec({ id: "pm", produced_date: "2026-02-10", quantity: 3 }),
      rec({ id: "other", produced_date: "2026-02-11", quantity: 5 }),
    ];
    expect(peakOf(lac({ fresh_date: "2026-02-01" }), records)).toEqual({ quantity: 7, dim: 9 });
  });

  it("reports days in milk at the peak, not the date", () => {
    const records = [rec({ produced_date: "2026-01-31", quantity: 6 })];
    expect(peakOf(lac({ fresh_date: "2026-01-01" }), records)).toEqual({ quantity: 6, dim: 30 });
  });

  it("breaks a tie on the earlier day", () => {
    const records = [
      rec({ id: "late", produced_date: "2026-03-01", quantity: 5 }),
      rec({ id: "early", produced_date: "2026-02-01", quantity: 5 }),
    ];
    expect(peakOf(lac({ fresh_date: "2026-01-01" }), records)?.dim).toBe(31);
  });

  it("is null with nothing recorded", () => {
    expect(peakOf(lac(), [])).toBeNull();
  });

  it("ignores another cow's records", () => {
    expect(peakOf(lac({ animal_id: "a1" }), [rec({ animal_id: "a2", quantity: 99 })])).toBeNull();
  });
});

describe("unattributedMilk", () => {
  it("finds milk recorded outside any lactation", () => {
    const records = [
      rec({ id: "in", animal_id: "a1", produced_date: "2026-02-01" }),
      rec({ id: "out", animal_id: "a1", produced_date: "2025-06-01" }),
    ];
    const found = unattributedMilk(records, [lac({ animal_id: "a1", fresh_date: "2026-01-01" })]);
    expect(found.map((r) => r.id)).toEqual(["out"]);
  });

  it("treats a cow with no lactation at all as unattributed", () => {
    // This is the current state of the farm: milk on record, no lactations.
    expect(unattributedMilk([rec()], [])).toHaveLength(1);
  });
});

describe("unattributedBatches", () => {
  it("finds batches no milking points at", () => {
    // Batches 15 and 16 are real: added straight from the Store screen.
    const batches = [
      { id: 13, product_id: 1, produced_date: "2026-08-04", quantity: 7 },
      { id: 15, product_id: 1, produced_date: "2026-08-05", quantity: 1 },
    ];
    const found = unattributedBatches(batches, [rec({ batch_id: 13 })]);
    expect(found.map((b) => b.id)).toEqual([15]);
  });

  it("ignores records with no batch at all", () => {
    const batches = [{ id: 13, product_id: 1, produced_date: "2026-08-04", quantity: 7 }];
    expect(unattributedBatches(batches, [rec({ batch_id: null })]).map((b) => b.id)).toEqual([13]);
  });
});

describe("findMilkProduct", () => {
  const p = (id: number, name: string, type_code?: string | null) => ({ id, name, unit: "gallon", type_code });

  it("prefers the typed product over a name match", () => {
    // "Milk soap" matches the name rule; type_code is the reliable answer.
    const found = findMilkProduct([p(9, "Milk soap", "soap"), p(1, "Raw Jersey", "milk")]);
    expect(found?.id).toBe(1);
  });

  it("falls back to the name before migration 008 populates type_code", () => {
    expect(findMilkProduct([p(3, "Eggs"), p(1, "Milk")])?.id).toBe(1);
  });

  it("is null when the business sells no milk, rather than guessing", () => {
    // Guessing here would write eggs against a cow.
    expect(findMilkProduct([p(3, "Eggs", "eggs"), p(4, "Pork", "meat")])).toBeNull();
  });

  it("is null for an empty product list", () => {
    expect(findMilkProduct([])).toBeNull();
  });

  it("carries the product's own unit rather than assuming gallons", () => {
    const found = findMilkProduct([{ id: 7, name: "Milk", unit: "litre", type_code: "milk" }]);
    expect(found).toEqual({ id: 7, name: "Milk", unit: "litre" });
  });
});

describe("byAnimal", () => {
  it("totals a cow's records into one row", () => {
    const rows = byAnimal([
      rec({ id: "a", animal_id: "a1", quantity: 5, produced_date: "2026-08-04" }),
      rec({ id: "b", animal_id: "a1", quantity: 4, produced_date: "2026-08-07" }),
    ]);
    expect(rows).toEqual([{ animalId: "a1", total: 9, days: 2, first: "2026-08-04", last: "2026-08-07" }]);
  });

  it("counts distinct days, not records", () => {
    // Milked twice on one day is one day of production, not two.
    const rows = byAnimal([
      rec({ id: "am", animal_id: "a1", quantity: 4, produced_date: "2026-08-04" }),
      rec({ id: "pm", animal_id: "a1", quantity: 3, produced_date: "2026-08-04" }),
    ]);
    expect(rows[0]).toMatchObject({ total: 7, days: 1 });
  });

  it("puts the heaviest producer first", () => {
    const rows = byAnimal([
      rec({ id: "x", animal_id: "light", quantity: 2 }),
      rec({ id: "y", animal_id: "heavy", quantity: 9 }),
    ]);
    expect(rows.map((r) => r.animalId)).toEqual(["heavy", "light"]);
  });

  it("is bounded by the herd, not the number of records", () => {
    // The bug this replaces: one cell per record grew without limit.
    const many = Array.from({ length: 200 }, (_, i) =>
      rec({ id: `r${i}`, animal_id: i % 2 ? "a1" : "a2", quantity: 1, produced_date: `2026-01-${(i % 28) + 1}` }),
    );
    expect(byAnimal(many)).toHaveLength(2);
  });

  it("is empty for no records", () => {
    expect(byAnimal([])).toEqual([]);
  });
});
