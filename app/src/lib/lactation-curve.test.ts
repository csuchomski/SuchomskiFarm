import { describe, expect, it } from "vitest";
import {
  animalsWithCurves,
  compareWithPrevious,
  curveBins,
  dimOf,
  scaleTo100,
  summarise,
  type ProductionRecord,
} from "./lactation-curve";
import type { RealLactation } from "./lactations";

const TODAY = "2026-08-07";

const lac = (over: Partial<RealLactation> = {}): RealLactation => ({
  id: over.id ?? "l1",
  animal_id: over.animal_id ?? "a1",
  lactation_number: over.lactation_number ?? 1,
  fresh_date: over.fresh_date ?? "2026-01-01",
  dry_off_date: "dry_off_date" in over ? over.dry_off_date! : null,
  calving_id: null,
  peak_milk_lb: null,
  peak_dim: null,
  total_yield_lb: null,
  me305_lb: null,
  termination_reason: "",
});

const rec = (date: string, quantity: number, animalId = "a1"): ProductionRecord => ({
  animal_id: animalId,
  produced_date: date,
  quantity,
});

describe("dimOf", () => {
  it("counts the freshening day as day zero", () => {
    expect(dimOf(lac({ fresh_date: "2026-01-01" }), "2026-01-01")).toBe(0);
    expect(dimOf(lac({ fresh_date: "2026-01-01" }), "2026-01-08")).toBe(7);
  });
});

describe("curveBins", () => {
  it("bins milk into weeks of lactation", () => {
    const bins = curveBins(lac({ fresh_date: "2026-01-01" }), [
      rec("2026-01-01", 5),
      rec("2026-01-03", 5),
      rec("2026-01-08", 9),
    ]);
    expect(bins).toHaveLength(2);
    expect(bins[0]).toMatchObject({ from: 0, to: 6, total: 10, daysRecorded: 2 });
    expect(bins[1]).toMatchObject({ from: 7, to: 13, total: 9 });
  });

  it("averages over the whole week, not just the days with records", () => {
    // One milking of 7 in a week is 1/day, not 7/day. Averaging over the
    // recorded days alone would report her as giving 7 every day.
    const bins = curveBins(lac(), [rec("2026-01-01", 7)]);
    expect(bins[0].perDay).toBe(1);
  });

  it("keeps an empty week rather than closing the gap", () => {
    // A week she gave nothing is part of the shape of the curve; dropping it
    // would slide the following weeks left and flatter the decline.
    const bins = curveBins(lac(), [rec("2026-01-01", 5), rec("2026-01-20", 5)]);
    expect(bins).toHaveLength(3);
    expect(bins[1]).toMatchObject({ total: 0, daysRecorded: 0 });
  });

  it("stops at the last week with data rather than padding to 305 days", () => {
    const bins = curveBins(lac(), [rec("2026-01-01", 5)]);
    expect(bins).toHaveLength(1);
  });

  it("ignores milk from before she freshened", () => {
    const bins = curveBins(lac({ fresh_date: "2026-02-01" }), [rec("2026-01-15", 99), rec("2026-02-01", 5)]);
    expect(bins).toHaveLength(1);
    expect(bins[0].total).toBe(5);
  });

  it("ignores milk after dry-off", () => {
    const l = lac({ fresh_date: "2026-01-01", dry_off_date: "2026-01-07" });
    expect(curveBins(l, [rec("2026-01-05", 5), rec("2026-02-01", 99)])[0].total).toBe(5);
  });

  it("ignores another cow's milk", () => {
    expect(curveBins(lac({ animal_id: "a1" }), [rec("2026-01-01", 99, "a2")])).toEqual([]);
  });

  it("is empty with nothing recorded", () => {
    expect(curveBins(lac(), [])).toEqual([]);
  });

  it("honours a different bin width", () => {
    const bins = curveBins(lac(), [rec("2026-01-01", 1), rec("2026-01-02", 1)], 1);
    expect(bins).toHaveLength(2);
    expect(bins[0].total).toBe(1);
  });
});

describe("summarise", () => {
  it("totals a lactation and finds its peak day", () => {
    const rows = summarise(
      [lac({ fresh_date: "2026-01-01" })],
      [rec("2026-01-01", 4), rec("2026-01-15", 6), rec("2026-02-01", 3)],
      TODAY,
    );
    expect(rows[0]).toMatchObject({ total: 13, peak: 6, peakDim: 14 });
  });

  it("sums a day's milkings before calling it the peak", () => {
    // Milked twice at 4 is a peak of 8, not 4.
    const rows = summarise([lac()], [rec("2026-01-10", 4), rec("2026-01-10", 4), rec("2026-01-20", 7)], TODAY);
    expect(rows[0].peak).toBe(8);
  });

  it("breaks a peak tie on the earlier day", () => {
    const rows = summarise([lac()], [rec("2026-01-10", 5), rec("2026-02-10", 5)], TODAY);
    expect(rows[0].peakDim).toBe(9);
  });

  it("measures an open lactation up to today", () => {
    const rows = summarise([lac({ fresh_date: "2026-08-01" })], [rec("2026-08-02", 5)], TODAY);
    expect(rows[0]).toMatchObject({ days: 6, open: true });
  });

  it("measures a closed one to its dry-off", () => {
    const rows = summarise([lac({ fresh_date: "2026-01-01", dry_off_date: "2026-01-11" })], [], TODAY);
    expect(rows[0]).toMatchObject({ days: 10, open: false });
  });

  it("has no peak when nothing was recorded", () => {
    expect(summarise([lac()], [], TODAY)[0]).toMatchObject({ total: 0, peak: null, peakDim: null });
  });

  it("orders by lactation number, oldest first", () => {
    const rows = summarise(
      [lac({ id: "l3", lactation_number: 3 }), lac({ id: "l1", lactation_number: 1 })],
      [],
      TODAY,
    );
    expect(rows.map((r) => r.number)).toEqual([1, 3]);
  });
});

