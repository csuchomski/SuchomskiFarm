import { describe, expect, it } from "vitest";
import {
  DEFAULT_UTILIZATION_PCT,
  assumptionsFor,
  forageEatenLbDm,
  intakePerAcre,
  planStrip,
  widthForHours,
  type ForageAssumptions,
  type GrazingEvent,
  type GrazingPlan,
  type Paddock,
} from "./grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "./__fixtures__/farm-geometry";

/**
 * What the cows do not eat.
 *
 * The graze-down gives disappearance, not intake — twelve inches down to six
 * is half the sward gone, and not half of it swallowed. Utilization is the
 * share of that take-down which reached an animal, and it is the farm's
 * figure, set on the grazing plan.
 *
 * This was two figures the app supplied: 15% trodden in, off the dry matter,
 * and 3% of the ground refused around dung, off the acres. Migration 062
 * replaced both with one number under a name a grazier uses. The tests below
 * are the same subject in the new model — the arithmetic barely moved, but
 * whose number it is did.
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

const base: ForageAssumptions = {
  standingLbDmPerAcre: 2400,
  takeDownPct: 50,
  utilizationPct: 100.0,
  intakePctBodyweight: 3,
};

const plan = (over: Partial<GrazingPlan> = {}): GrazingPlan => ({
  id: "plan", name: "2026", periodStart: null, periodEnd: null,
  contractNumber: null, tractNumber: null, fieldIds: null,
  longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
  monitoringCadenceKind: "every_rotation", monitoringCadenceValue: null,
  defaultDmiPctBw: 3, lbDmPerAcreInch: 300, targetResidualHeightIn: null,
  defaultUtilizationPct: null, tramplingLossPct: null, fouledAreaPct: null,
  active: true, notes: null, ...over,
});

const event = (over: Partial<GrazingEvent> = {}): GrazingEvent => ({
  id: "e", paddockId: "p4", groupId: "mob",
  enteredAt: "2026-08-14T12:00:00.000Z", exitedAt: null,
  headCount: 5, avgWeightLb: 1000,
  forageHeightInEntry: 9, residualHeightInExit: 6, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null, sweptFrom: 0, sweptTo: 0.2, grazedShape: null,
  ...over,
});

describe("what an acre puts into them", () => {
  it("is what is standing, times what comes off it, times what is eaten", () => {
    expect(intakePerAcre({ ...base, utilizationPct: 85 })).toBeCloseTo(2400 * 0.5 * 0.85, 6);
  });

  it("is the standing forage times the take-down when everything is eaten", () => {
    // The guarantee the migration did not silently move every figure: at full
    // utilization the two factors collapse to the original product.
    expect(intakePerAcre(base)).toBeCloseTo(2400 * 0.5, 6);
  });

  it("multiplies rather than adds, because the steps are sequential", () => {
    // 15% of the half that came off is 7.5% of what is standing, not 35%.
    expect(intakePerAcre({ ...base, utilizationPct: 85 })).toBeCloseTo(1020, 6);
    expect(intakePerAcre({ ...base, utilizationPct: 85 })).not.toBeCloseTo(2400 * 0.35, 0);
  });

  it("lands where the two old deductions did, near enough to notice if it moves", () => {
    // 15% trodden in and 3% of the ground fouled came to 0.85 x 0.97 of the
    // take-down reaching an animal. That is what the app's own utilization is
    // set near, so a farm that never touched either figure sees about the
    // same forecast it saw before.
    const old = 2400 * 0.5 * 0.85 * 0.97;
    expect(intakePerAcre({ ...base, utilizationPct: DEFAULT_UTILIZATION_PCT })).toBeGreaterThan(old);
    expect(intakePerAcre({ ...base, utilizationPct: DEFAULT_UTILIZATION_PCT }) / old).toBeCloseTo(1 / 0.97, 2);
  });
});

describe("the forecast", () => {
  const p4 = unit(4);
  const strip = (a: ForageAssumptions) =>
    planStrip({ paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000, assumptions: a })!;

  it("puts less in front of them once utilization is counted", () => {
    const all = strip(base);
    const real = strip({ ...base, utilizationPct: 85 });
    expect(real.lbDmOnOffer).toBeLessThan(all.lbDmOnOffer);
    expect(real.lbDmOnOffer).toBeCloseTo(all.lbDmOnOffer * 0.85, 6);
  });

  it("shortens the feed the strip holds, which is the number that matters", () => {
    expect(strip({ ...base, utilizationPct: 85 }).hoursOfFeed!).toBeLessThan(strip(base).hoursOfFeed!);
  });

  it("still reports the acres the wire actually encloses", () => {
    // The strip is as wide as it is. It is the feed that is less, not the
    // ground — quietly shrinking the acreage would break the map. This used
    // to be a live risk, because the fouled share came off the acres.
    const all = strip(base);
    const real = strip({ ...base, utilizationPct: 85 });
    expect(real.acres).toBeCloseTo(all.acres, 9);
    expect(real.widthFt).toBeCloseTo(all.widthFt!, 9);
  });
});

describe("sizing the wire", () => {
  const p4 = unit(4);

  it("gives them a wider strip, not a narrower one", () => {
    // The direction that matters. Eating less of what comes off means they
    // need more ground for the same feed; the wrong sign here starves them.
    const all = widthForHours({ paddock: p4, hours: 24, headCount: 5, avgWeightLb: 1000, assumptions: base })!;
    const real = widthForHours({
      paddock: p4, hours: 24, headCount: 5, avgWeightLb: 1000,
      assumptions: { ...base, utilizationPct: 85 },
    })!;
    expect(real).toBeGreaterThan(all);
  });

  it("comes back round to the feed it was asked for", () => {
    // The inverse has to invert: size a strip for 24 hours, then ask what it
    // holds, and get 24 hours back.
    const a: ForageAssumptions = { ...base, utilizationPct: 85 };
    const to = widthForHours({ paddock: p4, hours: 24, headCount: 5, avgWeightLb: 1000, assumptions: a })!;
    const s = planStrip({ paddock: p4, from: 0, to, headCount: 5, avgWeightLb: 1000, assumptions: a })!;
    expect(s.hoursOfFeed!).toBeCloseTo(24, 1);
  });
});

describe("the record, worked back from a measured residual", () => {
  const p4 = unit(4);

  it("takes utilization off what the height says came away", () => {
    const e = event({ forageHeightInEntry: 9, residualHeightInExit: 6 });
    const full = forageEatenLbDm(e, p4, plan({ defaultUtilizationPct: 100 }))!;
    const real = forageEatenLbDm(e, p4, plan({ defaultUtilizationPct: 85 }))!;
    expect(real).toBeCloseTo(full * 0.85, 6);
  });

  it("uses the same figure the forecast did, so the two agree", () => {
    // A strip forecast at one utilization and recorded at another would show
    // a farm eating more or less than planned for no reason but the code.
    const e = event({ forageHeightInEntry: 9, residualHeightInExit: 6, sweptFrom: 0, sweptTo: 0.2 });
    const recorded = forageEatenLbDm(e, p4, plan({ defaultUtilizationPct: 85 }))!;
    const forecast = planStrip({
      paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000,
      assumptions: { standingLbDmPerAcre: 9 * 300, takeDownPct: ((9 - 6) / 9) * 100, utilizationPct: 85, intakePctBodyweight: 3 },
    })!;
    expect(recorded).toBeCloseTo(forecast.lbDmOnOffer, 4);
  });

  it("falls back to the app's figure where a plan carries none", () => {
    const e = event();
    expect(forageEatenLbDm(e, p4, plan())).toBeCloseTo(
      forageEatenLbDm(e, p4, plan({ defaultUtilizationPct: DEFAULT_UTILIZATION_PCT }))!, 9);
  });
});

describe("where the figures come from", () => {
  const ask = (p: GrazingPlan | null) =>
    assumptionsFor({
      paddockId: "p4", plan: p, targets: [], availability: [], todayIso: "2026-08-16T12:00:00.000Z",
      fallback: { ...base, utilizationPct: DEFAULT_UTILIZATION_PCT },
    });

  it("uses the farm's number when the plan carries one", () => {
    const { assumptions, sources } = ask(plan({ defaultUtilizationPct: 62 }));
    expect(assumptions.utilizationPct).toBe(62);
    expect(sources.utilization).toBe("plan");
  });

  it("falls back to the app's, and says so", () => {
    const { assumptions, sources } = ask(plan());
    expect(assumptions.utilizationPct).toBe(DEFAULT_UTILIZATION_PCT);
    expect(sources.utilization).toBe("default");
  });

  it("does not take utilization from a paddock target any more", () => {
    // It used to, wherever a paddock had no heights on it — under two
    // different meanings, which is why 062 stopped reading the column. The
    // stored values show what an unread column collects: 1% on one paddock.
    const { assumptions } = assumptionsFor({
      paddockId: "p4", plan: plan(), targets: [
        { id: "t", planId: "plan", paddockId: "p4", targetEntryHeightIn: null, targetResidualHeightIn: null,
          minRecoveryDaysGrowing: null, minRecoveryDaysDormant: null, targetUtilizationPct: 1,
          plannedGrazingNotes: "", plannedDefermentNotes: "", sensitiveAreaStrategy: "", notes: "" },
      ],
      availability: [], todayIso: "2026-08-16T12:00:00.000Z",
      fallback: { ...base, utilizationPct: DEFAULT_UTILIZATION_PCT },
    });
    expect(assumptions.utilizationPct).toBe(DEFAULT_UTILIZATION_PCT);
  });
});
