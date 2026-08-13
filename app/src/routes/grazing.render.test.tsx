// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  unitType: "permanent",
  sweepHeadingDeg: n === 5 ? 0 : n % 2 === 0 ? 90 : 270,
  sweepLengthFt: 400,
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
const events: GrazingEvent[] = [];
const members: GrazingGroupMember[] = [
  { id: "m1", groupId: "mob", animalId: "a1", joinedOn: "2026-08-13", leftOn: null },
  { id: "m2", groupId: "mob", animalId: "a2", joinedOn: "2026-08-13", leftOn: null },
  { id: "m3", groupId: "mob", animalId: "a3", joinedOn: "2026-08-13", leftOn: null },
  { id: "m4", groupId: "mob", animalId: "a4", joinedOn: "2026-08-13", leftOn: null },
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
            defaultDmiPctBw: 2.5, active: true, notes: null,
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

describe("logging a move", () => {
  it("prefills head from the mob's members and leaves weight blank when nobody is weighed", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    expect((screen.getByLabelText("Head") as HTMLInputElement).value).toBe("4");
    // Nothing in herd.weights, so no figure is invented.
    expect((screen.getByLabelText("Avg weight, lb") as HTMLInputElement).value).toBe("");
  });

  it("takes the average weight from the animals once they have been weighed", async () => {
    weights.set("a1", 1000);
    weights.set("a2", 1200);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    expect((screen.getByLabelText("Avg weight, lb") as HTMLInputElement).value).toBe("1100");
  });

  it("keeps the unit they are in on the list, because the next strip is the commonest move", async () => {
    events.push(event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.2 }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    const options = [...(screen.getByLabelText("Move to") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith("Paddock 3") && o.includes("next strip"))).toBe(true);
    expect(options.some((o) => o?.startsWith("Paddock 1"))).toBe(true);
  });

  it("sends the move, and says where they went", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: /Log the move/ }));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const draft = moved.mock.calls[0][1];
    expect(draft.paddockId).toBe("p2");
    expect(draft.groupId).toBe("mob");
    expect(draft.headCount).toBe(4);
    // A swept unit reports the strip that was opened, not just the move.
    expect(draft.sweptFrom).toBe(0);
    expect(draft.sweptTo).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/acres of Paddock 2 opened to Main mob\./)).toBeTruthy());
  });

  it("won't send without a destination", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    expect((screen.getByRole("button", { name: /Log the move/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks what the paddock was left at only when there is one to leave", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    expect(screen.queryByLabelText("Residual out, in")).toBeNull();

    cleanup();
    events.push(event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z" }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    expect(screen.getByLabelText("Residual out, in")).toBeTruthy();
    expect(screen.getByText(/Leaving/).textContent).toContain("Paddock 3");
  });

  it("warns when a paddock is short of its recovery target, and still allows it", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p1" } });

    expect(screen.getByText(/18 days short of its recovery target/)).toBeTruthy();
    expect(screen.getByText(/outside plan target/)).toBeTruthy();
    // A warning, not a block.
    expect((screen.getByRole("button", { name: /Log the move/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers taking them off pasture only when they are on it", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    expect(screen.queryByRole("button", { name: "Off pasture" })).toBeNull();

    cleanup();
    events.push(event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z" }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.click(screen.getByRole("button", { name: "Off pasture" }));
    await waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
  });

  it("shows the strip in acres, feed and density as the wire moves", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });

    // Opens at roughly a day's feed for 4 head at no recorded weight — with
    // no weight the app cannot size it, so it falls back to a nominal width.
    const wire = screen.getByLabelText("Wire position") as HTMLInputElement;
    expect(wire).toBeTruthy();

    fireEvent.change(wire, { target: { value: "200" } }); // 20% of the unit
    const stats = document.querySelector(".grz-strip-stats")!;
    // 20% of 1.91 grazable acres.
    expect(stats.textContent).toContain("0.38");
    // 400 ft sweep, so 20% is 80 feet of wire advance.
    expect(stats.textContent).toContain("80′");
  });

  it("sizes a day and half a day from the plan's assumptions", async () => {
    weights.set("a1", 1100);
    weights.set("a2", 1100);
    weights.set("a3", 1100);
    weights.set("a4", 1100);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });

    fireEvent.click(screen.getByRole("button", { name: "A day" }));
    const day = Number((screen.getByLabelText("Wire position") as HTMLInputElement).value);

    fireEvent.click(screen.getByRole("button", { name: "Half a day" }));
    const half = Number((screen.getByLabelText("Wire position") as HTMLInputElement).value);

    // Half a day is half the ground, give or take the slider's step.
    expect(Math.abs(day / 2 - half)).toBeLessThanOrEqual(5);
  });

  it("opens the rest of the unit in one tap, for the last strip of a pass", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "The rest of it" }));
    expect((screen.getByLabelText("Wire position") as HTMLInputElement).value).toBe("1000");
  });

  it("starts the next strip where the last one ended", async () => {
    events.push(event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.35 }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p3" } });

    // The wire cannot go back over ground they have just taken.
    const wire = screen.getByLabelText("Wire position") as HTMLInputElement;
    expect(Number(wire.min)).toBe(355);
    expect(document.querySelector(".grz-wire__pos")!.textContent).toContain("35%");
  });

  it("says which way the unit is swept", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });
    expect(screen.getByText(/swept west to east/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p5" } });
    expect(screen.getByText(/swept south to north/)).toBeTruthy();
  });

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

describe("the strip readout takes its figures from the plan", () => {
  it("says plainly when a figure is the app's own", async () => {
    events.push(event({ id: "a", paddockId: "p1", enteredAt: "2026-07-01T12:00:00.000Z", exitedAt: "2026-08-01T12:00:00.000Z" }));
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });
    // All three: no plan, no target, no availability record.
    expect(screen.getAllByText(/this app's figure/)).toHaveLength(3);
  });

  it("uses the plan's intake and the paddock's utilization once they exist", async () => {
    hasPlan = true;
    targets.push({
      id: "t1", planId: "plan", paddockId: "p2",
      targetEntryHeightIn: null, targetResidualHeightIn: null,
      minRecoveryDaysGrowing: null, minRecoveryDaysDormant: null,
      targetUtilizationPct: 40, plannedGrazingNotes: null,
      plannedDefermentNotes: null, sensitiveAreaStrategy: null, notes: null,
    });
    availability.push({
      id: "av1", planId: null, paddockId: "p2",
      periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "August",
      lbDmPerAcre: 1800, aum: null, speciesMix: null, qualityNote: null,
      isPlanned: false, basis: "clipping", notes: null,
    });
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });

    expect(screen.getByText(/1,800 lb DM\/acre/)).toBeTruthy();
    expect(screen.getAllByText(/measured on this unit/)).toHaveLength(1);
    expect(screen.getByText(/40% utilization/)).toBeTruthy();
    // Utilization from the paddock's target, intake from the plan's default.
    expect(screen.getAllByText(/from your plan/)).toHaveLength(2);
    expect(screen.queryByText(/this app's figure/)).toBeNull();
  });

  it("marks a projection as one rather than letting it read as measured", async () => {
    availability.push({
      id: "av1", planId: null, paddockId: "p2",
      periodStart: "2026-08-01", periodEnd: "2026-08-31", periodLabel: "August",
      lbDmPerAcre: 1800, aum: null, speciesMix: null, qualityNote: null,
      isPlanned: true, basis: "extension_table", notes: null,
    });
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.change(screen.getByLabelText("Move to"), { target: { value: "p2" } });
    expect(screen.getByText(/your projection/)).toBeTruthy();
  });
});
