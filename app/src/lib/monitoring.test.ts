import { describe, expect, it } from "vitest";
import {
  cadenceDays,
  cadenceInWords,
  coverTotal,
  monitoringDue,
  neverObserved,
  photoPointGaps,
} from "./monitoring";
import { photoRejection, MAX_PHOTO_BYTES } from "./grazing-photos";
import type { GrazingPlan, KeyArea, MonitoringRecord } from "./grazing";

/**
 * Monitoring cadence and key areas.
 *
 * The rule under test: every figure comes from the plan, and a farm with no
 * plan gets silence rather than a cadence this app made up.
 */

const NOW = "2026-08-13T12:00:00.000Z";

const plan = (over: Partial<GrazingPlan> = {}): GrazingPlan => ({
  id: "plan", name: "2026", periodStart: "2026-04-01", periodEnd: "2026-10-31",
  contractNumber: null, tractNumber: null, fieldIds: null,
  longTermGoals: null, immediateObjectives: null,
  benchmarkStockingRateAumPerAcre: null,
  monitoringCadenceKind: "every_n_days", monitoringCadenceValue: 30,
  defaultDmiPctBw: 3, lbDmPerAcreInch: 300, targetResidualHeightIn: null, active: true, notes: null,
  ...over,
});

const area = (over: Partial<KeyArea> = {}): KeyArea => ({
  id: "k1", paddockId: "p3", name: "Gate corner",
  latitude: 42.8778, longitude: -88.414, photoAzimuthDeg: 270,
  description: null, active: true,
  ...over,
});

const record = (over: Partial<MonitoringRecord> = {}): MonitoringRecord => ({
  id: "m1", keyAreaId: "k1", planId: "plan", observedOn: "2026-07-01",
  protocol: null, residualHeightIn: 4,
  groundCoverPct: null, litterPct: null, bareGroundPct: null,
  speciesComposition: null, keyPlantVigor: null,
  erosionObservations: null, compactionObservations: null,
  observer: null, notes: null, latitude: null, longitude: null,
  ...over,
});

describe("cadence comes from the plan or not at all", () => {
  it("reads a plain interval", () => {
    expect(cadenceDays(plan({ monitoringCadenceKind: "every_n_days", monitoringCadenceValue: 21 }))).toBe(21);
  });

  it("works a per-season count into an interval", () => {
    // 1 April to 31 October is 214 days; four looks is one every 53 or so.
    const d = cadenceDays(plan({ monitoringCadenceKind: "times_per_season", monitoringCadenceValue: 4 }))!;
    expect(d).toBeCloseTo(214 / 4, 1);
  });

  it("has no day count for 'every rotation', because a rotation is as long as it is", () => {
    expect(cadenceDays(plan({ monitoringCadenceKind: "every_rotation", monitoringCadenceValue: 1 }))).toBeNull();
  });

  it("says nothing at all without a plan", () => {
    expect(cadenceDays(null)).toBeNull();
    expect(cadenceInWords(null)).toBeNull();
    expect(cadenceDays(plan({ monitoringCadenceValue: null }))).toBeNull();
    expect(cadenceDays(plan({ monitoringCadenceKind: "times_per_season", periodEnd: null }))).toBeNull();
  });

  it("reads back in the plan's own terms", () => {
    expect(cadenceInWords(plan({ monitoringCadenceKind: "every_n_days", monitoringCadenceValue: 1 }))).toBe("every 1 day");
    expect(cadenceInWords(plan({ monitoringCadenceKind: "every_rotation", monitoringCadenceValue: 1 }))).toBe("every rotation");
    expect(cadenceInWords(plan({ monitoringCadenceKind: "times_per_season", monitoringCadenceValue: 4 }))).toBe("4 times a season");
  });
});

