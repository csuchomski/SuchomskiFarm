import { describe, expect, it } from "vitest";
import {
  assumptionsFor, forageEatenLbDm, grazeDownTo, joinRefusal, planStrip, stripAcres, widthForHours,
  type ForageAssumptions, type GrazingEvent, type GrazingGroupMember, type GrazingPlan, type Paddock,
  type PlanPaddockTarget,
} from "./grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "./__fixtures__/farm-geometry";

/**
 * In at eight inches, off at four.
 *
 * The app used to take a height, turn it into pounds standing, and discount it
 * by a utilization percentage — a number nobody on a farm sets or measures. A
 * grazier sets a graze-down, and what comes off is the difference. So
 * utilization stops being an input here and becomes an outcome, which is what
 * lets every figure downstream carry on multiplying standing by utilization
 * and land on the right answer without knowing any of this.
 *
 * The failure worth guarding is the quiet one: applying the graze-down *and*
 * the percentage, and halving the feed twice.
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

const plan = (over: Partial<GrazingPlan> = {}): GrazingPlan => ({
  id: "plan", name: "2026", periodStart: null, periodEnd: null,
  contractNumber: null, tractNumber: null, fieldIds: null,
  longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
  monitoringCadenceKind: "every_rotation", monitoringCadenceValue: null,
  defaultDmiPctBw: 3, lbDmPerAcreInch: 300, targetResidualHeightIn: null,
  tramplingLossPct: null, fouledAreaPct: null,
  active: true, notes: null, ...over,
});

const target = (over: Partial<PlanPaddockTarget> = {}): PlanPaddockTarget => ({
  id: "t1", planId: "plan", paddockId: "p3",
  targetEntryHeightIn: null, targetResidualHeightIn: null,
  minRecoveryDaysGrowing: null, minRecoveryDaysDormant: null,
  targetUtilizationPct: null, plannedGrazingNotes: null, plannedDefermentNotes: null,
  sensitiveAreaStrategy: null, notes: null, ...over,
});

const FALLBACK: ForageAssumptions = {
  standingLbDmPerAcre: 2400, utilizationPct: 50, intakePctBodyweight: 3, tramplingLossPct: 0, fouledAreaPct: 0,
};

const ask = (over: Partial<Parameters<typeof assumptionsFor>[0]> = {}) =>
  assumptionsFor({
    paddockId: "p3", plan: plan(), targets: [], availability: [],
    todayIso: "2026-08-14T12:00:00.000Z", fallback: FALLBACK, ...over,
  });

describe("which graze-down applies", () => {
  it("prefers the one set this morning over everything on file", () => {
    const got = grazeDownTo({
      paddockId: "p3",
      plan: plan({ targetResidualHeightIn: 4 }),
      targets: [target({ targetResidualHeightIn: 3 })],
      override: 5,
    });
    expect(got).toEqual({ inches: 5, source: "today" });
  });

  it("prefers the paddock's target over the farm's default", () => {
    const got = grazeDownTo({
      paddockId: "p3",
      plan: plan({ targetResidualHeightIn: 4 }),
      targets: [target({ targetResidualHeightIn: 3 })],
    });
    expect(got).toEqual({ inches: 3, source: "paddock" });
  });

  it("falls back to the farm's default", () => {
    const got = grazeDownTo({ paddockId: "p3", plan: plan({ targetResidualHeightIn: 4 }), targets: [] });
    expect(got).toEqual({ inches: 4, source: "plan" });
  });

  it("takes another paddock's target as no answer at all", () => {
    const got = grazeDownTo({
      paddockId: "p3", plan: plan(), targets: [target({ paddockId: "p9", targetResidualHeightIn: 3 })],
    });
    expect(got.inches).toBeNull();
  });

  it("says nothing rather than zero when it has not been set", () => {
    expect(grazeDownTo({ paddockId: "p3", plan: plan(), targets: [] }).inches).toBeNull();
  });
});

describe("the graze-down, as forage", () => {
  it("puts on offer exactly what lies between the two heights", () => {
    // 8″ in, 4″ out, at 300 lb an acre-inch = 1,200 lb an acre.
    const got = ask({ swardHeightIn: 8, grazeToIn: 4 });
    const usable =
      got.assumptions.standingLbDmPerAcre * (got.assumptions.utilizationPct / 100);
    expect(usable).toBeCloseTo(1200, 6);
  });

  it("does not discount twice", () => {
    // The bug this exists to catch: the paddock also carries a 50% target, and
    // taking both would leave 600 lb an acre rather than 1,200.
    const got = ask({
      swardHeightIn: 8, grazeToIn: 4,
      targets: [target({ targetUtilizationPct: 50 })],
    });
    const usable =
      got.assumptions.standingLbDmPerAcre * (got.assumptions.utilizationPct / 100);
    expect(usable).toBeCloseTo(1200, 6);
    expect(got.sources.utilization).toBe("graze-down");
  });

  it("makes utilization the outcome rather than the input", () => {
    // Taking 8″ down to 6″ is a quarter of the sward, whatever anyone typed.
    expect(ask({ swardHeightIn: 8, grazeToIn: 6 }).assumptions.utilizationPct).toBeCloseTo(25, 6);
    expect(ask({ swardHeightIn: 10, grazeToIn: 2 }).assumptions.utilizationPct).toBeCloseTo(80, 6);
  });

  it("leaves more standing when they are pulled off higher", () => {
    const hard = ask({ swardHeightIn: 8, grazeToIn: 3 }).assumptions.utilizationPct;
    const easy = ask({ swardHeightIn: 8, grazeToIn: 6 }).assumptions.utilizationPct;
    expect(easy).toBeLessThan(hard);
  });

  it("uses the paddock's planned entry height when none was taken today", () => {
    const got = ask({
      grazeToIn: 4,
      targets: [target({ targetEntryHeightIn: 8 })],
    });
    expect(got.assumptions.utilizationPct).toBeCloseTo(50, 6);
    expect(got.grazeDown.entryIn).toBe(8);
  });

  it("keeps the typed percentage when there is no height to subtract from", () => {
    const got = ask({ grazeToIn: 4, targets: [target({ targetUtilizationPct: 40 })] });
    expect(got.assumptions.utilizationPct).toBe(40);
    expect(got.sources.utilization).toBe("plan");
  });

  it("ignores a graze-down at or above the grass, rather than going negative", () => {
    // Nothing to take. A zero or negative utilization would make the strip
    // infinitely wide, which is the sort of thing that gets a paddock ruined.
    for (const to of [8, 9, 20]) {
      const got = ask({ swardHeightIn: 8, grazeToIn: to });
      expect(got.assumptions.utilizationPct).toBe(50);
      expect(got.sources.utilization).toBe("default");
      expect(got.grazeDown.residualIn).toBeNull();
    }
  });

  it("names where the height came from, so the page can show its working", () => {
    expect(ask({ swardHeightIn: 8, grazeToIn: 4 }).grazeDown.source).toBe("today");
    expect(ask({ swardHeightIn: 8, targets: [target({ targetResidualHeightIn: 4 })] }).grazeDown.source)
      .toBe("paddock");
    expect(ask({ swardHeightIn: 8, plan: plan({ targetResidualHeightIn: 4 }) }).grazeDown.source)
      .toBe("plan");
  });
});

describe("what it does to the strip", () => {
  const assumed = (entry: number, to: number) =>
    ask({ swardHeightIn: entry, grazeToIn: to }).assumptions;

  it("feeds them for longer off the same ground when grazed harder", () => {
    const soft = planStrip({
      paddock: unit(3), from: 0, to: 0.1, headCount: 5, avgWeightLb: 1000,
      assumptions: assumed(8, 6),
    })!;
    const hard = planStrip({
      paddock: unit(3), from: 0, to: 0.1, headCount: 5, avgWeightLb: 1000,
      assumptions: assumed(8, 3),
    })!;
    expect(hard.hoursOfFeed!).toBeGreaterThan(soft.hoursOfFeed!);
    expect(hard.lbDmOnOffer).toBeGreaterThan(soft.lbDmOnOffer);
    // Same acres either way — the ground did not move, only what comes off it.
    expect(hard.acres).toBeCloseTo(soft.acres, 9);
  });

  it("says how many pounds the strip puts in front of them", () => {
    const s = planStrip({
      paddock: unit(3), from: 0, to: 0.1, headCount: 5, avgWeightLb: 1000,
      assumptions: assumed(8, 4),
    })!;
    // 1,200 lb an acre between the two heights, over the acres actually cut.
    expect(s.lbDmOnOffer).toBeCloseTo(s.acres * 1200, 6);
  });

  it("needs a narrower strip for a day when they are asked to graze harder", () => {
    const soft = widthForHours({
      paddock: unit(3), hours: 24, from: 0, headCount: 5, avgWeightLb: 1000,
      assumptions: assumed(8, 6),
    })!;
    const hard = widthForHours({
      paddock: unit(3), hours: 24, from: 0, headCount: 5, avgWeightLb: 1000,
      assumptions: assumed(8, 3),
    })!;
    expect(hard).toBeLessThan(soft);
  });
});

describe("what a logged move says they ate", () => {
  const event = (over: Partial<GrazingEvent> = {}): GrazingEvent => ({
    id: "e1", paddockId: "p3", groupId: "mob",
    enteredAt: "2026-08-13T12:00:00.000Z", exitedAt: null,
    headCount: 5, avgWeightLb: 1000,
    forageHeightInEntry: 8, residualHeightInExit: null, utilizationPct: 50,
    soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
    latitude: null, longitude: null,
    sweptFrom: 0, sweptTo: 0.1, grazedShape: null, ...over,
  });

  it("is the acres times what came off an acre", () => {
    const p = unit(3);
    const got = forageEatenLbDm(event(), p, plan())!;
    // 8″ × 300 = 2,400 standing, half of it taken = 1,200 an acre — over the
    // acres the boundary actually gives, not a tenth of the unit. Even
    // Paddock 3, which looks rectangular, is out by half a percent.
    expect(got).toBeCloseTo(stripAcres(event(), p)! * 1200, 6);
  });

  it("agrees with what the strip was forecast to hold", () => {
    const forecast = planStrip({
      paddock: unit(3), from: 0, to: 0.1, headCount: 5, avgWeightLb: 1000,
      assumptions: ask({ swardHeightIn: 8, grazeToIn: 4 }).assumptions,
    })!;
    const recorded = forageEatenLbDm(event(), unit(3), plan())!;
    expect(recorded).toBeCloseTo(forecast.lbDmOnOffer, 6);
  });

  it("believes the residual that was measured over the one that was aimed at", () => {
    // Sized for half, but they took it to 2″ — three quarters of an 8″ sward.
    const got = forageEatenLbDm(event({ residualHeightInExit: 2 }), unit(3), plan())!;
    const aimed = forageEatenLbDm(event(), unit(3), plan())!;
    expect(got / aimed).toBeCloseTo(1.5, 6);
  });

  it("says nothing rather than zero when the record cannot support a figure", () => {
    expect(forageEatenLbDm(event({ forageHeightInEntry: null }), unit(3), plan())).toBeNull();
    expect(forageEatenLbDm(event({ utilizationPct: null }), unit(3), plan())).toBeNull();
    expect(forageEatenLbDm(event(), unit(3), plan({ lbDmPerAcreInch: null }))).toBeNull();
    expect(forageEatenLbDm(event(), unit(3), null)).toBeNull();
  });

  it("measures the ground it is pricing, on a unit that is not a rectangle", () => {
    // Paddock 4 is a wedge, narrow at the west where its sweep starts. The
    // same twentieth of the sweep is worth much less feed there than at the
    // wide end, and a flat share would price both the same.
    const narrow = forageEatenLbDm(
      event({ paddockId: "p4", sweptFrom: 0, sweptTo: 0.05 }), unit(4), plan(),
    )!;
    const wide = forageEatenLbDm(
      event({ paddockId: "p4", sweptFrom: 0.85, sweptTo: 0.9 }), unit(4), plan(),
    )!;
    expect(narrow).toBeLessThan(wide * 0.6);
  });
});

describe("who is in the mob", () => {
  /**
   * `grazing_group_members` has no unique index on an open membership — only a
   * check that a leaving date is not before a joining date. So two open rows
   * for one animal are possible, and `mobWeight` sums per member: she would be
   * counted twice, the mob would read heavier than it is, and every strip cut
   * from that figure would be too wide. The guard is the app's to make.
   */
  const roll = (over: Partial<GrazingGroupMember>[]): GrazingGroupMember[] =>
    over.map((o, i) => ({
      id: `m${i}`, groupId: "mob", animalId: `a${i}`, joinedOn: "2026-04-01", leftOn: null, ...o,
    }));

  it("refuses to put her in the same mob twice", () => {
    expect(joinRefusal(roll([{ animalId: "a0" }]), "a0", "mob")).toMatch(/already in this mob/);
  });

  it("refuses to put her in a second mob while she is still in the first", () => {
    expect(joinRefusal(roll([{ animalId: "a0", groupId: "mob" }]), "a0", "other"))
      .toMatch(/another mob/);
  });

  it("lets her back in once she has left", () => {
    // Not an error: she was moved between mobs, or sold on and bought back.
    // The old row stays, which is what keeps July's head count honest.
    expect(joinRefusal(roll([{ animalId: "a0", leftOn: "2026-07-01" }]), "a0", "mob")).toBeNull();
  });

  it("has nothing to say about an animal in no mob at all", () => {
    expect(joinRefusal(roll([{ animalId: "a9" }]), "a0", "mob")).toBeNull();
    expect(joinRefusal([], "a0", "mob")).toBeNull();
  });
});
