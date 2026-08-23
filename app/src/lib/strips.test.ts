import { describe, expect, it } from "vitest";
import {
  currentPass,
  isSwept,
  lastGrazedAt,
  planStrip,
  readinessDays,
  stripAcres,
  stripWidthFt,
  sweepBands,
  sweepInWords,
  sweptSoFar,
  widthForHours,
  type ForageAssumptions,
  type GrazingEvent,
  type Paddock,
} from "./grazing";

/**
 * Strip grazing: the wire as a position along a fixed sweep.
 *
 * Shaped like the farm — a unit swept east to west, one mob of 5 head at
 * 1,100 lb, a strip a day and sometimes two. The acreage here is a round
 * fixture, not this farm's: the real units run 1.375 to 2.255 acres (040),
 * and pinning a test to that would break it the next time anything is
 * re-measured. What is under test is the arithmetic, which does not care.
 */

const NOW = "2026-08-13T12:00:00.000Z";

const p3: Paddock = {
  id: "p3",
  name: "Paddock 3",
  code: "P3",
  acresMeasured: 1.91,
  acresGrazable: 1.91,
  pastureId: null,
  unitType: "permanent",
  sweepHeadingDeg: 270,
  sweepLengthFt: 400, rotationOrder: null,
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
};

const strip = (
  id: string,
  from: number,
  to: number,
  entered: string,
  exited: string | null,
): GrazingEvent => ({
  id,
  paddockId: "p3",
  groupId: "mob",
  enteredAt: entered,
  exitedAt: exited,
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
  sweptFrom: from,
  sweptTo: to,
  grazedShape: null,
});

const ASSUMPTIONS: ForageAssumptions = {
  standingLbDmPerAcre: 2400,
  takeDownPct: 50,
  utilizationPct: 100.0,
  intakePctBodyweight: 3,
};

describe("sweepInWords", () => {
  it("reads the farm's serpentine back", () => {
    expect(sweepInWords(270)).toBe("east to west");
    expect(sweepInWords(90)).toBe("west to east");
    expect(sweepInWords(0)).toBe("south to north");
    expect(sweepInWords(180)).toBe("north to south");
  });

  it("is null for a unit taken whole", () => {
    expect(sweepInWords(null)).toBeNull();
    expect(isSwept({ ...p3, sweepHeadingDeg: null })).toBe(false);
  });
});

describe("stripAcres", () => {
  it("is a fraction of the unit — no coordinates needed", () => {
    expect(stripAcres(strip("a", 0, 0.12, NOW, null), p3)).toBeCloseTo(0.229, 3);
  });

  it("treats a grazing with no wire as the whole unit", () => {
    const whole = { ...strip("a", 0, 1, NOW, null), sweptFrom: null, sweptTo: null };
    expect(stripAcres(whole, p3)).toBe(1.91);
  });

  it("gives the width in feet when the sweep length is on file", () => {
    expect(stripWidthFt(strip("a", 0.1, 0.2, NOW, null), p3)).toBeCloseTo(40);
    expect(stripWidthFt(strip("a", 0.1, 0.2, NOW, null), { ...p3, sweepLengthFt: null })).toBeNull();
  });
});

describe("currentPass and sweptSoFar", () => {
  const pass = [
    strip("s1", 0, 0.12, "2026-08-08T12:00:00.000Z", "2026-08-09T12:00:00.000Z"),
    strip("s2", 0.12, 0.23, "2026-08-09T12:00:00.000Z", "2026-08-10T12:00:00.000Z"),
    strip("s3", 0.23, 0.38, "2026-08-10T12:00:00.000Z", null),
  ];

  it("gathers the strips that advance without going back", () => {
    expect(currentPass("p3", pass).map((e) => e.id)).toEqual(["s1", "s2", "s3"]);
    expect(sweptSoFar("p3", pass)).toBeCloseTo(0.38);
  });

  it("starts a new pass when the wire returns to the beginning", () => {
    const twoPasses = [
      strip("may1", 0, 0.4, "2026-05-22T12:00:00.000Z", "2026-05-24T12:00:00.000Z"),
      strip("may2", 0.4, 1, "2026-05-24T12:00:00.000Z", "2026-05-28T12:00:00.000Z"),
      ...pass,
    ];
    // May's strips are not part of August's pass, even though they are the
    // same ground and the same unit.
    expect(currentPass("p3", twoPasses).map((e) => e.id)).toEqual(["s1", "s2", "s3"]);
    expect(sweptSoFar("p3", twoPasses)).toBeCloseTo(0.38);
  });

  it("is empty for a unit never stripped", () => {
    expect(currentPass("p9", pass)).toEqual([]);
    expect(sweptSoFar("p9", pass)).toBe(0);
  });
});

describe("lastGrazedAt", () => {
  // Two passes whose divisions do not line up — the case that had no answer
  // before. A May strip straddles two August strips.
  const events = [
    strip("may1", 0, 0.35, "2026-05-22T12:00:00.000Z", "2026-05-25T12:00:00.000Z"),
    strip("may2", 0.35, 1, "2026-05-25T12:00:00.000Z", "2026-05-30T12:00:00.000Z"),
    strip("aug1", 0, 0.12, "2026-08-08T12:00:00.000Z", "2026-08-09T12:00:00.000Z"),
    strip("aug2", 0.12, 0.23, "2026-08-09T12:00:00.000Z", "2026-08-10T12:00:00.000Z"),
  ];

  it("answers per position, not per unit", () => {
    expect(lastGrazedAt("p3", 0.05, events)).toBe("2026-08-09T12:00:00.000Z");
    expect(lastGrazedAt("p3", 0.18, events)).toBe("2026-08-10T12:00:00.000Z");
    // Ahead of this pass's wire: still standing since May.
    expect(lastGrazedAt("p3", 0.60, events)).toBe("2026-05-30T12:00:00.000Z");
  });

  it("is null for ground never grazed", () => {
    expect(lastGrazedAt("p9", 0.5, events)).toBeNull();
  });

  it("counts a whole-unit grazing as covering every position", () => {
    const whole = { ...strip("w", 0, 1, "2026-07-01T12:00:00.000Z", "2026-07-03T12:00:00.000Z"), sweptFrom: null, sweptTo: null };
    expect(lastGrazedAt("p3", 0.9, [...events, whole])).toBe("2026-07-03T12:00:00.000Z");
  });
});

