// A farm in Wisconsin, not in Greenwich. Set before anything reads a clock:
// Node resolves the zone lazily, so this has to happen at module load, and it
// is the whole point of the file — under UTC every assertion below passes
// against the broken code, because UTC is the one zone where slicing the
// front off an ISO string happens to be right.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ =
  "America/Chicago";

import { describe, expect, it } from "vitest";
import { localDay, todayLocal } from "./local-time";
import { reportRows, overlaps } from "./grazing-report";
import type { GrazingEvent, GrazingGroup, Paddock } from "./grazing";

/**
 * What day a move happened on.
 *
 * The record keeps instants in UTC. The farm keeps a calendar on the kitchen
 * wall. Between five and six in the afternoon, depending on the season, those
 * two stop agreeing — and the payment record was reading the day straight off
 * the front of the stored string.
 *
 * The farm's own record showed it: three moves, of which two were made on the
 * 17th of August. They printed as the 16th, the 17th and the 18th, because
 * the one made at 20:23 crossed midnight in Greenwich. A conservationist
 * reading that form is being told the herd was somewhere it was not, on a day
 * it was not there.
 */

const paddock: Paddock = {
  id: "p1", name: "Paddock 5", pastureId: null, code: "P5",
  acresMeasured: 1.381, acresGrazable: 1.381, unitType: "permanent",
  sweepHeadingDeg: null, sweepLengthFt: null, rotationOrder: 5,
  seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
  noxiousSpecies: null, noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
};

const mob: GrazingGroup = {
  id: "mob", name: "Main mob", species: "cattle", class: "cow-calf",
  headCountManual: 5, avgWeightLbManual: 1100, active: true, notes: null,
};

/** An instant, given as the farm would say it: a local date and hour. */
const at = (y: number, m: number, d: number, hh: number, mm: number): string =>
  new Date(y, m - 1, d, hh, mm).toISOString();

const move = (id: string, enteredAt: string, exitedAt: string | null): GrazingEvent => ({
  id, paddockId: "p1", groupId: "mob", enteredAt, exitedAt,
  headCount: 5, avgWeightLb: 1100, forageHeightInEntry: 9, residualHeightInExit: 4,
  utilizationPct: null, soilMoisture: null, supplementalFeed: false,
  weatherNotes: null, notes: null, latitude: null, longitude: null,
  sweptFrom: null, sweptTo: null, grazedShape: null,
});

describe("the day a move happened", () => {
  it("is the day it was on the farm, not the day it was in Greenwich", () => {
    // 20:23 on the 17th of August, central time. Stored as the 18th, 01:23Z.
    const evening = at(2026, 8, 17, 20, 23);
    expect(evening.slice(0, 10)).toBe("2026-08-18"); // what the record holds
    expect(localDay(evening)).toBe("2026-08-17"); // what happened
  });

  it("reports an evening move on the day it was made", () => {
    const rows = reportRows({
      events: [move("e1", at(2026, 8, 17, 20, 23), null)],
      paddocks: [paddock], groups: [mob],
      from: "2026-08-01", to: "2026-08-31",
    });
    expect(rows.map((r) => r.dateIn)).toEqual(["2026-08-17"]);
  });

  it("holds two moves made on the same day on that one day", () => {
    // The farm's own record: out in the morning, moved again after supper.
    const rows = reportRows({
      events: [
        move("e1", at(2026, 8, 17, 7, 37), at(2026, 8, 17, 20, 23)),
        move("e2", at(2026, 8, 17, 20, 23), null),
      ],
      paddocks: [paddock], groups: [mob],
      from: "2026-08-01", to: "2026-08-31",
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dateIn)).toEqual(["2026-08-17", "2026-08-17"]);
    // and the first one's departure is the same day too, not the next
    expect(rows[0].dateOut).toBe("2026-08-17");
  });

  it("keeps the whole of the farm's three moves on the right three days", () => {
    const rows = reportRows({
      events: [
        move("e1", at(2026, 8, 16, 7, 35), at(2026, 8, 17, 7, 37)),
        move("e2", at(2026, 8, 17, 7, 37), at(2026, 8, 17, 20, 23)),
        move("e3", at(2026, 8, 17, 20, 23), null),
      ],
      paddocks: [paddock], groups: [mob],
      from: "2026-08-01", to: "2026-08-31",
    });
    expect(rows.map((r) => r.dateIn)).toEqual(["2026-08-16", "2026-08-17", "2026-08-17"]);
  });

  it("counts a move into the window by the farm's calendar", () => {
    // Logged the evening of the 31st: in August, not September, however the
    // stored timestamp reads.
    const lastNight = move("e1", at(2026, 8, 31, 21, 0), null);
    expect(overlaps(lastNight, "2026-08-01", "2026-08-31")).toBe(true);
  });

  it("does not offer tomorrow as today when the form is opened after supper", () => {
    // `new Date().toISOString().slice(0, 10)` is tomorrow all evening here,
    // which is how the report's default window came to end a day out.
    const now = new Date();
    expect(todayLocal()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    );
  });
});
