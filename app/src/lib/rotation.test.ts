import { describe, expect, it } from "vitest";
import {
  boardRows,
  lastDefoliatedAt,
  lastGrazedAt,
  readinessDays,
  restDays,
  rotationRounds,
  staysFrom,
  sweepBands,
  type ForageRemoval,
  type GrazingEvent,
  type Paddock,
} from "./grazing";

/**
 * Hay, and the rotation as rounds.
 *
 * The case that drives all of this: forage that left on a wagon left the
 * paddock as bare as forage a cow ate, and until now nothing knew that. A unit
 * mown three days ago would have reported itself rested since June.
 */

const NOW = "2026-08-13T12:00:00.000Z";

const paddock = (id: string, name: string, swept: boolean): Paddock => ({
  id,
  name,
  code: name.replace("Paddock ", "P"),
  acresMeasured: 1.91,
  acresGrazable: 1.91,
  unitType: "permanent",
  sweepHeadingDeg: swept ? 270 : null,
  sweepLengthFt: swept ? 400 : null, rotationOrder: null,
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
});

const p1 = paddock("p1", "Paddock 1", true);
const p2 = paddock("p2", "Paddock 2", true);
const p3 = paddock("p3", "Paddock 3", true);

const strip = (
  id: string,
  paddockId: string,
  from: number | null,
  to: number | null,
  entered: string,
  exited: string | null,
): GrazingEvent => ({
  id,
  paddockId,
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

const cutting = (id: string, paddockId: string, on: string, n = 1): ForageRemoval => ({
  id,
  paddockId,
  removedOn: on,
  kind: "hay",
  cuttingNumber: n,
  yieldLb: 4200,
  yieldBasis: "estimated",
  notes: null,
});

/** One pass across Paddock 3 in June, then hay off it on 1 July. */
const junePass = [
  strip("s1", "p3", 0, 0.3, "2026-06-01T12:00:00.000Z", "2026-06-04T12:00:00.000Z"),
  strip("s2", "p3", 0.3, 0.7, "2026-06-04T12:00:00.000Z", "2026-06-08T12:00:00.000Z"),
  strip("s3", "p3", 0.7, 1, "2026-06-08T12:00:00.000Z", "2026-06-11T12:00:00.000Z"),
];
const julyCut = cutting("h1", "p3", "2026-07-01");

describe("a cutting resets the rest clock", () => {
  it("is the whole point: grazing alone reads the unit as far more rested than it is", () => {
    // Measured from the last grazing, the start of the sweep last saw cattle
    // on 4 June — ten weeks ago.
    expect(readinessDays("p3", junePass, NOW)).toBe(70);
    // It was mown on 1 July, so it has six weeks of regrowth, not ten.
    expect(readinessDays("p3", junePass, NOW, [julyCut])).toBe(42);
  });

  it("counts in restDays, and dates the rest from the cutting", () => {
    const without = restDays("p3", junePass, NOW);
    expect(without).toEqual({ state: "rested", days: 63, since: "2026-06-11T12:00:00.000Z" });

    const withCut = restDays("p3", junePass, NOW, [julyCut]);
    expect(withCut).toEqual({
      state: "rested",
      days: 42,
      since: "2026-07-01T23:59:59.999Z",
    });
  });

  it("gives a unit only ever cut a real rest figure rather than 'never'", () => {
    expect(restDays("p3", [], NOW)).toEqual({ state: "never" });
    expect(restDays("p3", [], NOW, [julyCut])).toEqual({
      state: "rested",
      days: 42,
      since: "2026-07-01T23:59:59.999Z",
    });
  });

  it("does not let a cutting on one unit touch another", () => {
    expect(readinessDays("p3", junePass, NOW, [cutting("h2", "p1", "2026-07-01")])).toBe(70);
  });

  it("leaves the mob in place ahead of everything — occupied is not rest", () => {
    const open = [...junePass, strip("s4", "p3", 0, 0.1, "2026-08-12T12:00:00.000Z", null)];
    expect(restDays("p3", open, NOW, [julyCut])).toEqual({ state: "occupied" });
  });
});

describe("lastDefoliatedAt", () => {
  it("keeps grazing and defoliation as separate questions", () => {
    // Two different facts about the same paddock, a month apart.
    expect(lastGrazedAt("p3", 0.5, junePass)).toBe("2026-06-08T12:00:00.000Z");
    expect(lastDefoliatedAt("p3", 0.5, junePass, [julyCut])).toBe("2026-07-01T23:59:59.999Z");
  });

  it("covers every position, because nobody mows a strip", () => {
    for (const at of [0.01, 0.4, 0.99]) {
      expect(lastDefoliatedAt("p3", at, junePass, [julyCut])).toBe("2026-07-01T23:59:59.999Z");
    }
  });

  it("does not override a grazing that came after it", () => {
    const after = [...junePass, strip("s9", "p3", 0, 0.2, "2026-08-01T12:00:00.000Z", "2026-08-03T12:00:00.000Z")];
    expect(lastDefoliatedAt("p3", 0.1, after, [julyCut])).toBe("2026-08-03T12:00:00.000Z");
    // Ground the August strip did not reach still dates from the cutting.
    expect(lastDefoliatedAt("p3", 0.9, after, [julyCut])).toBe("2026-07-01T23:59:59.999Z");
  });
});

describe("sweepBands after a cutting", () => {
  it("flattens the unit's bands, because the mower took the lot", () => {
    const bands = sweepBands("p3", junePass, NOW, [julyCut]);
    expect(bands.map((b) => b.restDays)).toEqual([42, 42, 42]);
  });

  it("keeps the bands apart when there is no cutting", () => {
    expect(sweepBands("p3", junePass, NOW).map((b) => b.restDays)).toEqual([70, 66, 63]);
  });

  it("is one evenly-rested band for a unit only ever cut", () => {
    expect(sweepBands("p3", [], NOW, [julyCut])).toEqual([
      { from: 0, to: 1, lastGrazed: "2026-07-01T23:59:59.999Z", restDays: 42, occupied: false },
    ]);
  });
});

describe("staysFrom", () => {
  it("collapses a fortnight of wire moves into one stay", () => {
    const stays = staysFrom({ events: junePass, paddocks: [p3], nowIso: NOW });
    expect(stays).toHaveLength(1);
    expect(stays[0].strips).toBe(3);
    expect(stays[0].enteredAt).toBe("2026-06-01T12:00:00.000Z");
    expect(stays[0].exitedAt).toBe("2026-06-11T12:00:00.000Z");
    expect(stays[0].days).toBe(10);
    // The three strips took the whole unit between them.
    expect(stays[0].acres).toBeCloseTo(1.91, 6);
  });

  it("has no rest figure the first time through, rather than a zero", () => {
    const stays = staysFrom({ events: junePass, paddocks: [p3], nowIso: NOW });
    expect(stays[0].restBeforeDays).toBeNull();
  });

  it("reports the rest a unit actually had when they walked back in", () => {
    const second = strip("s5", "p3", 0, 0.2, "2026-08-10T12:00:00.000Z", null);
    const stays = staysFrom({ events: [...junePass, second], paddocks: [p3], nowIso: NOW });
    expect(stays).toHaveLength(2);
    // From 4 June, when the start of the sweep was last grazed.
    expect(stays[1].restBeforeDays).toBe(67);
    // And a cutting in between shortens it to what really regrew.
    const cut = staysFrom({ events: [...junePass, second], paddocks: [p3], removals: [julyCut], nowIso: NOW });
    expect(cut[1].restBeforeDays).toBe(39);
  });

  it("does not let an open stay count itself as its own previous grazing", () => {
    // The regression this guards: an open event has no exit, so a date-only
    // filter would sweep it into its own history and report a rest of zero.
    const open = strip("s6", "p2", 0, 0.1, "2026-08-12T12:00:00.000Z", null);
    const stays = staysFrom({ events: [open], paddocks: [p2], nowIso: NOW });
    expect(stays[0].restBeforeDays).toBeNull();
  });

  it("keeps separate visits separate even when they are the same unit", () => {
    const events = [
      strip("a", "p1", 0, 1, "2026-06-01T12:00:00.000Z", "2026-06-05T12:00:00.000Z"),
      strip("b", "p2", 0, 1, "2026-06-05T12:00:00.000Z", "2026-06-09T12:00:00.000Z"),
      strip("c", "p1", 0, 1, "2026-07-01T12:00:00.000Z", "2026-07-05T12:00:00.000Z"),
    ];
    const stays = staysFrom({ events, paddocks: [p1, p2], nowIso: NOW });
    expect(stays.map((s) => s.paddockId)).toEqual(["p1", "p2", "p1"]);
  });

  it("splits the same unit into two stays when they left and came back", () => {
    // June and August in Paddock 3. Same unit, two months apart — merging
    // these on the paddock id alone would erase the rest between them, which
    // is the figure the page exists to show.
    const stays = staysFrom({
      events: [...junePass, strip("s7", "p3", 0, 0.2, "2026-08-10T12:00:00.000Z", null)],
      paddocks: [p3],
      nowIso: NOW,
    });
    expect(stays.map((s) => s.strips)).toEqual([3, 1]);
  });

  it("joins strips that share a boundary instant, which is what the move writes", () => {
    // log_grazing_move closes the open event at the instant it opens the
    // next, so a stay's strips meet exactly.
    const stays = staysFrom({ events: junePass, paddocks: [p3], nowIso: NOW });
    expect(stays).toHaveLength(1);

    // An hour of slack for a hand-edited timestamp, but not a day.
    const nudged = [
      junePass[0],
      { ...junePass[1], enteredAt: "2026-06-04T12:30:00.000Z" },
    ];
    expect(staysFrom({ events: nudged, paddocks: [p3], nowIso: NOW })).toHaveLength(1);

    const nextDay = [
      junePass[0],
      { ...junePass[1], enteredAt: "2026-06-05T12:00:00.000Z" },
    ];
    expect(staysFrom({ events: nextDay, paddocks: [p3], nowIso: NOW })).toHaveLength(2);
  });

  it("gives no acreage rather than a wrong one when the unit is unknown", () => {
    const stays = staysFrom({ events: junePass, paddocks: [], nowIso: NOW });
    expect(stays[0].acres).toBeNull();
  });
});

describe("rotationRounds", () => {
  const events = [
    // Round 1 — three units, the middle one taken in two strips.
    strip("r1a", "p1", 0, 1, "2026-05-01T12:00:00.000Z", "2026-05-05T12:00:00.000Z"),
    strip("r1b", "p2", 0, 0.5, "2026-05-05T12:00:00.000Z", "2026-05-08T12:00:00.000Z"),
    strip("r1c", "p2", 0.5, 1, "2026-05-08T12:00:00.000Z", "2026-05-11T12:00:00.000Z"),
    strip("r1d", "p3", 0, 1, "2026-05-11T12:00:00.000Z", "2026-05-15T12:00:00.000Z"),
    // Round 2 — back to Paddock 1, which is what ends round 1.
    strip("r2a", "p1", 0, 1, "2026-06-20T12:00:00.000Z", "2026-06-24T12:00:00.000Z"),
    strip("r2b", "p2", 0, 1, "2026-06-24T12:00:00.000Z", "2026-06-28T12:00:00.000Z"),
  ];

  it("ends a round when the mob walks into a unit it has already had", () => {
    const rounds = rotationRounds({ events, paddocks: [p1, p2, p3], nowIso: NOW });
    expect(rounds.map((r) => r.index)).toEqual([1, 2]);
    expect(rounds[0].stays.map((s) => s.paddockId)).toEqual(["p1", "p2", "p3"]);
    expect(rounds[1].stays.map((s) => s.paddockId)).toEqual(["p1", "p2"]);
  });

  it("counts a round's length from first entry to last exit", () => {
    const rounds = rotationRounds({ events, paddocks: [p1, p2, p3], nowIso: NOW });
    expect(rounds[0].startedAt).toBe("2026-05-01T12:00:00.000Z");
    expect(rounds[0].endedAt).toBe("2026-05-15T12:00:00.000Z");
    expect(rounds[0].days).toBe(14);
  });

  it("does not care about the order units are taken in", () => {
    // Wet ground, so Paddock 3 is skipped and picked up out of turn. The
    // round still ends where a unit repeats, not where a sequence breaks.
    const shuffled = [
      strip("x1", "p2", 0, 1, "2026-05-01T12:00:00.000Z", "2026-05-05T12:00:00.000Z"),
      strip("x2", "p1", 0, 1, "2026-05-05T12:00:00.000Z", "2026-05-09T12:00:00.000Z"),
      strip("x3", "p3", 0, 1, "2026-05-09T12:00:00.000Z", "2026-05-13T12:00:00.000Z"),
      strip("x4", "p2", 0, 1, "2026-06-01T12:00:00.000Z", "2026-06-05T12:00:00.000Z"),
    ];
    const rounds = rotationRounds({ events: shuffled, paddocks: [p1, p2, p3], nowIso: NOW });
    expect(rounds).toHaveLength(2);
    expect(rounds[0].stays).toHaveLength(3);
  });

  it("puts every cutting in exactly one round and loses none", () => {
    const cuts = [
      cutting("c0", "p1", "2026-04-01"), // before any grazing
      cutting("c1", "p3", "2026-05-20"), // between the rounds
      cutting("c2", "p2", "2026-07-15"), // after the last round
    ];
    const rounds = rotationRounds({ events, paddocks: [p1, p2, p3], removals: cuts, nowIso: NOW });
    const placed = rounds.flatMap((r) => r.cuttings.map((c) => c.id));
    expect(placed.sort()).toEqual(["c0", "c1", "c2"]);
    // The early one falls in the first window, which runs back to the start
    // of the record; the late one in the last, which runs to now.
    expect(rounds[0].cuttings.map((c) => c.id)).toEqual(["c0", "c1"]);
    expect(rounds[1].cuttings.map((c) => c.id)).toEqual(["c2"]);
  });

  it("is empty for a farm that has not turned out yet", () => {
    expect(rotationRounds({ events: [], paddocks: [p1], nowIso: NOW })).toEqual([]);
  });

  it("leaves a round open while the mob is still out", () => {
    const open = [...events, strip("r2c", "p3", 0, 0.3, "2026-08-11T12:00:00.000Z", null)];
    const rounds = rotationRounds({ events: open, paddocks: [p1, p2, p3], nowIso: NOW });
    expect(rounds[1].endedAt).toBeNull();
    expect(rounds[1].days).toBe(54);
  });
});

describe("the board carries the cutting", () => {
  it("shows rest from the cutting but leaves 'last grazed' about cattle", () => {
    const [row] = boardRows({
      paddocks: [p3],
      events: junePass,
      groups: [],
      targets: [],
      removals: [julyCut],
      nowIso: NOW,
    });
    expect(row.rest).toEqual({ state: "rested", days: 42, since: "2026-07-01T23:59:59.999Z" });
    // Not the cutting — this column answers "when did cattle last have it".
    expect(row.lastGrazed).toBe("2026-06-11T12:00:00.000Z");
    expect(row.lastCut?.id).toBe("h1");
  });

  it("has no cutting to show when none has happened", () => {
    const [row] = boardRows({ paddocks: [p3], events: junePass, groups: [], targets: [], nowIso: NOW });
    expect(row.lastCut).toBeNull();
    expect(row.rest).toEqual({ state: "rested", days: 63, since: "2026-06-11T12:00:00.000Z" });
  });
});
