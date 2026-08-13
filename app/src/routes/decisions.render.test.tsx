// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ContingencyPlan, DecisionDraft, GrazingPlan, ManagementDecision } from "../lib/grazing";

/**
 * Herd → Decisions. The record most operations do not keep: what was seen,
 * what it meant, and what was done about it, kept as three things.
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

const decisions: ManagementDecision[] = [];
const contingencies: ContingencyPlan[] = [];
let plan: GrazingPlan | null = null;

const saved = vi.fn(async (_f: string, _d: DecisionDraft) => "d-new");

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchManagementDecisions: vi.fn(async () => decisions),
    fetchActivePlan: vi.fn(async () => plan),
    fetchContingencyPlans: vi.fn(async () => contingencies),
    recordDecision: saved,
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  decisions.length = 0;
  contingencies.length = 0;
  plan = null;
  saved.mockClear();
});

const mount = async () => {
  const { default: Decisions } = await import("./Decisions");
  render(<MemoryRouter><Decisions /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

const decision = (over: Partial<ManagementDecision> = {}): ManagementDecision => ({
  id: "d1", planId: "plan", decidedOn: "2026-07-04",
  observation: "Ground still wet in the low corner",
  triggerDescription: "Saturated soil, pugging starting",
  decision: "Pulled them onto Paddock 1 two days early",
  contingencyPlanId: null, monitoringRecordId: null, grazingEventId: null,
  outcomeFollowup: null, followedUpOn: null, ...over,
});

describe("what the log is for", () => {
  it("explains itself, in the farm's terms", async () => {
    await mount();
    expect(screen.getByText(/pulled the mob off early because the ground was wet/)).toBeTruthy();
    expect(screen.getByText(/what Operation and Maintenance is really asking for/)).toBeTruthy();
  });

  it("keeps the three parts apart on screen", async () => {
    decisions.push(decision());
    await mount();
    expect(screen.getByText("Saw")).toBeTruthy();
    expect(screen.getByText("Meant")).toBeTruthy();
    expect(screen.getByText("Did")).toBeTruthy();
  });

  it("marks one with no follow-up yet", async () => {
    decisions.push(decision());
    await mount();
    expect(screen.getByText("no follow-up yet")).toBeTruthy();
  });

  it("shows the outcome once there is one", async () => {
    decisions.push(decision({ outcomeFollowup: "Corner recovered by August", followedUpOn: "2026-08-10" }));
    await mount();
    expect(screen.getByText("Turned out")).toBeTruthy();
    expect(screen.queryByText("no follow-up yet")).toBeNull();
  });

  it("names the plan trigger it was made against", async () => {
    contingencies.push({
      id: "x1", planId: "plan", triggerType: "saturated_soil",
      triggerThreshold: "Standing water after rain", plannedResponse: "Move to the high units",
      holdingAreaId: null, notes: null,
    });
    plan = {
      id: "plan", name: "2026", periodStart: null, periodEnd: null,
      contractNumber: null, tractNumber: null, fieldIds: null,
      longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
      monitoringCadenceKind: "every_rotation", monitoringCadenceValue: null,
      defaultDmiPctBw: 3, lbDmPerAcreInch: 300, active: true, notes: null,
    };
    decisions.push(decision({ contingencyPlanId: "x1" }));
    await mount();
    expect(screen.getByText("saturated soil")).toBeTruthy();
  });
});

describe("recording one", () => {
  it("saves the three parts separately", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record a decision"));
    fireEvent.change(screen.getByLabelText("What you saw"), { target: { value: "Pugging in the low corner" } });
    fireEvent.change(screen.getByLabelText("What that meant"), { target: { value: "Too wet to carry on" } });
    fireEvent.change(screen.getByLabelText("What you did"), { target: { value: "Moved them early" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0][1]).toMatchObject({
      observation: "Pugging in the low corner",
      triggerDescription: "Too wet to carry on",
      decision: "Moved them early",
    });
  });

  it("will not save without the act — that is the entry", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record a decision"));
    fireEvent.change(screen.getByLabelText("What you saw"), { target: { value: "Something" } });
    fireEvent.click(screen.getByText("Record it"));
    expect(saved).not.toHaveBeenCalled();
  });

  it("lets a decision stand against no trigger at all", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record a decision"));
    fireEvent.change(screen.getByLabelText("What you did"), { target: { value: "Skipped Paddock 4" } });
    fireEvent.click(screen.getByText("Record it"));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0][1].contingencyPlanId).toBeNull();
  });

  it("records against no plan rather than refusing when none is in force", async () => {
    decisions.push(decision());
    await mount();
    expect(screen.getByText(/They stay on record either way/)).toBeTruthy();
  });
});
