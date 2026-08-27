import { describe, expect, it } from "vitest";
import { paddocksInPasture, pasturesInUse, type Paddock, type Pasture } from "./grazing";

/**
 * Which ground the Move page is working in.
 *
 * Forty-six paddocks on one map is 46 postage stamps and a picker with 46
 * buttons is not a picker. Scoping to a pasture fixes both — and the tests
 * that matter are the ones about farms that have no pastures to scope to,
 * because those must come out exactly as they did before.
 */

const paddock = (id: string, over: Partial<Paddock> = {}): Paddock => ({
  id,
  name: id.toUpperCase(),
  code: id.toUpperCase(),
  acresMeasured: 30,
  acresGrazable: 28,
  pastureId: null,
  unitType: "permanent",
  sweepHeadingDeg: 270,
  sweepLengthFt: 800,
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
  ...over,
});

const pasture = (id: string, name: string): Pasture => ({
  id,
  name,
  code: id.toUpperCase(),
  acres: null,
  notes: null,
  active: true,
  propertyId: null,
  boundary: null,
});

describe("paddocksInPasture", () => {
  const paddocks = [
    paddock("a", { pastureId: "north" }),
    paddock("b", { pastureId: "north" }),
    paddock("c", { pastureId: "creek" }),
  ];

  it("narrows to the pasture asked for", () => {
    expect(paddocksInPasture(paddocks, "north").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("returns everything when no pasture is chosen", () => {
    expect(paddocksInPasture(paddocks, null)).toHaveLength(3);
  });

  it("returns everything for a farm that never assigned a pasture", () => {
    // The failure this prevents: scoping to a pasture nobody filled in shows
    // an empty map with no way to get off it — worse than the crowded map
    // the scoping was meant to fix.
    const loose = [paddock("a"), paddock("b")];
    expect(paddocksInPasture(loose, "north")).toHaveLength(2);
  });

  it("returns everything rather than nothing for a pasture that holds no ground", () => {
    expect(paddocksInPasture(paddocks, "empty-one")).toHaveLength(3);
  });
});

describe("pasturesInUse", () => {
  const pastures = [pasture("creek", "Creek Pasture"), pasture("north", "North Pasture")];

  it("orders by where the ground sits in the round, not by name", () => {
    // The picker should read in the order the farm is walked. Alphabetically
    // "Creek" leads, and on this farm the round starts at North.
    const paddocks = [
      paddock("a", { pastureId: "north", rotationOrder: 1 }),
      paddock("b", { pastureId: "north", rotationOrder: 2 }),
      paddock("c", { pastureId: "creek", rotationOrder: 9 }),
    ];
    expect(pasturesInUse(paddocks, pastures).map((r) => r.pasture.name)).toEqual([
      "North Pasture",
      "Creek Pasture",
    ]);
  });

  it("counts the paddocks and adds up the grazable acres", () => {
    const paddocks = [
      paddock("a", { pastureId: "north", acresGrazable: 28.5, rotationOrder: 1 }),
      paddock("b", { pastureId: "north", acresGrazable: 31.25, rotationOrder: 2 }),
    ];
    const [north] = pasturesInUse(paddocks, pastures);
    expect([north.paddocks, north.acres]).toEqual([2, 59.75]);
  });

  it("falls back to measured acres when grazable is not recorded", () => {
    const paddocks = [paddock("a", { pastureId: "north", acresGrazable: null, acresMeasured: 40 })];
    expect(pasturesInUse(paddocks, pastures)[0].acres).toBe(40);
  });

  it("leaves out a pasture with nothing in it", () => {
    // A row somebody made and never used. Offering it as somewhere to move a
    // mob would be offering an empty field.
    const paddocks = [paddock("a", { pastureId: "north", rotationOrder: 1 })];
    expect(pasturesInUse(paddocks, pastures).map((r) => r.pasture.id)).toEqual(["north"]);
  });

  it("is empty for a farm whose paddocks carry no pasture", () => {
    // Which is what tells the page not to render a picker at all.
    expect(pasturesInUse([paddock("a"), paddock("b")], pastures)).toEqual([]);
  });

  it("still orders a pasture whose paddocks have no rotation order", () => {
    // Unordered ground sorts last and then by name, rather than throwing the
    // whole list into an arbitrary order.
    const paddocks = [
      paddock("a", { pastureId: "creek" }),
      paddock("b", { pastureId: "north", rotationOrder: 4 }),
    ];
    expect(pasturesInUse(paddocks, pastures).map((r) => r.pasture.name)).toEqual([
      "North Pasture",
      "Creek Pasture",
    ]);
  });
});
