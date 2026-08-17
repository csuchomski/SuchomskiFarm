import { describe, expect, it } from "vitest";
import {
  daysOfFeed,
  demandLbDm,
  forageBalance,
  gapInWords,
  periodDays,
  supplyLbDm,
} from "./balance";
import type { ForageAvailability, ForageDemand, ForageRemoval, Paddock } from "./grazing";

/**
 * The feed and forage balance.
 *
 * The rule under test throughout: pounds and AUM are never converted into one
 * another, and a balance that cannot honestly be struck says so.
 */

const p3: Paddock = {
  id: "p3", name: "Paddock 3", code: "P3",
  acresMeasured: 1.97, acresGrazable: 1.97,
  pastureId: null,
  unitType: "permanent", sweepHeadingDeg: 270, sweepLengthFt: 424, rotationOrder: null,
  seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
  noxiousSpecies: null, noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
};

const avail = (over: Partial<ForageAvailability> = {}): ForageAvailability => ({
  id: "a1", planId: null, paddockId: "p3",
  periodStart: "2026-06-01", periodEnd: "2026-06-30", periodLabel: "June",
  lbDmPerAcre: 2400, aum: null, speciesMix: null, qualityNote: null,
  isPlanned: false, basis: "clipping", notes: null,
  ...over,
});

const want = (over: Partial<ForageDemand> = {}): ForageDemand => ({
  id: "d1", planId: null, paddockId: "p3", groupId: "mob", kind: "livestock",
  periodStart: "2026-06-01", periodEnd: "2026-06-30", periodLabel: "June",
  headCount: 5, animalClass: null, avgWeightLb: 1100, dmiPctBw: 3,
  demandLbDm: null, demandAum: null, notes: null,
  ...over,
});

describe("periods", () => {
  it("counts a month as a month", () => {
    expect(periodDays("2026-06-01", "2026-06-30")).toBe(30);
    expect(periodDays("2026-05-01", "2026-05-31")).toBe(31);
    expect(periodDays("2026-06-01", "2026-06-01")).toBe(1);
  });
});

describe("what a mob eats", () => {
  it("computes from head, weight and intake", () => {
    // 5 head x 1,100 lb x 3% = 165 lb a day, over 30 days.
    expect(demandLbDm(want(), null)).toBeCloseTo(4950);
  });

  it("takes intake from the plan when the row does not say", () => {
    expect(demandLbDm(want({ dmiPctBw: null }), 3)).toBeCloseTo(4950);
    // And the row wins over the plan when both are there.
    expect(demandLbDm(want({ dmiPctBw: 2.5 }), 3)).toBeCloseTo(4125);
  });

  it("takes a stated figure as given — that is how wildlife is entered", () => {
    const wildlife = want({ kind: "wildlife", headCount: null, avgWeightLb: null, demandLbDm: 800 });
    expect(demandLbDm(wildlife, 3)).toBe(800);
  });

  it("is null rather than zero when there is nothing to go on", () => {
    expect(demandLbDm(want({ avgWeightLb: null }), 3)).toBeNull();
    expect(demandLbDm(want({ dmiPctBw: null }), null)).toBeNull();
  });

  it("never invents an AUM from head and weight", () => {
    // Turning animals into AUM needs an assumption about the month. The row
    // said nothing about AUM, so neither does the balance.
    const [line] = forageBalance({
      paddocks: [p3], availability: [avail({ lbDmPerAcre: null, aum: 4 })], demand: [want()],
    });
    expect(line.demandAum).toBeNull();
    expect(line.balanceAum).toBeNull();
  });
});

describe("what is there to eat", () => {
  it("multiplies the per-acre figure by the unit's grazable acres", () => {
    expect(supplyLbDm(avail(), p3)).toBeCloseTo(2400 * 1.97);
  });

  it("is null when the unit has no acreage to stand on", () => {
    expect(supplyLbDm(avail(), { ...p3, acresGrazable: null, acresMeasured: null })).toBeNull();
    expect(supplyLbDm(avail(), null)).toBeNull();
  });
});

