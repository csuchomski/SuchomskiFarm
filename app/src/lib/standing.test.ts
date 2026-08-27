import { describe, expect, it } from "vitest";
import {
  inRotation,
  mobWeight,
  nextInRotation,
  openingWire,
  standingOf,
  type ForageAssumptions,
  type GrazingEvent,
  type GrazingGroupMember,
  type Paddock,
} from "./grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "./__fixtures__/farm-geometry";

/**
 * The morning, answered without asking.
 *
 * They are here, the back line is where yesterday's wire ended, and the next
 * unit is the one after this in the round.
 */

const unit = (n: number, over: Partial<Paddock> = {}): Paddock => {
  const name = `Paddock ${n}`;
  // The fixture covers the farm's five; anything past them is a stand-in for
  // a unit outside the rotation, so it falls back rather than throwing.
  const sweep = REAL_SWEEP[name] ?? { headingDeg: 270, lengthFt: 400 };
  return {
    id: `p${n}`, name, code: `P${n}`,
    acresMeasured: REAL_ACRES[name] ?? 1, acresGrazable: REAL_ACRES[name] ?? 1,
    pastureId: null,
    unitType: "permanent",
    sweepHeadingDeg: sweep.headingDeg,
    sweepLengthFt: sweep.lengthFt,
    rotationOrder: n,
    seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
    noxiousSpecies: null, noxiousExtent: null,
    sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
    heavyUseNotes: null, boundary: REAL_BOUNDARIES[name] ?? null, active: true, notes: null,
    ...over,
  };
};

const farm = [1, 2, 3, 4, 5].map((n) => unit(n));

const strip = (
  paddockId: string, from: number | null, to: number | null, exited: string | null,
): GrazingEvent => ({
  id: `e-${paddockId}-${from}`, paddockId, groupId: "mob",
  enteredAt: "2026-08-12T12:00:00.000Z", exitedAt: exited,
  headCount: 5, avgWeightLb: 1100,
  forageHeightInEntry: null, residualHeightInExit: null, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null,
  sweptFrom: from, sweptTo: to, grazedShape: null,
});

const ASSUMPTIONS: ForageAssumptions = {
  standingLbDmPerAcre: 2400, takeDownPct: 50,
  utilizationPct: 100.0,
  intakePctBodyweight: 3,
};

describe("the round", () => {
  it("walks P1 to P5 in order", () => {
    const shuffled = [farm[3], farm[0], farm[4], farm[2], farm[1]];
    expect(inRotation(shuffled).map((p) => p.name)).toEqual([
      "Paddock 1", "Paddock 2", "Paddock 3", "Paddock 4", "Paddock 5",
    ]);
  });

  it("wraps: after the last comes the first", () => {
    expect(nextInRotation(farm[3], farm)!.name).toBe("Paddock 5");
    expect(nextInRotation(farm[4], farm)!.name).toBe("Paddock 1");
  });

  it("keeps a unit with no place in the round out of the sequence but on the list", () => {
    const spare = unit(6, { id: "p6", name: "The lane", rotationOrder: null });
    const all = [...farm, spare];
    expect(inRotation(all).map((p) => p.name).at(-1)).toBe("The lane");
    expect(nextInRotation(farm[4], all)!.name).toBe("Paddock 1");
    expect(nextInRotation(spare, all)).toBeNull();
  });

  it("has no next when nothing is ordered", () => {
    const loose = farm.map((p) => ({ ...p, rotationOrder: null }));
    expect(nextInRotation(loose[0], loose)).toBeNull();
  });
});

describe("where they stand", () => {
  it("finds the unit and yesterday's wire without being told", () => {
    const events = [strip("p3", 0.2, 0.35, null)];
    const s = standingOf({ groupId: "mob", paddocks: farm, events });
    expect(s.paddock!.name).toBe("Paddock 3");
    expect(s.backLine).toBe(0.35);
    expect(s.next!.name).toBe("Paddock 4");
  });

  it("puts the back line at the start when they are off pasture", () => {
    const s = standingOf({ groupId: "mob", paddocks: farm, events: [] });
    expect(s.paddock).toBeNull();
    expect(s.backLine).toBe(0);
    expect(s.next).toBeNull();
  });

  it("puts the back line at the start of a unit taken whole", () => {
    // No wire recorded, so there is no line behind them yet.
    const s = standingOf({ groupId: "mob", paddocks: farm, events: [strip("p2", null, null, null)] });
    expect(s.backLine).toBe(0);
  });

  it("ignores another mob's open event", () => {
    const theirs = { ...strip("p1", 0, 0.4, null), groupId: "other" };
    expect(standingOf({ groupId: "mob", paddocks: farm, events: [theirs] }).paddock).toBeNull();
  });
});

