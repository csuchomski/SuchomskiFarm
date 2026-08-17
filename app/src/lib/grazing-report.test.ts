import { describe, expect, it } from "vitest";
import { gaps, livestockType, overlaps, reportRows, stripNumbers, totalAcres } from "./grazing-report";
import type { GrazingEvent, GrazingGroup, Paddock } from "./grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "./__fixtures__/farm-geometry";

/**
 * The 528 payment record.
 *
 * The form asks for eight things and the module already had all eight. What is
 * worth testing is the two decisions that were not forced: how a strip gets a
 * number, and what "in this date range" means for a strip that spans one end
 * of it.
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

const farm = [1, 2, 3, 4, 5].map(unit);

const mob: GrazingGroup = {
  id: "mob", name: "Main mob", species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null,
};

const ev = (over: Partial<GrazingEvent> & { id: string; paddockId: string; enteredAt: string }): GrazingEvent => ({
  groupId: "mob", exitedAt: null, headCount: 5, avgWeightLb: 1000,
  forageHeightInEntry: 9, residualHeightInExit: 4, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null, sweptFrom: 0, sweptTo: 0.2, grazedShape: null,
  ...over,
});

describe("numbering a strip", () => {
  // Closed on purpose: an open strip overlaps every window from its start,
  // which is right and would put all three in the June range below.
  const events = [
    ev({ id: "c", paddockId: "p4", enteredAt: "2026-06-03T12:00:00.000Z", exitedAt: "2026-06-04T12:00:00.000Z" }),
    ev({ id: "a", paddockId: "p4", enteredAt: "2026-06-01T12:00:00.000Z", exitedAt: "2026-06-01T18:00:00.000Z" }),
    ev({ id: "b", paddockId: "p3", enteredAt: "2026-06-02T12:00:00.000Z", exitedAt: "2026-06-02T18:00:00.000Z" }),
  ];

  it("counts within a paddock, in the order they were grazed", () => {
    const n = stripNumbers(events, farm);
    expect(n.get("a")).toBe("P4-1");
    expect(n.get("c")).toBe("P4-2");
    expect(n.get("b")).toBe("P3-1");
  });

  it("gives a strip the same number in every report that contains it", () => {
    // Numbering inside the window would renumber the same ground between two
    // overlapping printouts, which is how a pile of forms stops being trusted.
    const all = stripNumbers(events, farm);
    const june = reportRows({ events, paddocks: farm, groups: [mob], from: "2026-06-02", to: "2026-06-30" });
    expect(june.map((r) => r.number)).toEqual(["P3-1", "P4-2"]);
    expect(june.find((r) => r.eventId === "c")!.number).toBe(all.get("c"));
  });

  it("does not swap two strips entered at the same moment", () => {
    const same = [
      ev({ id: "z", paddockId: "p1", enteredAt: "2026-06-01T12:00:00.000Z" }),
      ev({ id: "y", paddockId: "p1", enteredAt: "2026-06-01T12:00:00.000Z" }),
    ];
    expect(stripNumbers(same, farm).get("y")).toBe("P1-1");
    expect(stripNumbers(same.slice().reverse(), farm).get("y")).toBe("P1-1");
  });

  it("falls back to the paddock's name when it has no code", () => {
    const named = [{ ...unit(1), code: null }];
    const n = stripNumbers([ev({ id: "a", paddockId: "p1", enteredAt: "2026-06-01T12:00:00.000Z" })], named);
    expect(n.get("a")).toBe("Paddock 1-1");
  });
});

describe("what falls inside the range", () => {
  const on = (from: string, to: string, over: Partial<GrazingEvent> = {}) =>
    overlaps(ev({ id: "e", paddockId: "p1", enteredAt: "2026-06-10T12:00:00.000Z", ...over }), from, to);

  it("takes a strip grazed inside it", () => {
    expect(on("2026-06-01", "2026-06-30")).toBe(true);
  });

  it("takes one that started before and was still on at the start", () => {
    // Grazing that happened in June is June's record, whatever month it began.
    expect(on("2026-06-20", "2026-06-30", {
      enteredAt: "2026-06-01T12:00:00.000Z", exitedAt: "2026-06-25T12:00:00.000Z",
    })).toBe(true);
  });

  it("takes one still open, however long ago it began", () => {
    expect(on("2026-08-01", "2026-08-31", { exitedAt: null })).toBe(true);
  });

  it("leaves out one that finished before the window", () => {
    expect(on("2026-07-01", "2026-07-31", {
      enteredAt: "2026-06-01T12:00:00.000Z", exitedAt: "2026-06-05T12:00:00.000Z",
    })).toBe(false);
  });

  it("leaves out one that had not started", () => {
    expect(on("2026-05-01", "2026-05-31")).toBe(false);
  });

  it("counts a strip in and out on the first day of the window", () => {
    expect(on("2026-06-10", "2026-06-30", { exitedAt: "2026-06-10T18:00:00.000Z" })).toBe(true);
  });
});

describe("the row the form wants", () => {
  const events = [
    ev({ id: "a", paddockId: "p4", enteredAt: "2026-08-13T12:00:00.000Z",
         exitedAt: "2026-08-14T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.15,
         forageHeightInEntry: 12, residualHeightInExit: 5, headCount: 5 }),
    ev({ id: "b", paddockId: "p4", enteredAt: "2026-08-14T12:00:00.000Z",
         exitedAt: null, sweptFrom: 0.15, sweptTo: 0.34,
         forageHeightInEntry: null, residualHeightInExit: null, headCount: 4 }),
  ];
  const rows = reportRows({ events, paddocks: farm, groups: [mob], from: "2026-08-01", to: "2026-08-31" });

  it("fills every column the form asks for", () => {
    expect(rows[0]).toMatchObject({
      number: "P4-1", livestockType: "Cattle, mixed", headCount: 5,
      dateIn: "2026-08-13", heightInEntry: 12, dateOut: "2026-08-14", heightOutExit: 5,
    });
  });

  it("measures the acres off the drawn strip, not a share of the paddock", () => {
    // P4 is a wedge: its first fifteenth is worth well under a fifteenth.
    const flat = 0.15 * (unit(4).acresGrazable ?? 0);
    expect(rows[0].acres!).toBeLessThan(flat * 0.9);
  });

  it("leaves a blank rather than inventing a height or a date out", () => {
    expect(rows[1].heightInEntry).toBeNull();
    expect(rows[1].heightOutExit).toBeNull();
    expect(rows[1].dateOut).toBeNull();
  });

  it("orders by the day they went in", () => {
    expect(rows.map((r) => r.eventId)).toEqual(["a", "b"]);
  });

  it("says the paddock is not on file rather than dropping the row", () => {
    const orphan = reportRows({
      events: [ev({ id: "x", paddockId: "gone", enteredAt: "2026-08-13T12:00:00.000Z" })],
      paddocks: farm, groups: [mob], from: "2026-08-01", to: "2026-08-31",
    });
    expect(orphan).toHaveLength(1);
    expect(orphan[0].paddockName).toBe("Not on file");
    expect(orphan[0].acres).toBeNull();
  });

  it("names the livestock only from what is on the mob", () => {
    expect(livestockType({ ...mob, class: null })).toBe("Cattle");
    expect(livestockType({ ...mob, species: null, class: null })).toBeNull();
    expect(livestockType(null)).toBeNull();
  });
});

describe("the totals and the gaps", () => {
  const rows = reportRows({
    events: [
      ev({ id: "a", paddockId: "p3", enteredAt: "2026-08-01T12:00:00.000Z", exitedAt: "2026-08-02T12:00:00.000Z" }),
      ev({ id: "b", paddockId: "p3", enteredAt: "2026-08-03T12:00:00.000Z", exitedAt: "2026-08-04T12:00:00.000Z",
           forageHeightInEntry: null, residualHeightInExit: null, headCount: null }),
      ev({ id: "c", paddockId: "p3", enteredAt: "2026-08-05T12:00:00.000Z", exitedAt: null }),
    ],
    paddocks: farm, groups: [mob], from: "2026-08-01", to: "2026-08-31",
  });

  it("adds the acres it could measure and says how many it could not", () => {
    const t = totalAcres(rows);
    expect(t.measured).toBe(3);
    expect(t.missing).toBe(0);
    expect(t.acres).toBeGreaterThan(0);
  });

  it("does not count an unmeasurable strip as nought acres", () => {
    const t = totalAcres([...rows, { ...rows[0], eventId: "z", acres: null }]);
    expect(t.missing).toBe(1);
    expect(t.acres).toBeCloseTo(totalAcres(rows).acres, 9);
  });

  it("names what the record does not say", () => {
    const said = gaps(rows).join(" | ");
    expect(said).toContain("1 without a forage height going in");
    expect(said).toContain("1 left without a height coming off");
    expect(said).toContain("1 without a head count");
    expect(said).toContain("1 still open");
  });

  it("says nothing when the record is complete", () => {
    const full = reportRows({
      events: [ev({ id: "a", paddockId: "p3", enteredAt: "2026-08-01T12:00:00.000Z", exitedAt: "2026-08-02T12:00:00.000Z" })],
      paddocks: farm, groups: [mob], from: "2026-08-01", to: "2026-08-31",
    });
    expect(gaps(full)).toEqual([]);
  });
});
