import { describe, expect, it } from "vitest";
import {
  currentRound,
  roundsFor,
  type ForageRemoval,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingRound,
  type Paddock,
  type Pasture,
} from "./grazing";

/**
 * A round is one mob's trip through one pasture, and the farm starts it.
 *
 * The rule this replaces sorted every event on the farm by time and closed a
 * round whenever the mob walked into somewhere it had already been. It could
 * not see which mob — four mobs at once interleaved into one sequence and the
 * repeat rule fired on their paths crossing — and it could not see which
 * pasture, so a "round" ran across three separate leases. Migration 066 has
 * the measurement on the Green Pastures demo: twenty rounds of a dozen stays
 * where there are two per mob per pasture.
 *
 * So the tests that matter are about scope: two mobs must not share a round,
 * two pastures must not either, and a farm with no pastures at all must come
 * out as one sequence — which is what a round has always meant there.
 */

const NOW = "2026-08-31T12:00:00.000Z";

const paddock = (id: string, pastureId: string | null): Paddock => ({
  id,
  name: id.toUpperCase(),
  code: id.toUpperCase(),
  acresMeasured: 10,
  acresGrazable: 10,
  pastureId,
  unitType: "permanent",
  sweepHeadingDeg: null,
  sweepLengthFt: null,
  rotationOrder: null,
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

const mob = (id: string, name: string): GrazingGroup => ({
  id, name, species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null,
});

const pasture = (id: string, name: string): Pasture => ({
  id, name, code: null, acres: null, notes: null, active: true, propertyId: null, boundary: null,
});

const round = (
  id: string, groupId: string, pastureId: string | null, startedAt: string,
  over: Partial<GrazingRound> = {},
): GrazingRound => ({
  id, groupId, pastureId, startedAt, name: null, notes: null, derived: false, ...over,
});

/** One day in a paddock, as a whole-unit graze. */
const day = (
  id: string, paddockId: string, groupId: string, entered: string, exited: string | null,
): GrazingEvent => ({
  id, paddockId, groupId, enteredAt: entered, exitedAt: exited,
  headCount: 20, avgWeightLb: 1100,
  forageHeightInEntry: null, residualHeightInExit: null, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null, sweptFrom: null, sweptTo: null, grazedShape: null,
});

const at = (d: string) => `2026-${d}T12:00:00.000Z`;

// North holds n1–n3, Creek holds c1–c2.
const paddocks = [
  paddock("n1", "north"), paddock("n2", "north"), paddock("n3", "north"),
  paddock("c1", "creek"), paddock("c2", "creek"),
];
const groups = [mob("main", "Main mob"), mob("yearlings", "Yearlings")];
const pastures = [pasture("north", "North Pasture"), pasture("creek", "Creek Pasture")];

const view = (input: {
  rounds: GrazingRound[]; events: GrazingEvent[]; removals?: ForageRemoval[];
}) => roundsFor({ ...input, paddocks, groups, pastures, nowIso: NOW });

describe("which round a stay falls in", () => {
  it("files each stay under the latest round started on or before it", () => {
    const rounds = [
      round("r1", "main", "north", at("05-01")),
      round("r2", "main", "north", at("06-01")),
    ];
    const events = [
      day("a", "n1", "main", at("05-02"), at("05-04")),
      day("b", "n2", "main", at("05-04"), at("05-06")),
      day("c", "n1", "main", at("06-02"), at("06-04")),
    ];
    const { rounds: out } = view({ rounds, events });
    // Newest first, so r2 leads.
    expect(out.map((v) => [v.round.id, v.stays.length])).toEqual([["r2", 1], ["r1", 2]]);
  });

  it("keeps two mobs out of each other's rounds", () => {
    // The bug that made the old page report twenty rounds on a farm that had
    // eight: two mobs' paths crossing looked like a repeat visit.
    const rounds = [
      round("r-main", "main", "north", at("05-01")),
      round("r-year", "yearlings", "north", at("05-01")),
    ];
    const events = [
      day("a", "n1", "main", at("05-02"), at("05-04")),
      day("b", "n1", "yearlings", at("05-05"), at("05-07")),
      day("c", "n2", "main", at("05-06"), at("05-08")),
    ];
    const { rounds: out } = view({ rounds, events });
    const byId = new Map(out.map((v) => [v.round.id, v]));
    expect(byId.get("r-main")!.stays.map((s) => s.paddockId)).toEqual(["n1", "n2"]);
    expect(byId.get("r-year")!.stays.map((s) => s.paddockId)).toEqual(["n1"]);
  });

  it("keeps two pastures out of each other's rounds", () => {
    // A round of 46 stays across three leases is not a trip anybody walks.
    const rounds = [
      round("r-north", "main", "north", at("05-01")),
      round("r-creek", "main", "creek", at("05-01")),
    ];
    const events = [
      day("a", "n1", "main", at("05-02"), at("05-04")),
      day("b", "c1", "main", at("05-04"), at("05-06")),
      day("c", "n2", "main", at("05-06"), at("05-08")),
    ];
    const { rounds: out } = view({ rounds, events });
    const byId = new Map(out.map((v) => [v.round.id, v]));
    expect(byId.get("r-north")!.stays.map((s) => s.paddockId)).toEqual(["n1", "n2"]);
    expect(byId.get("r-creek")!.stays.map((s) => s.paddockId)).toEqual(["c1"]);
  });

  it("is one sequence on a farm whose ground carries no pasture", () => {
    // Which is what a round has always meant there, and has to stay meaning.
    const loose = [paddock("a", null), paddock("b", null)];
    const events = [
      day("x", "a", "main", at("05-02"), at("05-04")),
      day("y", "b", "main", at("05-04"), at("05-06")),
    ];
    const { rounds: out } = roundsFor({
      rounds: [round("r1", "main", null, at("05-01"))],
      events, paddocks: loose, groups, nowIso: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0].stays).toHaveLength(2);
  });

  it("does not join two mobs' grazing of the same paddock into one stay", () => {
    // `staysFrom` joins consecutive events in the same paddock. Run across
    // the whole farm it would call this one stay of four days by nobody.
    const events = [
      day("a", "n1", "main", at("05-02"), at("05-04")),
      day("b", "n1", "yearlings", at("05-04"), at("05-06")),
    ];
    const { rounds: out } = view({
      rounds: [round("r-main", "main", "north", at("05-01")),
               round("r-year", "yearlings", "north", at("05-01"))],
      events,
    });
    // Counting stays is not enough: run farm-wide, the two events join into
    // one four-day stay that is then filed under *both* mobs' rounds, and
    // each round still shows one. What gives it away is the stay itself.
    expect(out.map((v) => v.stays.map((s) => [s.strips, s.days]))).toEqual([
      [[1, 2]],
      [[1, 2]],
    ]);
  });
});

describe("grazing older than any round", () => {
  it("hands it back rather than sweeping it into the first round", () => {
    // A move corrected to a date before the first round is something the farm
    // should see. Quietly backdating the round would move a boundary nobody
    // asked to move.
    const events = [
      day("early", "n1", "main", at("04-20"), at("04-22")),
      day("a", "n2", "main", at("05-02"), at("05-04")),
    ];
    const { rounds: out, unassigned } = view({
      rounds: [round("r1", "main", "north", at("05-01"))],
      events,
    });
    expect(out[0].stays.map((s) => s.paddockId)).toEqual(["n2"]);
    expect(unassigned.map((s) => s.paddockId)).toEqual(["n1"]);
  });

  it("counts grazing on ground whose pasture has no round of its own", () => {
    // Creek has never had a round started on it. Its grazing is not lost.
    const events = [day("c", "c1", "main", at("05-02"), at("05-04"))];
    const { rounds: out, unassigned } = view({
      rounds: [round("r1", "main", "north", at("05-01"))],
      events,
    });
    expect(out[0].stays).toEqual([]);
    expect(unassigned.map((s) => s.paddockId)).toEqual(["c1"]);
  });
});

describe("what a round says about itself", () => {
  const rounds = [round("r1", "main", "north", at("05-01"), { name: "Spring 1" })];

  it("numbers within its own mob and pasture", () => {
    // "The third time round the North this year" is how it is spoken about.
    // A farm-wide number would not mean that.
    const { rounds: out } = view({
      rounds: [
        round("a", "main", "north", at("05-01")),
        round("b", "main", "north", at("06-01")),
        round("c", "main", "creek", at("07-01")),
      ],
      events: [],
    });
    const byId = new Map(out.map((v) => [v.round.id, v.index]));
    expect([byId.get("a"), byId.get("b"), byId.get("c")]).toEqual([1, 2, 1]);
  });

  it("dates itself from its grazing, not from its marker", () => {
    // A mob that leaves in November and walks back in in April has a round
    // with a hole in it. Dating from the marker to the next one would report
    // a 150-day trip through two paddocks.
    const { rounds: out } = view({
      rounds,
      events: [
        day("a", "n1", "main", at("05-10"), at("05-12")),
        day("b", "n2", "main", at("05-12"), at("05-15")),
      ],
    });
    expect([out[0].firstEntryAt, out[0].lastExitAt]).toEqual([at("05-10"), at("05-15")]);
    expect(out[0].days).toBe(5);
  });

  it("runs to now while the last stay is open", () => {
    const { rounds: out } = view({
      rounds,
      events: [day("a", "n1", "main", at("08-29"), null)],
    });
    expect([out[0].running, out[0].lastExitAt]).toEqual([true, null]);
    expect(out[0].days).toBe(2);
  });

  it("is not running when nothing has been grazed under it yet", () => {
    // A round started this morning before the mob was moved. Zero days, and
    // no date rather than today's.
    const { rounds: out } = view({ rounds, events: [] });
    expect([out[0].running, out[0].firstEntryAt, out[0].days]).toEqual([false, null, 0]);
  });

  it("carries the mob and the ground it is on", () => {
    const { rounds: out } = view({ rounds, events: [] });
    expect([out[0].group?.name, out[0].pasture?.name]).toEqual(["Main mob", "North Pasture"]);
  });
});

describe("cuttings", () => {
  const cut = (id: string, paddockId: string, on: string): ForageRemoval => ({
    id, paddockId, removedOn: on, kind: "hay",
    cuttingNumber: null, yieldLb: null, yieldBasis: null, notes: null,
  });

  it("falls under the round of its own pasture that was running", () => {
    const { rounds: out } = view({
      rounds: [
        round("r1", "main", "north", at("05-01")),
        round("r2", "main", "north", at("07-01")),
      ],
      events: [],
      removals: [cut("h1", "n3", "2026-06-15"), cut("h2", "n3", "2026-07-20")],
    });
    const byId = new Map(out.map((v) => [v.round.id, v.cuttings.map((c) => c.id)]));
    expect([byId.get("r1"), byId.get("r2")]).toEqual([["h1"], ["h2"]]);
  });

  it("does not put another pasture's hay in this round", () => {
    const { rounds: out } = view({
      rounds: [round("r1", "main", "north", at("05-01"))],
      events: [],
      removals: [cut("h1", "c1", "2026-06-15")],
    });
    expect(out[0].cuttings).toEqual([]);
  });

  it("leaves out a cutting older than the round", () => {
    const { rounds: out } = view({
      rounds: [round("r1", "main", "north", at("05-01"))],
      events: [],
      removals: [cut("h1", "n3", "2026-04-15")],
    });
    expect(out[0].cuttings).toEqual([]);
  });
});

describe("currentRound", () => {
  it("finds the newest round for a mob on the ground it stands on", () => {
    const { rounds: out } = view({
      rounds: [
        round("old", "main", "north", at("05-01")),
        round("new", "main", "north", at("06-01")),
        round("creek", "main", "creek", at("07-01")),
      ],
      events: [],
    });
    expect(currentRound(out, "main", "north")?.round.id).toBe("new");
  });

  it("is null where the mob has never had a round on that ground", () => {
    // Which is what tells the Move page to offer to start one.
    const { rounds: out } = view({
      rounds: [round("r1", "main", "north", at("05-01"))],
      events: [],
    });
    expect(currentRound(out, "yearlings", "north")).toBeNull();
    expect(currentRound(out, "main", "creek")).toBeNull();
  });
});
