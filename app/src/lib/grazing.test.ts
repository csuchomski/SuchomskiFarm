import { describe, expect, it } from "vitest";
import {
  animalDays,
  animalUnits,
  boardRows,
  deleteEffect,
  groupAvgWeightLb,
  groupHeadCount,
  nextEligible,
  occupancyDays,
  prefillFrom,
  restDays,
  stockingDensityLbPerAcre,
  whereIs,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingGroupMember,
  type Paddock,
  type PlanPaddockTarget,
} from "./grazing";

/**
 * The board is arithmetic over the move log, so this is where it is right or
 * wrong. Five units and one mob of five head, as on the farm; the flat 1.91
 * acres is a fixture rather than the real figures, which differ per unit
 * since 040 measured them off the KML.
 */

const NOW = "2026-08-13T12:00:00.000Z";

const paddock = (over: Partial<Paddock> & { id: string; name: string }): Paddock => ({
  code: null,
  acresMeasured: 1.91,
  acresGrazable: 1.91,
  unitType: "permanent",
  sweepHeadingDeg: null,
  sweepLengthFt: null, rotationOrder: null,
  seedingDate: null,
  fenceType: null,
  ecologicalSite: null,
  soilMapUnit: null,
  noxiousSpecies: null,
  noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null,
  boundary: null,
  active: true,
  notes: null,
  ...over,
});

const event = (over: Partial<GrazingEvent> & { id: string; paddockId: string }): GrazingEvent => ({
  groupId: "mob",
  enteredAt: "2026-08-01T12:00:00.000Z",
  exitedAt: null,
  headCount: 5,
  avgWeightLb: 1100,
  forageHeightInEntry: null,
  residualHeightInExit: null,
  utilizationPct: null,
  soilMoisture: null,
  supplementalFeed: false,
  weatherNotes: null,
  notes: null,
  latitude: null,
  longitude: null,
  sweptFrom: null,
  sweptTo: null,
  grazedShape: null,
  ...over,
});

const mob: GrazingGroup = {
  id: "mob",
  name: "Main mob",
  species: "cattle",
  class: "mixed",
  headCountManual: null,
  avgWeightLbManual: null,
  active: true,
  notes: null,
};

describe("animalUnits", () => {
  it("is a thousand pounds of live weight", () => {
    expect(animalUnits(5, 1100)).toBeCloseTo(5.5);
    expect(animalUnits(1, 1000)).toBe(1);
  });

  it("is null rather than zero when nothing was recorded", () => {
    // Zero would read as "no cattle here", which is a different claim from
    // "nobody wrote down how many".
    expect(animalUnits(null, 1100)).toBeNull();
    expect(animalUnits(5, null)).toBeNull();
  });
});

describe("occupancy", () => {
  it("counts whole days, and a flash graze is zero", () => {
    const e = event({
      id: "e",
      paddockId: "p1",
      enteredAt: "2026-08-12T16:00:00.000Z",
      exitedAt: "2026-08-13T08:00:00.000Z",
    });
    expect(occupancyDays(e, NOW)).toBe(0);
  });

  it("runs to now while they are still in there", () => {
    const e = event({ id: "e", paddockId: "p1", enteredAt: "2026-08-10T12:00:00.000Z" });
    expect(occupancyDays(e, NOW)).toBe(3);
  });

  it("gives animal-days as head times days", () => {
    const e = event({
      id: "e",
      paddockId: "p1",
      enteredAt: "2026-08-09T12:00:00.000Z",
      exitedAt: "2026-08-13T12:00:00.000Z",
    });
    expect(animalDays(e, NOW)).toBe(20);
  });
});

describe("stockingDensityLbPerAcre", () => {
  it("is live weight over grazable acres", () => {
    // 5 head at 1,100 lb on 1.91 acres.
    const got = stockingDensityLbPerAcre(event({ id: "e", paddockId: "p1" }), paddock({ id: "p1", name: "Paddock 1" }))!;
    expect(Math.round(got)).toBe(2880);
  });

  it("falls back to measured acres when grazable isn't recorded", () => {
    const p = paddock({ id: "p1", name: "Paddock 1", acresGrazable: null, acresMeasured: 2 });
    expect(stockingDensityLbPerAcre(event({ id: "e", paddockId: "p1" }), p)).toBe(2750);
  });

  it("is null when acres or weight are unknown, rather than guessed", () => {
    const noAcres = paddock({ id: "p1", name: "Paddock 1", acresGrazable: null, acresMeasured: null });
    expect(stockingDensityLbPerAcre(event({ id: "e", paddockId: "p1" }), noAcres)).toBeNull();
    expect(
      stockingDensityLbPerAcre(event({ id: "e", paddockId: "p1", avgWeightLb: null }), paddock({ id: "p1", name: "P" })),
    ).toBeNull();
  });
});

