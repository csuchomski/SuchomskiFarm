// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  ForageAvailability,
  ForageRemoval,
  MoveDraft,
  GrazingEvent,
  GrazingGroup,
  GrazingGroupMember,
  Paddock,
  Pasture,
  PlanPaddockTarget,
} from "../lib/grazing";

/**
 * Herd → Grazing: the board, and the move.
 *
 * Five units and one mob, as on the farm. The flat 1.91 acres is a fixture —
 * the real units differ, and 040 has the measured figures.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd", "store", "books"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const paddock = (n: number): Paddock => ({
  id: `p${n}`,
  name: `Paddock ${n}`,
  code: `P${n}`,
  acresMeasured: 1.91,
  acresGrazable: 1.91,
  // Paddocks 1 and 2 are on the home place; 3, 4 and 5 predate pastures.
  pastureId: n <= 2 ? "past-1" : null,
  unitType: "permanent",
  sweepHeadingDeg: n === 5 ? 0 : n % 2 === 0 ? 90 : 270,
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

const paddocks = [1, 2, 3, 4, 5].map(paddock);
// Two of the five sit on a named pasture; the rest predate pastures, which is
// the state a farm is in the day after migration 052 runs.
const pastures: Pasture[] = [
  { id: "past-1", name: "Home place", code: "HOME", acres: 62.5, notes: null, active: true, propertyId: null, boundary: null },
];
const events: GrazingEvent[] = [];
const members: GrazingGroupMember[] = [
  { id: "m1", groupId: "mob", animalId: "a1", joinedOn: "2026-08-13", leftOn: null, animalStatus: "active" },
  { id: "m2", groupId: "mob", animalId: "a2", joinedOn: "2026-08-13", leftOn: null, animalStatus: "active" },
  { id: "m3", groupId: "mob", animalId: "a3", joinedOn: "2026-08-13", leftOn: null, animalStatus: "active" },
  { id: "m4", groupId: "mob", animalId: "a4", joinedOn: "2026-08-13", leftOn: null, animalStatus: "active" },
];
const weights = new Map<string, number>();
const targets: PlanPaddockTarget[] = [];
const removals: ForageRemoval[] = [];
const availability: ForageAvailability[] = [];
let hasPlan = false;

const moved = vi.fn(async (_farmId: string, _draft: MoveDraft) => "new-event");
const ended = vi.fn(
  async (_farmId: string, _groupId: string, _at: string, _residual: number | null, _util: number | null) => {},
);

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchPastures: vi.fn(async () => pastures),
    fetchGrazingGroups: vi.fn(async () => [mob]),
    fetchGrazingEvents: vi.fn(async () => events),
    fetchForageRemovals: vi.fn(async () => removals),
    fetchForageAvailability: vi.fn(async () => availability),
    fetchGroupMembers: vi.fn(async () => members),
    fetchLatestWeights: vi.fn(async () => weights),
    fetchActivePlan: vi.fn(async () =>
      hasPlan
        ? {
            id: "plan", name: "2026", periodStart: null, periodEnd: null,
            contractNumber: null, tractNumber: null, fieldIds: null,
            longTermGoals: null, immediateObjectives: null,
            benchmarkStockingRateAumPerAcre: null,
            monitoringCadenceKind: "every_rotation", monitoringCadenceValue: null,
            defaultDmiPctBw: 2.5, lbDmPerAcreInch: 300, targetResidualHeightIn: null,
  defaultUtilizationPct: null, tramplingLossPct: null, fouledAreaPct: null, active: true, notes: null,
          }
        : null,
    ),
    fetchPlanPaddockTargets: vi.fn(async () => targets),
    logMove: moved,
    endGrazing: ended,
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  events.length = 0;
  targets.length = 0;
  removals.length = 0;
  availability.length = 0;
  weights.clear();
  hasPlan = false;
  moved.mockClear();
  ended.mockClear();
});

const mount = async () => {
  const { default: Grazing } = await import("./Grazing");
  render(
    <MemoryRouter>
      <Grazing />
    </MemoryRouter>,
  );
  await screen.findByText("Paddock 1");
};

describe("the paddock board", () => {
  it("heads with the units and the grazable acres", async () => {
    await mount();
    expect(screen.getByText(/5 paddocks · 9\.55 grazable acres/)).toBeTruthy();
  });

  it("says the mob is off pasture when nothing is open", async () => {
    await mount();
    expect(screen.getByText(/is not on pasture/)).toBeTruthy();
  });

  it("says where they are, for how long, and at what density", async () => {
    events.push(event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z" }));
    await mount();
    // 5 head × 1,100 lb over 1.91 acres.
    expect(screen.getByText(/has been in/).textContent).toMatch(
      /Main mob has been in Paddock 3 for 3 days — 2,880 lb per acre\./,
    );
  });

  it("puts the longest-rested paddock at the top and the occupied one last", async () => {
    events.push(
      event({ id: "a", paddockId: "p1", enteredAt: "2026-07-20T12:00:00.000Z", exitedAt: "2026-08-01T12:00:00.000Z" }),
      event({ id: "b", paddockId: "p2", enteredAt: "2026-08-05T12:00:00.000Z", exitedAt: "2026-08-10T12:00:00.000Z" }),
      event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z" }),
    );
    await mount();
    const order = [...document.querySelectorAll(".grid-row--body .serif")].map((n) => n.textContent);
    expect(order).toEqual(["Paddock 1", "Paddock 2", "Paddock 4", "Paddock 5", "Paddock 3"]);
  });

  it("distinguishes rested, never grazed, and occupied", async () => {
    events.push(
      event({ id: "a", paddockId: "p1", enteredAt: "2026-07-20T12:00:00.000Z", exitedAt: "2026-08-01T12:00:00.000Z" }),
      event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z" }),
    );
    await mount();
    expect(screen.getByText("12 days")).toBeTruthy();
    expect(screen.getAllByText("never grazed").length).toBe(3);
    expect(screen.getByText("occupied")).toBeTruthy();
  });

  it("says there is no plan, and why that means no target", async () => {
    await mount();
    expect(screen.getByText(/No grazing plan is on file/)).toBeTruthy();
    expect(screen.getByText(/a judgement about your ground, not arithmetic/)).toBeTruthy();
  });

  it("shows how short of target a paddock is when a plan says so", async () => {
    hasPlan = true;
    targets.push({
      id: "t1", planId: "plan", paddockId: "p1",
      targetEntryHeightIn: null, targetResidualHeightIn: null,
      minRecoveryDaysGrowing: 30, minRecoveryDaysDormant: 60,
      targetUtilizationPct: null, plannedGrazingNotes: null,
      plannedDefermentNotes: null, sensitiveAreaStrategy: null, notes: null,
    });
    events.push(
      event({ id: "a", paddockId: "p1", enteredAt: "2026-07-20T12:00:00.000Z", exitedAt: "2026-08-01T12:00:00.000Z" }),
    );
    await mount();
    expect(screen.getByText("18d short")).toBeTruthy();
    expect(screen.queryByText(/No grazing plan is on file/)).toBeNull();
  });
});

/**
 * The move form that used to be on this page is on Herd → Move now, and its
 * tests went with it. What is left here is what a board is for: the state of
 * every unit, and whether one is ready.
 */