describe("scaleTo100", () => {
  it("scales every series against one shared peak", () => {
    // The point of two series is comparison. Scaling each to its own maximum
    // would draw the weaker lactation exactly like the stronger one.
    expect(scaleTo100([[10, 5], [4, 2]])).toEqual([[100, 50], [40, 20]]);
  });

  it("is all zeros when nothing was produced", () => {
    expect(scaleTo100([[0, 0]])).toEqual([[0, 0]]);
  });

  it("copes with an empty series alongside a real one", () => {
    expect(scaleTo100([[8], []])).toEqual([[100], []]);
  });
});

describe("compareWithPrevious", () => {
  const first = lac({ id: "l1", lactation_number: 1, fresh_date: "2025-01-01", dry_off_date: "2025-03-01" });
  const second = lac({ id: "l2", lactation_number: 2, fresh_date: "2026-01-01" });

  const records = [
    // Lactation 1: 4 then 8 in weeks 1 and 2.
    rec("2025-01-01", 4),
    rec("2025-01-08", 8),
    // Lactation 2: 6 then 10 in the same two weeks.
    rec("2026-01-01", 6),
    rec("2026-01-08", 10),
  ];

  it("aligns the two on days-in-milk, not on the calendar", () => {
    // A year apart, but week 1 lines up against week 1 — the only way the
    // comparison means anything.
    const c = compareWithPrevious(second, [first, second], records, TODAY);
    expect(c.bins[0]).toMatchObject({ from: 0, current: 6, previous: 4 });
    expect(c.bins[1]).toMatchObject({ from: 7, current: 10, previous: 8 });
  });

  it("scales both against the same peak", () => {
    const c = compareWithPrevious(second, [first, second], records, TODAY);
    // 10 is the tallest bar anywhere, so it's 100 and 8 is 80.
    expect(c.heights[1]).toEqual({ current: 100, previous: 80 });
  });

  it("names the lactation it compared against", () => {
    const c = compareWithPrevious(second, [first, second], records, TODAY);
    expect(c.previous?.number).toBe(1);
    expect(c.current.number).toBe(2);
  });

  it("has no previous for a first lactation", () => {
    const c = compareWithPrevious(first, [first, second], records, TODAY);
    expect(c.previous).toBeNull();
    expect(c.bins.every((b) => b.previous === 0)).toBe(true);
  });

  it("pads to the longer of the two so a shorter lactation doesn't truncate it", () => {
    const longer = [...records, rec("2026-01-20", 3)];
    const c = compareWithPrevious(second, [first, second], longer, TODAY);
    expect(c.bins).toHaveLength(3);
    expect(c.bins[2]).toMatchObject({ current: 3, previous: 0 });
  });

  it("compares against another cow's lactation never", () => {
    const other = lac({ id: "lx", animal_id: "a2", lactation_number: 1, fresh_date: "2025-01-01" });
    const c = compareWithPrevious(second, [other, second], [...records, rec("2025-01-01", 99, "a2")], TODAY);
    expect(c.previous).toBeNull();
  });
});

describe("animalsWithCurves", () => {
  it("groups lactations per cow, biggest producer first", () => {
    const rows = animalsWithCurves(
      [
        lac({ id: "l1", animal_id: "small", lactation_number: 1 }),
        lac({ id: "l2", animal_id: "big", lactation_number: 1 }),
      ],
      [rec("2026-01-02", 2, "small"), rec("2026-01-02", 20, "big")],
      TODAY,
    );
    expect(rows.map((r) => r.animalId)).toEqual(["big", "small"]);
    expect(rows[0].total).toBe(20);
  });

  it("leaves out a lactation with no milk recorded, which has no curve to draw", () => {
    expect(animalsWithCurves([lac()], [], TODAY)).toEqual([]);
  });

  it("pools a cow's lactations into one entry", () => {
    const rows = animalsWithCurves(
      [
        lac({ id: "l1", lactation_number: 1, fresh_date: "2025-01-01", dry_off_date: "2025-06-01" }),
        lac({ id: "l2", lactation_number: 2, fresh_date: "2026-01-01" }),
      ],
      [rec("2025-02-01", 5), rec("2026-02-01", 7)],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: 12 });
    expect(rows[0].lactations).toHaveLength(2);
  });
});