describe("where the wire opens", () => {
  it("is never on the back line — there would be nothing to grab", () => {
    for (const back of [0, 0.25, 0.9, 0.999]) {
      const w = openingWire({
        paddock: farm[2], backLine: back,
        headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
      });
      expect(w).toBeGreaterThan(back);
    }
  });

  it("opens at about a day's width", () => {
    const w = openingWire({
      paddock: farm[2], backLine: 0,
      headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    });
    // 5 head x 1,100 lb x 3% = 165 lb a day over 1,200 lb usable an acre.
    expect(w).toBeCloseTo(0.1375 / (farm[2].acresGrazable ?? 1) * 1, 2);
  });

  it("starts from the back line rather than from the top of the unit", () => {
    const fresh = openingWire({
      paddock: farm[2], backLine: 0, headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    });
    const onward = openingWire({
      paddock: farm[2], backLine: 0.5, headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    });
    expect(onward - 0.5).toBeCloseTo(fresh, 6);
  });

  it("still gives something grabbable when nobody has been weighed", () => {
    const w = openingWire({
      paddock: farm[2], backLine: 0.4, headCount: 5, avgWeightLb: null, assumptions: ASSUMPTIONS,
    });
    expect(w).toBeGreaterThan(0.44);
    expect(w).toBeLessThan(0.5);
  });

  it("never runs past the end of the unit", () => {
    expect(openingWire({
      paddock: farm[2], backLine: 0.99, headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    })).toBe(1);
  });
});

describe("what the mob weighs", () => {
  const members: GrazingGroupMember[] = [1, 2, 3, 4, 5].map((n) => ({
    id: `m${n}`, groupId: "mob", animalId: `a${n}`, joinedOn: null, leftOn: null, animalStatus: "active",
  }));

  it("adds the real weights rather than multiplying an average", () => {
    // Mixed sizes, which is the whole reason weight is per animal.
    const w = new Map([["a1", 1200], ["a2", 1100], ["a3", 950], ["a4", 1050], ["a5", 700]]);
    const got = mobWeight(members, "mob", w);
    expect(got.totalLb).toBe(5000);
    expect(got.weighed).toBe(5);
    expect(got.missing).toBe(0);
  });

  it("says how many are missing rather than quietly totalling some of them", () => {
    const got = mobWeight(members, "mob", new Map([["a1", 1200], ["a2", 1100]]));
    expect(got.totalLb).toBe(2300);
    expect(got.weighed).toBe(2);
    expect(got.missing).toBe(3);
  });

  it("is null rather than zero when nobody has been weighed", () => {
    expect(mobWeight(members, "mob", new Map()).totalLb).toBeNull();
  });

  it("leaves out an animal that has left the mob", () => {
    const gone = members.map((m) => (m.animalId === "a5" ? { ...m, leftOn: "2026-08-01" } : m));
    const got = mobWeight(gone, "mob", new Map([["a1", 1200], ["a5", 700]]));
    expect(got.totalLb).toBe(1200);
    expect(got.missing).toBe(3);
  });
});

describe("the round is walked inside a pasture", () => {
  /**
   * Green Pastures runs six pieces of ground. Nobody finishes the last
   * paddock of the home place and steps onto the first of a lease eight
   * miles away — and once each pasture numbers its own paddocks 1..n, a
   * farm-wide ring cannot even say which "1" it means.
   */
  const north = [1, 2, 3].map((n) => unit(n, { pastureId: "north" }));
  const creek = [4, 5].map((n) => unit(n, { pastureId: "creek", rotationOrder: n - 3 }));
  const both = [...north, ...creek];

  it("wraps within the pasture rather than crossing to the next one", () => {
    expect(nextInRotation(north[2], both)!.name).toBe("Paddock 1");
    expect(nextInRotation(creek[1], both)!.name).toBe("Paddock 4");
  });

  it("does not step across when the numbers repeat in each pasture", () => {
    // Both pastures hold a paddock numbered 1. A farm-wide ring would pick
    // one of them arbitrarily and send the mob to the wrong property.
    expect(nextInRotation(creek[0], both)!.name).toBe("Paddock 5");
  });

  it("has no next when a pasture holds one paddock", () => {
    const alone = unit(9, { id: "p9", name: "The lease", pastureId: "lease", rotationOrder: 1 });
    expect(nextInRotation(alone, [...both, alone])).toBeNull();
  });

  it("is one ring on a farm whose paddocks carry no pasture", () => {
    // Which is every farm on file before any of this, and has to read the
    // same way afterwards.
    expect(nextInRotation(farm[4], farm)!.name).toBe("Paddock 1");
  });

  it("rings the unassigned ground together on a farm that does use pastures", () => {
    // Not "no next": they are a ring of their own until somebody says where
    // they are.
    const loose = [6, 7].map((n) => unit(n, { rotationOrder: n - 5 }));
    const all = [...north, ...loose];
    expect(nextInRotation(loose[1], all)!.name).toBe("Paddock 6");
  });
});
