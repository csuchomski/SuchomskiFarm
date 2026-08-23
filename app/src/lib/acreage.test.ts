import { describe, expect, it } from "vitest";
import {
  assumptionsFor, drawnSliceAcres, planStrip, stripAcres, widthForHours,
  type ForageAssumptions, type GrazingEvent, type GrazingPlan, type Paddock,
} from "./grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "./__fixtures__/farm-geometry";

/**
 * A strip's acres, measured off the drawn boundary.
 *
 * The bug this replaces: `(to − from) × unit acres` assumes a unit's area is
 * spread evenly along its sweep. Exact for a rectangle, wrong for anything
 * else — and this farm has two units that are not rectangles.
 */

const unit = (n: number): Paddock => {
  const name = `Paddock ${n}`;
  return {
    id: `p${n}`, name, code: `P${n}`,
    acresMeasured: REAL_ACRES[name], acresGrazable: REAL_ACRES[name],
    pastureId: null,
    unitType: "permanent",
    sweepHeadingDeg: REAL_SWEEP[name].headingDeg,
    sweepLengthFt: REAL_SWEEP[name].lengthFt,
    rotationOrder: n,
    seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
    noxiousSpecies: null, noxiousExtent: null,
    sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
    heavyUseNotes: null, boundary: REAL_BOUNDARIES[name], active: true, notes: null,
  };
};

const strip = (paddockId: string, from: number | null, to: number | null): GrazingEvent => ({
  id: "e", paddockId, groupId: "mob",
  enteredAt: "2026-08-13T12:00:00.000Z", exitedAt: null,
  headCount: 5, avgWeightLb: 1100,
  forageHeightInEntry: null, residualHeightInExit: null, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null,
  sweptFrom: from, sweptTo: to, grazedShape: null,
});

/** What the old arithmetic would have said. */
const byFraction = (p: Paddock, from: number, to: number) =>
  (to - from) * (p.acresGrazable ?? 0);

describe("the shortcut this replaces", () => {
  it("is badly wrong where a unit tapers", () => {
    // Paddock 4 is a wedge. Swept west to east it starts narrow — its first
    // tenth is barely seven parts in ten of an even share — and the fraction
    // cannot see it. This is the case that would have told somebody a strip
    // holds the mob a day when it holds them most of one.
    //
    // Until 046 this test used the *other* end of P4 and wanted a ratio under
    // a tenth, because the unit then ended in a ten-foot ribbon that ran under
    // Paddock 5 and was never paddock at all. The arithmetic was right about
    // that shape; the shape was wrong. What is left is a real wedge, and the
    // error it causes is smaller and still worth measuring off the boundary.
    const p4 = unit(4);
    const drawn = drawnSliceAcres(p4, 0, 0.1)!;
    expect(drawn / byFraction(p4, 0, 0.1)).toBeLessThan(0.75);
  });

  it("is wrong the other way at the wide end of the same unit", () => {
    const p4 = unit(4);
    const drawn = drawnSliceAcres(p4, 0.8, 0.9)!;
    expect(drawn / byFraction(p4, 0.8, 0.9)).toBeGreaterThan(1.2);
  });

  it("was near enough on the two units that are rectangles", () => {
    // Which is exactly why nothing ever looked wrong.
    for (const n of [2, 3]) {
      const p = unit(n);
      const drawn = drawnSliceAcres(p, 0.45, 0.55)!;
      expect(drawn / byFraction(p, 0.45, 0.55)).toBeCloseTo(1, 1);
    }
  });
});