describe("restDays", () => {
  const grazed = event({
    id: "e1",
    paddockId: "p1",
    enteredAt: "2026-08-01T12:00:00.000Z",
    exitedAt: "2026-08-06T12:00:00.000Z",
  });

  it("counts from the day they left", () => {
    const r = restDays("p1", [grazed], NOW);
    expect(r).toEqual({ state: "rested", days: 7, since: "2026-08-06T12:00:00.000Z" });
  });

  it("says occupied rather than a number when they are still in it", () => {
    const r = restDays("p1", [grazed, event({ id: "e2", paddockId: "p1" })], NOW);
    expect(r.state).toBe("occupied");
  });

  it("distinguishes never grazed from long rested", () => {
    // A paddock never grazed has no history, which is not the same as having
    // rested since the beginning of the record.
    expect(restDays("p9", [grazed], NOW)).toEqual({ state: "never" });
  });

  it("counts from the most recent exit when it has been grazed twice", () => {
    const earlier = event({
      id: "e0",
      paddockId: "p1",
      enteredAt: "2026-06-01T12:00:00.000Z",
      exitedAt: "2026-06-05T12:00:00.000Z",
    });
    expect(restDays("p1", [earlier, grazed], NOW)).toMatchObject({ days: 7 });
  });
});

describe("nextEligible", () => {
  const rested = { state: "rested" as const, days: 7, since: "2026-08-06T12:00:00.000Z" };

  it("adds the recovery target to the day they left", () => {
    expect(nextEligible(rested, 30)).toEqual({ readyOn: "2026-09-05", met: false, shortBy: 23 });
  });

  it("says so when the target is met", () => {
    expect(nextEligible(rested, 5)).toMatchObject({ met: true, shortBy: 0 });
  });

  it("is null when the plan has no figure for this paddock", () => {
    // Silence, not a default. Inventing a recovery period is an agronomic
    // recommendation this app has no standing to make.
    expect(nextEligible(rested, null)).toBeNull();
  });

  it("is null for a paddock that is occupied or never grazed", () => {
    expect(nextEligible({ state: "occupied" }, 30)).toBeNull();
    expect(nextEligible({ state: "never" }, 30)).toBeNull();
  });
});

describe("boardRows", () => {
  const paddocks = [1, 2, 3, 4, 5].map((n) => paddock({ id: `p${n}`, name: `Paddock ${n}`, code: `P${n}` }));

  const events: GrazingEvent[] = [
    // P1 grazed and left twelve days ago
    event({ id: "a", paddockId: "p1", enteredAt: "2026-07-28T12:00:00.000Z", exitedAt: "2026-08-01T12:00:00.000Z", residualHeightInExit: 4 }),
    // P2 left three days ago
    event({ id: "b", paddockId: "p2", enteredAt: "2026-08-05T12:00:00.000Z", exitedAt: "2026-08-10T12:00:00.000Z", residualHeightInExit: 3.5 }),
    // P3 occupied now
    event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z" }),
  ];

  it("puts the longest-rested paddock at the top", () => {
    const rows = boardRows({ paddocks, events, groups: [mob], targets: [], nowIso: NOW });
    expect(rows.map((r) => r.paddock.name)).toEqual([
      "Paddock 1", // 12 days
      "Paddock 2", // 3 days
      "Paddock 4", // never grazed
      "Paddock 5",
      "Paddock 3", // occupied — not a candidate
    ]);
  });

  it("names who is in the occupied one, and for how long", () => {
    const rows = boardRows({ paddocks, events, groups: [mob], targets: [], nowIso: NOW });
    const p3 = rows.find((r) => r.paddock.id === "p3")!;
    expect(p3.occupant?.group?.name).toBe("Main mob");
    expect(p3.occupant?.days).toBe(3);
  });

  it("carries the last residual height off the last grazing", () => {
    const rows = boardRows({ paddocks, events, groups: [mob], targets: [], nowIso: NOW });
    expect(rows.find((r) => r.paddock.id === "p1")!.lastResidualIn).toBe(4);
    expect(rows.find((r) => r.paddock.id === "p4")!.lastResidualIn).toBeNull();
  });

  it("has no eligibility to report without a plan", () => {
    const rows = boardRows({ paddocks, events, groups: [mob], targets: [], nowIso: NOW });
    expect(rows.every((r) => r.eligible === null)).toBe(true);
  });

  it("uses the growing-season recovery figure by default and the dormant one when asked", () => {
    const targets: PlanPaddockTarget[] = [
      {
        id: "t1",
        planId: "plan",
        paddockId: "p1",
        targetEntryHeightIn: 9,
        targetResidualHeightIn: 4,
        minRecoveryDaysGrowing: 30,
        minRecoveryDaysDormant: 60,
        targetUtilizationPct: 50,
        plannedGrazingNotes: null,
        plannedDefermentNotes: null,
        sensitiveAreaStrategy: null,
        notes: null,
      },
    ];
    const growing = boardRows({ paddocks, events, groups: [mob], targets, nowIso: NOW });
    const dormant = boardRows({ paddocks, events, groups: [mob], targets, nowIso: NOW, season: "dormant" });
    expect(growing.find((r) => r.paddock.id === "p1")!.eligible).toMatchObject({ readyOn: "2026-08-31" });
    expect(dormant.find((r) => r.paddock.id === "p1")!.eligible).toMatchObject({ readyOn: "2026-09-30" });
  });

  it("leaves an inactive paddock off the board entirely", () => {
    const withRetired = [...paddocks, paddock({ id: "p6", name: "Old lot", active: false })];
    const rows = boardRows({ paddocks: withRetired, events, groups: [mob], targets: [], nowIso: NOW });
    expect(rows.some((r) => r.paddock.id === "p6")).toBe(false);
  });
});