describe("whether a key area is due", () => {
  it("is due once the interval has passed", () => {
    const due = monitoringDue({ keyAreaId: "k1", records: [record()], plan: plan(), nowIso: NOW });
    expect(due.state).toBe("due");
    if (due.state === "due") {
      expect(due.daysSince).toBe(43);
      expect(due.everyDays).toBe(30);
    }
  });

  it("is not due before it", () => {
    const due = monitoringDue({
      keyAreaId: "k1", records: [record({ observedOn: "2026-08-01" })], plan: plan(), nowIso: NOW,
    });
    expect(due.state).toBe("ok");
  });

  it("counts from the most recent look, not the first", () => {
    const due = monitoringDue({
      keyAreaId: "k1",
      records: [record({ id: "old", observedOn: "2026-05-01" }), record({ observedOn: "2026-08-05" })],
      plan: plan(), nowIso: NOW,
    });
    expect(due.state).toBe("ok");
  });

  it("says 'never' rather than 'late' when nothing has been recorded", () => {
    // There is no interval to be late against until there is a first look.
    expect(monitoringDue({ keyAreaId: "k1", records: [], plan: plan(), nowIso: NOW }).state).toBe("never");
  });

  it("claims nothing when the plan sets no cadence", () => {
    expect(
      monitoringDue({ keyAreaId: "k1", records: [record()], plan: null, nowIso: NOW }).state,
    ).toBe("no-cadence");
    expect(
      monitoringDue({ keyAreaId: "k1", records: [record()], plan: plan({ monitoringCadenceValue: null }), nowIso: NOW }).state,
    ).toBe("no-cadence");
  });

  it("counts rounds rather than days for an every-rotation cadence", () => {
    const byRotation = plan({ monitoringCadenceKind: "every_rotation", monitoringCadenceValue: 1 });
    const none = monitoringDue({
      keyAreaId: "k1", records: [record()], plan: byRotation, nowIso: NOW, roundsSince: () => 0,
    });
    expect(none.state).toBe("ok");

    const one = monitoringDue({
      keyAreaId: "k1", records: [record()], plan: byRotation, nowIso: NOW, roundsSince: () => 1,
    });
    expect(one.state).toBe("due");
  });

  it("does not mix key areas up", () => {
    const other = monitoringDue({
      keyAreaId: "k2", records: [record()], plan: plan(), nowIso: NOW,
    });
    expect(other.state).toBe("never");
  });
});

describe("the key areas themselves", () => {
  it("lists the ones nobody has been to", () => {
    const areas = [area(), area({ id: "k2", name: "Wet corner" })];
    expect(neverObserved(areas, [record()]).map((a) => a.id)).toEqual(["k2"]);
  });

  it("leaves an inactive one out", () => {
    expect(neverObserved([area({ id: "k3", active: false })], [])).toEqual([]);
  });

  it("says which half of a photo point is missing", () => {
    expect(photoPointGaps(area())).toEqual([]);
    expect(photoPointGaps(area({ photoAzimuthDeg: null }))).toEqual(["no bearing"]);
    expect(photoPointGaps(area({ latitude: null, photoAzimuthDeg: null }))).toEqual([
      "no location", "no bearing",
    ]);
  });
});

describe("cover", () => {
  it("adds up what was recorded and leaves the total alone", () => {
    // 97, not 100. A reading is what somebody saw, and refusing to save it
    // would lose the reading to protect a sum.
    expect(coverTotal(record({ groundCoverPct: 80, litterPct: 12, bareGroundPct: 5 }))).toBe(97);
  });

  it("is null when nothing was recorded, rather than zero", () => {
    expect(coverTotal(record())).toBeNull();
  });
});

describe("what the bucket will take", () => {
  it("takes a phone photo", () => {
    expect(photoRejection({ type: "image/jpeg", size: 3_000_000 })).toBeNull();
    expect(photoRejection({ type: "image/heic", size: 2_000_000 })).toBeNull();
  });

  it("turns away anything that is not an image, in plain words", () => {
    expect(photoRejection({ type: "application/pdf", size: 100 })).toMatch(/not an image/);
  });

  it("turns away something too large, and says how large it was", () => {
    expect(photoRejection({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toMatch(/15 MB/);
  });
});
