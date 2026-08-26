import { describe, expect, it } from "vitest";
import { mobRoster, type GrazingEvent, type GrazingGroup, type Paddock } from "./grazing";

/**
 * Which mob needs moving.
 *
 * The Move page read `groups[0]` and left every other mob unreachable. On a
 * farm with four mobs that is three quarters of the page's work missing, so
 * the switcher this feeds is a fix rather than a feature — and the order it
 * comes back in is the whole point of it.
 */

const NOW = "2026-08-26T12:00:00.000Z";

const mob = (id: string, name: string, active = true): GrazingGroup => ({
  id,
  name,
  species: "cattle",
  class: "mixed",
  headCountManual: null,
  avgWeightLbManual: null,
  active,
  notes: null,
});

const paddock = (id: string, name: string): Paddock =>
  ({
    id,
    name,
    code: name,
    acresMeasured: 30,
    acresGrazable: 30,
    pastureId: null,
    unitType: "permanent",
    sweepHeadingDeg: 270,
    sweepLengthFt: 800,
    rotationOrder: 1,
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
  }) satisfies Paddock;

const openEvent = (groupId: string, paddockId: string, entered: string): GrazingEvent =>
  ({
    id: `e-${groupId}`,
    paddockId,
    groupId,
    enteredAt: entered,
    exitedAt: null,
    headCount: 30,
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
    sweptFrom: 0,
    sweptTo: 0.3,
    grazedShape: null,
  }) satisfies GrazingEvent;

const paddocks = [paddock("p1", "Paddock 1"), paddock("p2", "Paddock 2"), paddock("p3", "Paddock 3")];

describe("mobRoster", () => {
  it("puts the mob that has stood longest first", () => {
    // The question at the gate is not which mobs exist, it is which one has
    // been in the same paddock longest.
    const roster = mobRoster({
      groups: [mob("g1", "Finishers"), mob("g2", "Main mob"), mob("g3", "Yearlings")],
      paddocks,
      events: [
        openEvent("g1", "p1", "2026-08-26T08:00:00.000Z"), // today
        openEvent("g2", "p2", "2026-08-23T08:00:00.000Z"), // 3 days
        openEvent("g3", "p3", "2026-08-25T08:00:00.000Z"), // 1 day
      ],
      nowIso: NOW,
    });

    expect(roster.map((r) => [r.group.name, r.daysIn])).toEqual([
      ["Main mob", 3],
      ["Yearlings", 1],
      ["Finishers", 0],
    ]);
  });

  it("says where each mob is standing", () => {
    const roster = mobRoster({
      groups: [mob("g1", "Main mob")],
      paddocks,
      events: [openEvent("g1", "p2", "2026-08-24T08:00:00.000Z")],
      nowIso: NOW,
    });
    expect(roster[0].paddock?.name).toBe("Paddock 2");
  });

  it("sorts a mob with nowhere to be last, and does not call it freshly moved", () => {
    // Null rather than 0 days. A mob off pasture needs putting somewhere, but
    // it is not overdue a move, and "0 days" would read as "just moved".
    const roster = mobRoster({
      groups: [mob("g1", "Dry cows"), mob("g2", "Main mob")],
      paddocks,
      events: [openEvent("g2", "p1", "2026-08-25T08:00:00.000Z")],
      nowIso: NOW,
    });
    expect(roster.map((r) => [r.group.name, r.daysIn])).toEqual([
      ["Main mob", 1],
      ["Dry cows", null],
    ]);
    expect(roster[1].paddock).toBeNull();
  });

  it("leaves a stood-down mob out", () => {
    const roster = mobRoster({
      groups: [mob("g1", "Main mob"), mob("g2", "Last year's steers", false)],
      paddocks,
      events: [],
      nowIso: NOW,
    });
    expect(roster.map((r) => r.group.name)).toEqual(["Main mob"]);
  });

  it("ignores an event that has already been closed", () => {
    // A mob whose last move was logged out is off pasture, not still in the
    // paddock it left.
    const closed = { ...openEvent("g1", "p1", "2026-08-20T08:00:00.000Z"), exitedAt: "2026-08-22T08:00:00.000Z" };
    const roster = mobRoster({ groups: [mob("g1", "Main mob")], paddocks, events: [closed], nowIso: NOW });
    expect(roster[0].paddock).toBeNull();
    expect(roster[0].daysIn).toBeNull();
  });

  it("orders two mobs on the same day count by name, so the row does not shuffle", () => {
    // Both entered at the same hour, so both floor to one day. Comparing the
    // raw timestamps instead would reorder the row every few hours.
    const roster = mobRoster({
      groups: [mob("g1", "Yearlings"), mob("g2", "Cow-calf")],
      paddocks,
      events: [
        openEvent("g1", "p1", "2026-08-25T08:00:00.000Z"),
        openEvent("g2", "p2", "2026-08-25T09:00:00.000Z"),
      ],
      nowIso: NOW,
    });
    expect(roster.map((r) => [r.group.name, r.daysIn])).toEqual([
      ["Cow-calf", 1],
      ["Yearlings", 1],
    ]);
  });

  it("never reports negative days for an event dated ahead of now", () => {
    // Clock skew on a phone, or a move logged with tomorrow's date. "−1 days
    // in" is not a thing a page should ever print.
    const roster = mobRoster({
      groups: [mob("g1", "Main mob")],
      paddocks,
      events: [openEvent("g1", "p1", "2026-08-28T08:00:00.000Z")],
      nowIso: NOW,
    });
    expect(roster[0].daysIn).toBe(0);
  });

  it("still names the mob when its paddock is not in the list", () => {
    // A paddock retired while a mob stood in it. Losing the whole row would
    // hide a mob that very much needs moving.
    const roster = mobRoster({
      groups: [mob("g1", "Main mob")],
      paddocks: [],
      events: [openEvent("g1", "p1", "2026-08-24T08:00:00.000Z")],
      nowIso: NOW,
    });
    expect(roster[0].group.name).toBe("Main mob");
    expect(roster[0].paddock).toBeNull();
    // It is standing somewhere, so the days still count.
    expect(roster[0].daysIn).toBe(2);
  });
});
