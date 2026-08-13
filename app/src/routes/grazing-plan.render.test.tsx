// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  ContingencyDraft,
  ContingencyPlan,
  GrazingPlan,
  Paddock,
  PlanDraft,
  PlanPaddockTarget,
  PlanResourceConcern,
  TargetDraft,
} from "../lib/grazing";

/**
 * Herd → Plan. This page is where every threshold the module compares against
 * comes from, so what it must never do is supply one itself.
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
  id: `p${n}`, name: `Paddock ${n}`, code: `P${n}`,
  acresMeasured: 1.97, acresGrazable: 1.97,
  unitType: "permanent", sweepHeadingDeg: 270, sweepLengthFt: 424,
  seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
  noxiousSpecies: null, noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
});

const paddocks = [paddock(1), paddock(2)];
let plans: GrazingPlan[] = [];
const targets: PlanPaddockTarget[] = [];
const concerns: PlanResourceConcern[] = [];
const contingencies: ContingencyPlan[] = [];

const savedPlan = vi.fn(async (_f: string, _d: PlanDraft) => "plan-new");
const savedTarget = vi.fn(async (_f: string, _d: TargetDraft) => "t-new");
const addedConcern = vi.fn(
  async (_f: string, _plan: string, _category: string, _concern: string, _notes: string) => "c-new",
);
const addedContingency = vi.fn(async (_f: string, _d: ContingencyDraft) => "x-new");

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPlans: vi.fn(async () => plans),
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchPlanPaddockTargets: vi.fn(async () => targets),
    fetchResourceConcerns: vi.fn(async () => concerns),
    fetchContingencyPlans: vi.fn(async () => contingencies),
    savePlan: savedPlan,
    savePaddockTarget: savedTarget,
    addResourceConcern: addedConcern,
    addContingency: addedContingency,
  };
});

const plan = (over: Partial<GrazingPlan> = {}): GrazingPlan => ({
  id: "plan", name: "2026 season", periodStart: "2026-04-01", periodEnd: "2026-10-31",
  contractNumber: null, tractNumber: null, fieldIds: null,
  longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
  monitoringCadenceKind: "every_n_days", monitoringCadenceValue: 30,
  defaultDmiPctBw: 3, active: true, notes: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  plans = [];
  targets.length = 0;
  concerns.length = 0;
  contingencies.length = 0;
  savedPlan.mockClear();
  savedTarget.mockClear();
  addedConcern.mockClear();
  addedContingency.mockClear();
});

const mount = async () => {
  const { default: GrazingPlanPage } = await import("./GrazingPlan");
  render(<MemoryRouter><GrazingPlanPage /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

describe("with no plan", () => {
  it("says what a plan is for and what the app will not do without one", async () => {
    await mount();
    expect(screen.getByText(/every other screen says "no target" rather than making one up/)).toBeTruthy();
  });

  it("writes a first plan without standing anything down", async () => {
    await mount();
    fireEvent.click(screen.getByText("Write a plan"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "2026 season" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-31" } });
    fireEvent.change(screen.getByLabelText("Intake, % of bw"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(savedPlan).toHaveBeenCalledTimes(1));
    expect(savedPlan.mock.calls[0][1]).toMatchObject({
      planId: null, name: "2026 season", periodStart: "2026-04-01", defaultDmiPctBw: 3,
    });
  });

  it("will not save a plan with no name", async () => {
    await mount();
    fireEvent.click(screen.getByText("Write a plan"));
    fireEvent.click(screen.getByText("Save"));
    expect(savedPlan).not.toHaveBeenCalled();
  });
});

describe("with a plan in force", () => {
  it("edits in place rather than superseding", async () => {
    plans = [plan()];
    await mount();
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "2026 season, revised" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(savedPlan).toHaveBeenCalledTimes(1));
    expect(savedPlan.mock.calls[0][1].planId).toBe("plan");
  });

  it("warns that a new plan stands the current one down, and that nothing is lost", async () => {
    plans = [plan()];
    await mount();
    fireEvent.click(screen.getByText("Start a new plan"));
    expect(screen.getByText(/stands the current one down/)).toBeTruthy();
    expect(screen.getByText(/stay exactly where they are and stay readable/)).toBeTruthy();
  });

  it("sends a null id for a new plan, which is what supersedes", async () => {
    plans = [plan()];
    await mount();
    fireEvent.click(screen.getByText("Start a new plan"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "2027 season" } });
    fireEvent.click(screen.getByText("Put it in force"));

    await waitFor(() => expect(savedPlan).toHaveBeenCalledTimes(1));
    expect(savedPlan.mock.calls[0][1].planId).toBeNull();
  });

  it("keeps earlier plans on the page rather than hiding them", async () => {
    plans = [plan(), plan({ id: "old", name: "2025 season", active: false })];
    await mount();
    expect(screen.getByText("2025 season")).toBeTruthy();
    expect(screen.getByText(/stood down, still on record/)).toBeTruthy();
  });
});

describe("targets by paddock", () => {
  it("says recovery is two figures and why", async () => {
    plans = [plan()];
    await mount();
    expect(screen.getByText(/thirty days in June and thirty in September are not the same rest/)).toBeTruthy();
  });

  it("shows no targets set rather than zeros", async () => {
    plans = [plan()];
    await mount();
    expect(screen.getAllByText("no targets set").length).toBe(2);
  });

  it("saves both recovery figures separately", async () => {
    plans = [plan()];
    await mount();
    fireEvent.click(screen.getByText("Paddock 1"));
    fireEvent.change(screen.getByLabelText("Recovery, growing"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Recovery, dormant"), { target: { value: "55" } });
    fireEvent.change(screen.getByLabelText("Residual, in"), { target: { value: "4" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(savedTarget).toHaveBeenCalledTimes(1));
    expect(savedTarget.mock.calls[0][1]).toMatchObject({
      planId: "plan", paddockId: "p1",
      minRecoveryDaysGrowing: 25, minRecoveryDaysDormant: 55, targetResidualHeightIn: 4,
    });
  });

  it("opens an existing target with its figures already in it", async () => {
    plans = [plan()];
    targets.push({
      id: "t1", planId: "plan", paddockId: "p2",
      targetEntryHeightIn: 8, targetResidualHeightIn: 4,
      minRecoveryDaysGrowing: 30, minRecoveryDaysDormant: 60,
      targetUtilizationPct: 50, plannedGrazingNotes: null,
      plannedDefermentNotes: null, sensitiveAreaStrategy: null, notes: null,
    });
    await mount();
    fireEvent.click(screen.getByText("Paddock 2"));
    expect((screen.getByLabelText("Recovery, growing") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Utilization, %") as HTMLInputElement).value).toBe("50");
  });
});

describe("contingency triggers", () => {
  it("says a trigger with no threshold is a worry rather than a plan", async () => {
    plans = [plan()];
    await mount();
    expect(screen.getByText(/"dry" is not something you can tell has happened/)).toBeTruthy();
  });

  it("marks one that has no threshold", async () => {
    plans = [plan()];
    contingencies.push({
      id: "x1", planId: "plan", triggerType: "drought",
      triggerThreshold: null, plannedResponse: "Sell the yearlings",
      holdingAreaId: null, notes: null,
    });
    await mount();
    expect(screen.getByText("no threshold")).toBeTruthy();
  });

  it("adds one with what trips it and what you do", async () => {
    plans = [plan()];
    await mount();
    fireEvent.change(screen.getByLabelText("Trigger"), { target: { value: "forage_shortfall" } });
    fireEvent.change(screen.getByLabelText("What trips it"), { target: { value: "Under 10 days' feed ahead" } });
    fireEvent.change(screen.getByLabelText("What you do"), { target: { value: "Start feeding hay" } });
    fireEvent.click(screen.getAllByText("Add")[1]);

    await waitFor(() => expect(addedContingency).toHaveBeenCalledTimes(1));
  });

  it("will not add one with no threshold", async () => {
    plans = [plan()];
    await mount();
    fireEvent.click(screen.getAllByText("Add")[1]);
    expect(addedContingency).not.toHaveBeenCalled();
  });
});

describe("resource concerns", () => {
  it("adds one under a category", async () => {
    plans = [plan()];
    await mount();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "water" } });
    fireEvent.change(screen.getByLabelText("Concern"), { target: { value: "Runoff at the road ditch" } });
    fireEvent.click(screen.getAllByText("Add")[0]);
    await waitFor(() => expect(addedConcern).toHaveBeenCalledTimes(1));
    expect(addedConcern.mock.calls[0][2]).toBe("water");
  });
});
