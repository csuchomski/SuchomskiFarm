// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
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
 * The farm's real shape — five units at 1.91 grazable acres, one mob.
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
  boundaryOverride: null,
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
    fetchGroupMembers: vi.fn(async () => members),
    fetchLatestWeights: vi.fn(async () => weights),
    fetchActivePlan: vi.fn(async () => (hasPlan ? { id: "plan" } : null)),
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

  it("offers every paddock but the one they are standing in", async () => {
    events.push(event({ id: "c", paddockId: "p3", enteredAt: "2026-08-10T12:00:00.000Z" }));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a move" }));
    const options = [...(screen.getByLabelText("Move to") as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options.some((o) => o?.startsWith("Paddock 3"))).toBe(false);
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
    await waitFor(() => expect(screen.getByText(/Main mob moved to Paddock 2\./)).toBeTruthy());
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

  it("never says anything about compliance", async () => {
    hasPlan = true;
    await mount();
    expect(document.body.textContent).not.toMatch(/complian|meets 528/i);
  });
});