describe("the balance", () => {
  it("nets supply, hay and demand in the same window", () => {
    const hay: ForageRemoval = {
      id: "h1", paddockId: "p3", removedOn: "2026-06-15",
      kind: "hay", cuttingNumber: 1, yieldLb: 1000, yieldBasis: "weighed", notes: null,
    };
    const [line] = forageBalance({
      paddocks: [p3], availability: [avail()], demand: [want()], removals: [hay],
    });
    expect(line.supplyLbDm).toBeCloseTo(4728);
    expect(line.hayLbDm).toBe(1000);
    expect(line.demandLbDm).toBeCloseTo(4950);
    // 4,728 standing less 1,000 baled less 4,950 eaten: short.
    expect(line.balanceLbDm).toBeCloseTo(-1222);
    expect(line.gap).toBeNull();
  });

  it("ignores hay cut outside the window", () => {
    const hay: ForageRemoval = {
      id: "h1", paddockId: "p3", removedOn: "2026-08-15",
      kind: "hay", cuttingNumber: 2, yieldLb: 1000, yieldBasis: "weighed", notes: null,
    };
    const [line] = forageBalance({
      paddocks: [p3], availability: [avail()], demand: [want()], removals: [hay],
    });
    expect(line.hayLbDm).toBeNull();
  });

  it("adds up several rows on the same unit and window", () => {
    const [line] = forageBalance({
      paddocks: [p3],
      availability: [avail(), avail({ id: "a2", lbDmPerAcre: 100 })],
      demand: [want(), want({ id: "d2", kind: "wildlife", headCount: null, avgWeightLb: null, demandLbDm: 300 })],
    });
    expect(line.supplyLbDm).toBeCloseTo(2500 * 1.97);
    expect(line.demandLbDm).toBeCloseTo(4950 + 300);
  });

  it("keeps AUM and pounds in separate columns, never netting across", () => {
    const [line] = forageBalance({
      paddocks: [p3],
      availability: [avail({ lbDmPerAcre: null, aum: 6 })],
      demand: [want({ headCount: null, avgWeightLb: null, demandAum: 4 })],
    });
    expect(line.balanceAum).toBe(2);
    expect(line.balanceLbDm).toBeNull();
    expect(line.gap).toBeNull();
  });

  it("refuses to net pounds against AUM, and says why", () => {
    const [line] = forageBalance({
      paddocks: [p3],
      availability: [avail({ lbDmPerAcre: null, aum: 6 })],
      demand: [want()], // computed in pounds
    });
    expect(line.balanceLbDm).toBeNull();
    expect(line.balanceAum).toBeNull();
    expect(line.gap).toBe("different-units");
    expect(gapInWords(line.gap)).toMatch(/yours to make, not this app's/);
  });

  it("names a missing side rather than treating it as nothing", () => {
    const supplyOnly = forageBalance({ paddocks: [p3], availability: [avail()], demand: [] });
    expect(supplyOnly[0].gap).toBe("no-demand");
    expect(supplyOnly[0].balanceLbDm).toBeNull();

    const demandOnly = forageBalance({ paddocks: [p3], availability: [], demand: [want()] });
    expect(demandOnly[0].gap).toBe("no-supply");
  });

  it("says a row is incomplete rather than balancing against a guess", () => {
    const [line] = forageBalance({
      paddocks: [p3], availability: [avail()], demand: [want({ avgWeightLb: null, dmiPctBw: null })],
    });
    expect(line.gap).toBe("incomplete");
    expect(line.balanceLbDm).toBeNull();
  });

  it("does not apportion a June figure across half-June windows", () => {
    // Splitting supply across a window it was not measured over assumes
    // growth is even through the month, which is exactly what a grazier
    // would argue with. Two lines, each naming what it is missing.
    const lines = forageBalance({
      paddocks: [p3],
      availability: [avail()],
      demand: [want({ periodStart: "2026-06-01", periodEnd: "2026-06-15", periodLabel: null })],
    });
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.gap).sort()).toEqual(["no-demand", "no-supply"]);
  });

  it("keeps a whole-farm row apart from a unit's", () => {
    const lines = forageBalance({
      paddocks: [p3],
      availability: [avail()],
      demand: [want({ id: "d9", paddockId: null, kind: "wildlife", headCount: null, avgWeightLb: null, demandLbDm: 500 })],
    });
    expect(lines).toHaveLength(2);
    const farm = lines.find((l) => l.paddockId === null)!;
    expect(farm.paddockName).toBeNull();
    expect(farm.demandLbDm).toBe(500);
  });

  it("orders by period then unit, so a season reads down the page", () => {
    const lines = forageBalance({
      paddocks: [p3],
      availability: [
        avail({ id: "a2", periodStart: "2026-07-01", periodEnd: "2026-07-31", periodLabel: "July" }),
        avail(),
      ],
      demand: [],
    });
    expect(lines.map((l) => l.period.label)).toEqual(["June", "July"]);
  });

  it("names the window from whichever row carried a label", () => {
    const [line] = forageBalance({
      paddocks: [p3],
      availability: [avail({ periodLabel: null })],
      demand: [want({ periodLabel: "Second round" })],
    });
    expect(line.period.label).toBe("Second round");
  });
});

describe("daysOfFeed", () => {
  it("turns a surplus into the figure a grazier actually wants", () => {
    const [line] = forageBalance({
      paddocks: [p3],
      availability: [avail({ lbDmPerAcre: 5000 })], // 9,850 lb standing
      demand: [want()], // 165 lb a day
    });
    expect(line.balanceLbDm).toBeCloseTo(4900);
    expect(daysOfFeed(line, null)).toBeCloseTo(4900 / 165, 1);
  });

  it("is null on a shortfall — 'minus nine days' is not a thing", () => {
    const [line] = forageBalance({ paddocks: [p3], availability: [avail()], demand: [want()] });
    expect(line.balanceLbDm).toBeLessThan(0);
    expect(daysOfFeed(line, null)).toBeNull();
  });

  it("is null when there is no daily demand to divide by", () => {
    const [line] = forageBalance({
      paddocks: [p3],
      availability: [avail({ lbDmPerAcre: 5000 })],
      demand: [want({ headCount: null, avgWeightLb: null, demandLbDm: 100 })],
    });
    // A stated lump has a daily rate too, over its own window.
    expect(daysOfFeed(line, null)).toBeCloseTo((9850 - 100) / (100 / 30), 0);
  });
});
