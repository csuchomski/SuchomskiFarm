import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOULED_AREA_PCT,
  DEFAULT_TRAMPLING_LOSS_PCT,
  assumptionsFor,
  forageEatenLbDm,
  intakePerAcre,
  planStrip,
  usableAcres,
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
 * The graze-down gives disappearance. Intake is less than that, and the two
 * losses in between behave differently: trampled forage leaves the sward and
 * so has to come off the dry matter, while fouled forage stays standing and
 * so comes off the usable ground — and only in the forecast, because a
 * measured residual has already carried it.
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
  utilizationPct: 50,
  intakePctBodyweight: 3,
  tramplingLossPct: 0,
  fouledAreaPct: 0,
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
  it("is the standing forage times what leaves the plant times what is swallowed", () => {
    expect(intakePerAcre({ ...base, tramplingLossPct: 15 })).toBeCloseTo(2400 * 0.5 * 0.85, 6);
  });

  it("is unchanged from the old arithmetic when nothing is lost", () => {
    // The guarantee that this migration did not silently move every existing
    // figure: at zero loss the two factors collapse to the original product.
    expect(intakePerAcre(base)).toBeCloseTo(2400 * 0.5, 6);
    expect(usableAcres(3, base)).toBeCloseTo(3, 6);
  });

  it("multiplies the losses rather than adding them, because they are sequential", () => {
    // 15% trodden of the half that was removed is 7.5% of standing, not 35%.
    expect(intakePerAcre({ ...base, tramplingLossPct: 15 })).toBeCloseTo(1020, 6);
    expect(intakePerAcre({ ...base, tramplingLossPct: 15 })).not.toBeCloseTo(2400 * 0.35, 0);
  });
});

describe("the forecast", () => {
  const p4 = unit(4);

  it("puts less in front of them once the losses are counted", () => {
    const clean = planStrip({ paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000, assumptions: base })!;
    const real = planStrip({
      paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000,
      assumptions: { ...base, tramplingLossPct: 15, fouledAreaPct: 3 },
    })!;
    expect(real.lbDmOnOffer).toBeLessThan(clean.lbDmOnOffer);
    // 0.85 eaten of what went, over 97% of the ground.
    expect(real.lbDmOnOffer).toBeCloseTo(clean.lbDmOnOffer * 0.85 * 0.97, 6);
  });

  it("shortens the feed the strip holds, which is the number that matters", () => {
    const clean = planStrip({ paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000, assumptions: base })!;
    const real = planStrip({
      paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000,
      assumptions: { ...base, tramplingLossPct: 15, fouledAreaPct: 3 },
    })!;
    expect(real.hoursOfFeed!).toBeLessThan(clean.hoursOfFeed!);
  });

  it("still reports the acres the wire actually encloses", () => {
    // The strip is as wide as it is. It is the feed that is less, not the
    // ground — quietly shrinking the acreage would break the map.
    const clean = planStrip({ paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000, assumptions: base })!;
    const real = planStrip({
      paddock: p4, from: 0, to: 0.2, headCount: 5, avgWeightLb: 1000,
      assumptions: { ...base, tramplingLossPct: 15, fouledAreaPct: 3 },
    })!;
    expect(real.acres).toBeCloseTo(clean.acres, 9);
    expect(real.widthFt).toBeCloseTo(clean.widthFt!, 9);
  });
});

describe("sizing the wire", () => {
  const p4 = unit(4);

  it("gives them a wider strip, not a narrower one", () => {
    // The direction that matters. Losses mean they need more ground for the
    // same feed; getting the sign wrong here starves them.
    const clean = widthForHours({ paddock: p4, hours: 24, headCount: 5, avgWeightLb: 1000, assumptions: base })!;
    const real = widthForHours({
      paddock: p4, hours: 24, headCount: 5, avgWeightLb: 1000,
      assumptions: { ...base, tramplingLossPct: 15, fouledAreaPct: 3 },
    })!;
    expect(real).toBeGreaterThan(clean);
  });

  it("comes back round to the feed it was asked for", () => {
    // The inverse has to invert: size a strip for 24 hours, then ask what it
    // holds, and get 24 hours back.
    const a: ForageAssumptions = { ...base, tramplingLossPct: 15, fouledAreaPct: 3 };
    const to = widthForHours({ paddock: p4, hours: 24, headCount: 5, avgWeightLb: 1000, assumptions: a })!;
    const strip = planStrip({ paddock: p4, from: 0, to, headCount: 5, avgWeightLb: 1000, assumptions: a })!;
    expect(strip.hoursOfFeed!).toBeCloseTo(24, 1);
  });
});

describe("the record, worked back from a measured residual", () => {
  const p4 = unit(4);

  it("takes the trodden share off what the height says was eaten", () => {
    const e = event({ forageHeightInEntry: 9, residualHeightInExit: 6 });
    const plain = forageEatenLbDm(e, p4, plan())!;
    const real = forageEatenLbDm(e, p4, plan({ tramplingLossPct: 15 }))!;
    expect(real).toBeCloseTo(plain * 0.85, 6);
  });

  it("does not take the fouled ground off as well, which would count it twice", () => {
    // The refused fringe is still standing when the residual is read, so it
    // has already left the height difference. Discounting the area too would
    // subtract the same grass a second time.
    const e = event();
    const withFouling = forageEatenLbDm(e, p4, plan({ tramplingLossPct: 15, fouledAreaPct: 3 }))!;
    const without = forageEatenLbDm(e, p4, plan({ tramplingLossPct: 15 }))!;
    expect(withFouling).toBeCloseTo(without, 9);
  });

  it("is unchanged where a plan carries no figure", () => {
    const e = event();
    expect(forageEatenLbDm(e, p4, plan())).toBeCloseTo(
      forageEatenLbDm(e, p4, plan({ tramplingLossPct: 0 }))!, 9);
  });
});

describe("where the figures come from", () => {
  const ask = (p: GrazingPlan | null) =>
    assumptionsFor({
      paddockId: "p4", plan: p, targets: [], availability: [], todayIso: "2026-08-16T12:00:00.000Z",
      fallback: { ...base, tramplingLossPct: DEFAULT_TRAMPLING_LOSS_PCT, fouledAreaPct: DEFAULT_FOULED_AREA_PCT },
    });

  it("uses the farm's numbers when the plan carries them", () => {
    const { assumptions, sources } = ask(plan({ tramplingLossPct: 22, fouledAreaPct: 5 }));
    expect(assumptions.tramplingLossPct).toBe(22);
    expect(assumptions.fouledAreaPct).toBe(5);
    expect(sources.losses).toBe("plan");
  });

  it("falls back to the app's, and says so", () => {
    const { assumptions, sources } = ask(plan());
    expect(assumptions.tramplingLossPct).toBe(DEFAULT_TRAMPLING_LOSS_PCT);
    expect(assumptions.fouledAreaPct).toBe(DEFAULT_FOULED_AREA_PCT);
    expect(sources.losses).toBe("default");
  });

  it("takes a deliberate zero as the farm's answer, not as a missing one", () => {
    // Somebody who has decided their mob wastes nothing has said something,
    // and `?? ` rather than `||` is what keeps it.
    const { assumptions, sources } = ask(plan({ tramplingLossPct: 0, fouledAreaPct: 0 }));
    expect(assumptions.tramplingLossPct).toBe(0);
    expect(assumptions.fouledAreaPct).toBe(0);
    expect(sources.losses).toBe("plan");
  });
});