describe("stripAcres", () => {
  it("measures off the boundary when there is one", () => {
    const p4 = unit(4);
    expect(stripAcres(strip("p4", 0.9, 1), p4)).toBeCloseTo(drawnSliceAcres(p4, 0.9, 1)!, 6);
  });

  it("adds up to the whole unit across the whole sweep", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const p = unit(n);
      const whole = drawnSliceAcres(p, 0, 1)!;
      expect(whole).toBeCloseTo(p.acresGrazable!, 2);

      // And the pieces sum to the whole, which is what makes a season's
      // strips add up to a season's grazing.
      const pieces = [0, 0.2, 0.35, 0.7, 1];
      const sum = pieces
        .slice(0, -1)
        .reduce((s, from, i) => s + (drawnSliceAcres(p, from, pieces[i + 1]) ?? 0), 0);
      expect(sum).toBeCloseTo(whole, 4);
    }
  });

  it("falls back to the fraction for a unit with no boundary", () => {
    const p = { ...unit(3), boundary: null };
    expect(stripAcres(strip("p3", 0, 0.5), p)).toBeCloseTo(0.5 * p.acresGrazable!, 6);
  });

  it("falls back for a unit with no sweep, since there is nothing to cut along", () => {
    const p = { ...unit(3), sweepHeadingDeg: null };
    expect(stripAcres(strip("p3", 0, 0.5), p)).toBeCloseTo(0.5 * p.acresGrazable!, 6);
  });

  it("still treats a grazing with no wire as the whole unit", () => {
    const p = unit(3);
    expect(stripAcres(strip("p3", null, null), p)).toBe(p.acresGrazable);
  });

  it("survives a malformed boundary rather than throwing", () => {
    const p = { ...unit(3), boundary: { type: "Polygon", coordinates: "nope" } };
    expect(stripAcres(strip("p3", 0, 0.5), p)).toBeCloseTo(0.5 * p.acresGrazable!, 6);
  });
});

describe("this morning's grass height", () => {
  const FALLBACK: ForageAssumptions = {
    standingLbDmPerAcre: 2400, takeDownPct: 50,
  utilizationPct: 100.0,
  intakePctBodyweight: 3,
  };

  const plan = (over: Partial<GrazingPlan> = {}): GrazingPlan => ({
    id: "plan", name: "2026", periodStart: null, periodEnd: null,
    contractNumber: null, tractNumber: null, fieldIds: null,
    longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
    monitoringCadenceKind: "every_rotation", monitoringCadenceValue: null,
    defaultDmiPctBw: 3, lbDmPerAcreInch: 300, targetResidualHeightIn: null,
  defaultUtilizationPct: null, tramplingLossPct: null, fouledAreaPct: null, active: true, notes: null, ...over,
  });

  const ask = (over: Parameters<typeof assumptionsFor>[0] extends infer T ? Partial<T> : never) =>
    assumptionsFor({
      paddockId: "p3", plan: plan(), targets: [], availability: [],
      todayIso: "2026-08-13T12:00:00.000Z", fallback: FALLBACK, ...over,
    });

  it("beats everything else, at the farm's own 300 lb per acre-inch", () => {
    // 7 inches deliberately, not 8 — eight would land on the fallback's own
    // 2,400 and the test would pass without proving anything.
    const got = ask({ swardHeightIn: 7 });
    expect(got.assumptions.standingLbDmPerAcre).toBe(2100);
    expect(got.sources.standing).toBe("height");
  });

  it("moves with the reading, which is the whole point of taking it", () => {
    expect(ask({ swardHeightIn: 4 }).assumptions.standingLbDmPerAcre).toBe(1200);
    expect(ask({ swardHeightIn: 12 }).assumptions.standingLbDmPerAcre).toBe(3600);
  });

  it("outranks an availability record for the same window", () => {
    const got = ask({
      swardHeightIn: 6,
      availability: [{
        id: "a1", planId: null, paddockId: "p3",
        periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "August",
        lbDmPerAcre: 1800, aum: null, speciesMix: null, qualityNote: null,
        isPlanned: false, basis: "clipping", notes: null,
      }],
    });
    // A reading taken today beats a figure recorded for the month.
    expect(got.assumptions.standingLbDmPerAcre).toBe(1800);
    expect(got.sources.standing).toBe("height");
  });

  it("needs both halves — a height with no conversion is just a number", () => {
    expect(ask({ swardHeightIn: 8, plan: plan({ lbDmPerAcreInch: null }) }).sources.standing).toBe("default");
    expect(ask({ swardHeightIn: null }).sources.standing).toBe("default");
    expect(ask({ swardHeightIn: 0 }).sources.standing).toBe("default");
  });
});