describe("whereIs", () => {
  it("finds the mob's open event", () => {
    const events = [event({ id: "c", paddockId: "p3" })];
    expect(whereIs("mob", events)?.paddockId).toBe("p3");
  });

  it("is null when they are off pasture, which is a real answer", () => {
    const events = [event({ id: "a", paddockId: "p1", exitedAt: "2026-08-01T12:00:00.000Z" })];
    expect(whereIs("mob", events)).toBeNull();
  });
});

describe("group head count and weight", () => {
  const members: GrazingGroupMember[] = [
    { id: "m1", groupId: "mob", animalId: "a1", joinedOn: "2026-08-13", leftOn: null },
    { id: "m2", groupId: "mob", animalId: "a2", joinedOn: "2026-08-13", leftOn: null },
    { id: "m3", groupId: "mob", animalId: "a3", joinedOn: "2026-01-01", leftOn: "2026-06-01" },
  ];

  it("counts the members who are still in the mob", () => {
    expect(groupHeadCount(mob, members)).toBe(2);
  });

  it("lets a stated figure override the members", () => {
    expect(groupHeadCount({ ...mob, headCountManual: 5 }, members)).toBe(5);
  });

  it("is null rather than zero for an empty mob", () => {
    expect(groupHeadCount(mob, [])).toBeNull();
  });

  it("averages the members' most recent weights", () => {
    const weights = new Map([
      ["a1", 1000],
      ["a2", 1200],
      ["a3", 500], // gone from the mob; must not drag the average down
    ]);
    expect(groupAvgWeightLb(mob, members, weights)).toBe(1100);
  });

  it("averages only the ones that have been weighed", () => {
    expect(groupAvgWeightLb(mob, members, new Map([["a1", 1000]]))).toBe(1000);
  });

  it("is null when nobody has been weighed, so the form stays blank", () => {
    expect(groupAvgWeightLb(mob, members, new Map())).toBeNull();
  });
});

describe("prefillFrom", () => {
  it("prefers the derived figures over the last move's", () => {
    const last = event({ id: "a", paddockId: "p1", headCount: 4, avgWeightLb: 900 });
    expect(prefillFrom(last, 5, 1100)).toEqual({ headCount: 5, avgWeightLb: 1100, forageHeightInEntry: null });
  });

  it("falls back to the last move when nothing derives", () => {
    const last = event({ id: "a", paddockId: "p1", headCount: 4, avgWeightLb: 900 });
    expect(prefillFrom(last, null, null)).toEqual({ headCount: 4, avgWeightLb: 900, forageHeightInEntry: null });
  });

  it("never prefills forage height — it is a reading, not a carry-over", () => {
    const last = event({ id: "a", paddockId: "p1", forageHeightInEntry: 9 });
    expect(prefillFrom(last, null, null).forageHeightInEntry).toBeNull();
  });
});

describe("what deleting a move will do, said before it is done", () => {
  // Which repair applies is not visible in a row, so the button says it.
  const chain: GrazingEvent[] = [
    event({ id: "a", paddockId: "p1", enteredAt: "2026-08-01T00:00:00.000Z", exitedAt: "2026-08-03T00:00:00.000Z" }),
    event({ id: "b", paddockId: "p2", enteredAt: "2026-08-03T00:00:00.000Z", exitedAt: "2026-08-05T00:00:00.000Z" }),
    event({ id: "c", paddockId: "p3", enteredAt: "2026-08-05T00:00:00.000Z", exitedAt: null }),
  ];

  it("promises the mob goes back where they came from, for the one they are on", () => {
    expect(deleteEffect(chain[2], chain)).toContain("back where they came from");
  });

  it("warns of a gap for one in the middle, rather than quietly stretching a stay", () => {
    const said = deleteEffect(chain[1], chain);
    expect(said).toContain("gap");
    expect(said).not.toContain("back where they came from");
  });

  it("says the mob is left off pasture when it is the only move there is", () => {
    const only = [event({ id: "x", paddockId: "p1", enteredAt: "2026-08-01T00:00:00.000Z", exitedAt: null })];
    expect(deleteEffect(only[0], only)).toContain("off pasture");
  });

  it("reads the chain of that mob alone, not whatever else is on the farm", () => {
    // Another mob's later move must not be mistaken for this one's predecessor.
    const other = event({ id: "z", paddockId: "p4", groupId: "mob-2",
      enteredAt: "2026-08-04T00:00:00.000Z", exitedAt: null });
    const only = [event({ id: "x", paddockId: "p1", enteredAt: "2026-08-06T00:00:00.000Z", exitedAt: null }), other];
    expect(deleteEffect(only[0], only)).toContain("off pasture");
  });
});