describe("what the board still answers on its own", () => {
  it("shows a unit's ground as bands, not one rest figure", async () => {
    events.push(
      event({ id: "a", paddockId: "p1", enteredAt: "2026-07-20T12:00:00.000Z", exitedAt: "2026-07-22T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.4 }),
      event({ id: "b", paddockId: "p1", enteredAt: "2026-08-01T12:00:00.000Z", exitedAt: "2026-08-03T12:00:00.000Z", sweptFrom: 0.4, sweptTo: 1 }),
    );
    await mount();
    const bars = document.querySelectorAll(".grz-bands");
    expect(bars.length).toBeGreaterThan(0);
    // Paddock 1 was taken in two strips, so its ground is two bands.
    const p1Bar = [...document.querySelectorAll(".grid-row--body")]
      .find((r) => r.textContent?.includes("Paddock 1"))!
      .querySelector(".grz-bands")!;
    expect(p1Bar.children.length).toBe(2);
  });

  it("judges readiness from the start of the sweep, not the last strip", async () => {
    events.push(
      event({ id: "a", paddockId: "p1", enteredAt: "2026-06-01T12:00:00.000Z", exitedAt: "2026-06-04T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.5 }),
      event({ id: "b", paddockId: "p1", enteredAt: "2026-08-09T12:00:00.000Z", exitedAt: "2026-08-11T12:00:00.000Z", sweptFrom: 0.5, sweptTo: 1 }),
    );
    await mount();
    const p1 = [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes("Paddock 1"))!;
    // From the last strip it would read 2 days and hold the unit back.
    expect(p1.textContent).toContain("70 days");
  });

  it("never says anything about compliance", async () => {
    hasPlan = true;
    await mount();
    expect(document.body.textContent).not.toMatch(/complian|meets 528/i);
  });
});