describe("sweepBands", () => {
  const events = [
    strip("may1", 0, 0.35, "2026-05-22T12:00:00.000Z", "2026-05-25T12:00:00.000Z"),
    strip("may2", 0.35, 1, "2026-05-25T12:00:00.000Z", "2026-05-30T12:00:00.000Z"),
    strip("aug1", 0, 0.12, "2026-08-08T12:00:00.000Z", "2026-08-09T12:00:00.000Z"),
    strip("aug2", 0.12, 0.23, "2026-08-09T12:00:00.000Z", null),
  ];

  it("cuts the unit where wires have been, not on an arbitrary grid", () => {
    const bands = sweepBands("p3", events, NOW);
    expect(bands.map((b) => [b.from, b.to])).toEqual([
      [0, 0.12],
      [0.12, 0.23],
      [0.23, 0.35],
      [0.35, 1],
    ]);
  });

  it("gives each band its own rest", () => {
    const bands = sweepBands("p3", events, NOW);
    expect(bands[0].restDays).toBe(4); // grazed 9 Aug
    expect(bands[2].restDays).toBe(80); // still on May
    expect(bands[3].restDays).toBe(75);
  });

  it("marks the band the mob is standing on", () => {
    const bands = sweepBands("p3", events, NOW);
    expect(bands.filter((b) => b.occupied).map((b) => b.from)).toEqual([0.12]);
  });

  it("is one ungrazed band for a unit with no history", () => {
    expect(sweepBands("p9", events, NOW)).toEqual([
      { from: 0, to: 1, lastGrazed: null, restDays: null, occupied: false },
    ]);
  });
});

describe("readinessDays", () => {
  it("measures from the start of the sweep, not the last strip", () => {
    // They will re-enter where they entered last time, so what governs
    // readiness is the ground grazed first — which has rested longest.
    const events = [
      strip("s1", 0, 0.3, "2026-06-01T12:00:00.000Z", "2026-06-04T12:00:00.000Z"),
      strip("s2", 0.3, 0.7, "2026-06-04T12:00:00.000Z", "2026-06-08T12:00:00.000Z"),
      strip("s3", 0.7, 1, "2026-06-08T12:00:00.000Z", "2026-08-11T12:00:00.000Z"),
    ];
    // From the last strip it would read 2 days and hold the unit back for
    // weeks after it was fit to graze.
    expect(readinessDays("p3", events, NOW)).toBe(70);
  });

  it("is null for a unit never grazed", () => {
    expect(readinessDays("p9", [], NOW)).toBeNull();
  });
});

describe("planStrip", () => {
  it("sizes a strip in acres, hours of feed and density", () => {
    const got = planStrip({
      paddock: p3, from: 0.38, to: 0.5,
      headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    })!;
    // 12% of 1.91 acres = 0.229 ac; usable 1,200 lb/ac; intake 165 lb/day.
    expect(got.acres).toBeCloseTo(0.229, 3);
    expect(got.hoursOfFeed).toBeCloseTo(40, 0);
    expect(Math.round(got.lbPerAcre!)).toBe(23997); // 5,500 lb over 0.2292 ac
    expect(got.widthFt).toBeCloseTo(48);
  });

  it("still gives acres when nobody has been weighed", () => {
    const got = planStrip({
      paddock: p3, from: 0, to: 0.1,
      headCount: 5, avgWeightLb: null, assumptions: ASSUMPTIONS,
    })!;
    expect(got.acres).toBeCloseTo(0.191, 3);
    expect(got.hoursOfFeed).toBeNull();
    expect(got.lbPerAcre).toBeNull();
  });

  it("refuses a strip that goes nowhere", () => {
    expect(planStrip({ paddock: p3, from: 0.4, to: 0.4, headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS })).toBeNull();
  });
});

describe("widthForHours", () => {
  it("answers the question the way it is actually asked", () => {
    const day = widthForHours({
      paddock: p3, hours: 24, headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    })!;
    // 165 lb of intake over 1,200 lb usable an acre is 0.1375 ac, which is
    // 7.2% of a 1.91-acre unit.
    expect(day).toBeCloseTo(0.072, 3);

    // Half a day is half the ground, which is the second move on a fast
    // growth day.
    const half = widthForHours({
      paddock: p3, hours: 12, headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    })!;
    expect(half).toBeCloseTo(day / 2, 4);
  });

  it("never proposes more than the unit has left", () => {
    expect(widthForHours({
      paddock: p3, hours: 24 * 40, headCount: 5, avgWeightLb: 1100, assumptions: ASSUMPTIONS,
    })).toBe(1);
  });

  it("is null when nobody has been weighed, rather than assuming one", () => {
    expect(widthForHours({
      paddock: p3, hours: 24, headCount: 5, avgWeightLb: null, assumptions: ASSUMPTIONS,
    })).toBeNull();
  });
});