describe("the forecast, on ground that is not a rectangle", () => {
  /**
   * `stripAcres` answers what a recorded strip was; `planStrip` answers what
   * the one being placed would be. They are the same question at different
   * times and were not, for a while, the same arithmetic — the record measured
   * the boundary and the forecast still spread the acres evenly along the
   * sweep. That is the number on the screen while the wire is being dragged,
   * which makes it the more consequential of the two.
   */
  const ASSUMPTIONS: ForageAssumptions = {
    standingLbDmPerAcre: 2400, takeDownPct: 50,
  utilizationPct: 100.0,
  intakePctBodyweight: 3,
  };

  it("measures the strip it is forecasting, rather than its share of the sweep", () => {
    // Paddock 4's first sixteenth, at the narrow end of the wedge. A flat
    // share calls it 0.139 acres; the ground gives about seven tenths of that.
    const plan = planStrip({
      paddock: unit(4), from: 0, to: 0.0625,
      headCount: 5, avgWeightLb: 1000, assumptions: ASSUMPTIONS,
    })!;
    const measured = drawnSliceAcres(unit(4), 0, 0.0625)!;
    expect(plan.acres).toBeCloseTo(measured, 6);
    expect(plan.acres).toBeLessThan(0.0625 * (unit(4).acresGrazable ?? 0) * 0.8);
  });

  it("agrees with what the same strip is once it has been grazed", () => {
    for (const [from, to] of [[0, 0.1], [0.4, 0.55], [0.9, 1]]) {
      const plan = planStrip({
        paddock: unit(4), from, to,
        headCount: 5, avgWeightLb: 1000, assumptions: ASSUMPTIONS,
      })!;
      const recorded = stripAcres(strip("p4", from, to), unit(4))!;
      expect(plan.acres).toBeCloseTo(recorded, 6);
    }
  });
});

describe("placing the wire for a day", () => {
  const ASSUMPTIONS: ForageAssumptions = {
    standingLbDmPerAcre: 2400, takeDownPct: 50,
  utilizationPct: 100.0,
  intakePctBodyweight: 3,
  };
  const day = (paddock: Paddock, from: number) =>
    widthForHours({ paddock, hours: 24, from, headCount: 5, avgWeightLb: 1000, assumptions: ASSUMPTIONS });

  it("puts a day's width where a day's feed actually is", () => {
    // 5 head x 1,000 lb x 3% = 150 lb a day, over 1,200 lb usable an acre:
    // an eighth of an acre, wherever along the sweep it falls.
    for (const from of [0, 0.25, 0.5, 0.8, 0.95]) {
      const w = day(unit(4), from)!;
      const acres = drawnSliceAcres(unit(4), from, from + w);
      if (from + w >= 1) continue; // ran out of unit; nothing to check
      expect(acres!).toBeCloseTo(0.125, 3);
    }
  });

  it("widens as the unit narrows, instead of holding one figure throughout", () => {
    // Paddock 4 is a wedge, narrow at the western end it is swept from, so the
    // same day's feed is a longer reach there than at the wide end.
    const narrow = day(unit(4), 0)!;
    const wide = day(unit(4), 0.7)!;
    expect(narrow).toBeGreaterThan(wide * 1.4);
  });

  it("stops at the end of the unit rather than past it", () => {
    const w = day(unit(4), 0.99)!;
    expect(w).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it("falls back to the flat share when there is no boundary to cut", () => {
    const blind = { ...unit(2), boundary: null };
    const w = day(blind, 0.5)!;
    // An eighth of an acre out of 1.932 — the old arithmetic, still the best
    // available when nothing is drawn.
    expect(w).toBeCloseTo(0.125 / 1.932, 6);
  });
});
