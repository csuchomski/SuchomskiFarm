// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  AvailabilityDraft,
  DemandDraft,
  ForageAvailability,
  ForageDemand,
  ForageRemoval,
  GrazingPlan,
  Paddock,
} from "../lib/grazing";

/** Herd → Forage balance. The rule under test: pounds and AUM never net. */

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

const paddock = (n: number, acres: number): Paddock => ({
  id: `p${n}`, name: `Paddock ${n}`, code: `P${n}`,
  acresMeasured: acres, acresGrazable: acres,
  pastureId: null,
  unitType: "permanent", sweepHeadingDeg: 270, sweepLengthFt: 424, rotationOrder: null,
  seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
  noxiousSpecies: null, noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
});

const paddocks = [paddock(1, 2.003), paddock(3, 1.97)];
const availability: ForageAvailability[] = [];
const demand: ForageDemand[] = [];
const removals: ForageRemoval[] = [];
let plan: GrazingPlan | null = null;

const savedAvailability = vi.fn(async (_f: string, _d: AvailabilityDraft) => "a-new");
const savedDemand = vi.fn(async (_f: string, _d: DemandDraft) => "d-new");

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchForageAvailability: vi.fn(async () => availability),
    fetchForageDemand: vi.fn(async () => demand),
    fetchForageRemovals: vi.fn(async () => removals),
    fetchGrazingGroups: vi.fn(async () => [
      { id: "mob", name: "Main mob", species: "cattle", class: "mixed",
        headCountManual: null, avgWeightLbManual: null, active: true, notes: null },
    ]),
    fetchGroupMembers: vi.fn(async () => [
      { id: "m1", groupId: "mob", animalId: "a1", joinedOn: null, leftOn: null },
      { id: "m2", groupId: "mob", animalId: "a2", joinedOn: null, leftOn: null },
    ]),
    fetchLatestWeights: vi.fn(async () => new Map([["a1", 1100], ["a2", 1100]])),
    fetchActivePlan: vi.fn(async () => plan),
    recordAvailability: savedAvailability,
    recordDemand: savedDemand,
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  availability.length = 0;
  demand.length = 0;
  removals.length = 0;
  plan = null;
  savedAvailability.mockClear();
  savedDemand.mockClear();
});

const mount = async () => {
  const { default: ForageBalance } = await import("./ForageBalance");
  render(<MemoryRouter><ForageBalance /></MemoryRouter>);
  // queryAllBy, not queryBy: pages folded into others bring their own
  // loading state, and queryByText throws when it finds more than one.
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

const june = { periodStart: "2026-06-01", periodEnd: "2026-06-30", periodLabel: "June" };

const supply = (over: Partial<ForageAvailability> = {}): ForageAvailability => ({
  id: "a1", planId: null, paddockId: "p3", ...june,
  lbDmPerAcre: 2400, aum: null, speciesMix: null, qualityNote: null,
  isPlanned: false, basis: "clipping", notes: null, ...over,
});

const eats = (over: Partial<ForageDemand> = {}): ForageDemand => ({
  id: "d1", planId: null, paddockId: "p3", groupId: "mob", kind: "livestock", ...june,
  headCount: 5, animalClass: null, avgWeightLb: 1100, dmiPctBw: 3,
  demandLbDm: null, demandAum: null, notes: null, ...over,
});

describe("the balance", () => {
  it("explains itself when there is nothing yet", async () => {
    await mount();
    expect(screen.getByText(/Nothing balanced yet/)).toBeTruthy();
    expect(screen.getByText(/growth is even through the month/)).toBeTruthy();
  });

  it("strikes a balance and shows the workings", async () => {
    availability.push(supply());
    demand.push(eats());
    await mount();
    expect(screen.getByText("4,728")).toBeTruthy(); // standing
    expect(screen.getByText("4,950")).toBeTruthy(); // eaten
    expect(screen.getByText("-222")).toBeTruthy(); // short
  });

  it("marks a shortfall without calling it an error", async () => {
    availability.push(supply());
    demand.push(eats());
    await mount();
    expect(document.querySelector(".fb-short")?.textContent).toBe("-222");
  });

  it("turns a surplus into days of feed", async () => {
    availability.push(supply({ lbDmPerAcre: 5000 }));
    demand.push(eats());
    await mount();
    // 9,850 standing less 4,950 eaten is 4,900 at 165 lb a day.
    expect(screen.getByText(/30 days' feed/)).toBeTruthy();
  });

  it("subtracts hay cut inside the window", async () => {
    availability.push(supply({ lbDmPerAcre: 5000 }));
    demand.push(eats());
    removals.push({
      id: "h1", paddockId: "p3", removedOn: "2026-06-15",
      kind: "hay", cuttingNumber: 1, yieldLb: 2000, yieldBasis: "weighed", notes: null,
    });
    await mount();
    expect(screen.getByText("2,000")).toBeTruthy();
    expect(screen.getByText("+2,900")).toBeTruthy();
  });

  it("refuses to net pounds against AUM and says whose call it is", async () => {
    availability.push(supply({ lbDmPerAcre: null, aum: 6 }));
    demand.push(eats());
    await mount();
    expect(screen.getByText(/yours to make, not this app's/)).toBeTruthy();
  });

  it("nets AUM against AUM quite happily", async () => {
    availability.push(supply({ lbDmPerAcre: null, aum: 6 }));
    demand.push(eats({ headCount: null, avgWeightLb: null, demandAum: 4 }));
    await mount();
    expect(screen.getByText("+2.0 AUM")).toBeTruthy();
  });

  it("names a missing side rather than balancing against nothing", async () => {
    availability.push(supply());
    await mount();
    expect(screen.getByText(/Nothing recorded about what is eating it/)).toBeTruthy();
  });

  it("marks a projection as one", async () => {
    availability.push(supply({ isPlanned: true }));
    await mount();
    expect(screen.getByText("projected")).toBeTruthy();
  });

  it("keeps a whole-farm wildlife row on its own line", async () => {
    availability.push(supply());
    demand.push(eats({ id: "d9", paddockId: null, kind: "wildlife", headCount: null, avgWeightLb: null, demandLbDm: 400 }));
    await mount();
    expect(screen.getByText("The whole farm")).toBeTruthy();
  });
});

describe("recording what is standing", () => {
  it("saves a per-acre figure against a unit and window", async () => {
    await mount();
    fireEvent.click(screen.getByText("What's standing"));
    fireEvent.change(screen.getByLabelText("Which paddock"), { target: { value: "p3" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    fireEvent.change(screen.getByLabelText("Call it"), { target: { value: "June" } });
    fireEvent.change(screen.getByLabelText("lb DM per acre"), { target: { value: "2400" } });
    fireEvent.change(screen.getByLabelText("How it was got"), { target: { value: "clipping" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(savedAvailability).toHaveBeenCalledTimes(1));
    expect(savedAvailability.mock.calls[0][1]).toMatchObject({
      paddockId: "p3", periodStart: "2026-06-01", periodEnd: "2026-06-30",
      periodLabel: "June", lbDmPerAcre: 2400, basis: "clipping", isPlanned: false,
    });
  });

  it("asks outright whether a figure is a projection", async () => {
    await mount();
    fireEvent.click(screen.getByText("What's standing"));
    fireEvent.change(screen.getByLabelText("Which paddock"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    fireEvent.click(screen.getByLabelText("This is a projection"));
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(savedAvailability).toHaveBeenCalledTimes(1));
    expect(savedAvailability.mock.calls[0][1].isPlanned).toBe(true);
  });

  it("will not save supply without a paddock — it is a per-acre figure", async () => {
    await mount();
    fireEvent.click(screen.getByText("What's standing"));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    fireEvent.click(screen.getByText("Record it"));
    expect(savedAvailability).not.toHaveBeenCalled();
  });

  it("will not save a window that runs backwards", async () => {
    await mount();
    fireEvent.click(screen.getByText("What's standing"));
    fireEvent.change(screen.getByLabelText("Which paddock"), { target: { value: "p3" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-30" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByText("Record it"));
    expect(savedAvailability).not.toHaveBeenCalled();
  });
});

describe("recording what is eating it", () => {
  it("prefills head and weight from the animal records", async () => {
    await mount();
    fireEvent.click(screen.getByText("What's eating it"));
    expect((screen.getByLabelText("Head") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Avg weight, lb") as HTMLInputElement).value).toBe("1100");
  });

  it("drops head and weight for wildlife, which nobody counts and weighs", async () => {
    await mount();
    fireEvent.click(screen.getByText("What's eating it"));
    fireEvent.change(screen.getByLabelText("What is eating"), { target: { value: "wildlife" } });
    expect(screen.queryByLabelText("Head")).toBeNull();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    fireEvent.change(screen.getByLabelText("Demand, lb DM"), { target: { value: "400" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(savedDemand).toHaveBeenCalledTimes(1));
    expect(savedDemand.mock.calls[0][1]).toMatchObject({
      kind: "wildlife", paddockId: null, headCount: null, avgWeightLb: null, demandLbDm: 400,
    });
  });

  it("offers the windows already on file, so a new row actually nets", async () => {
    availability.push(supply());
    await mount();
    fireEvent.click(screen.getByText("What's eating it"));
    fireEvent.click(screen.getByText("June"));
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-06-01");
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-06-30");
  });

  it("says a plan would carry the intake rate when there is none", async () => {
    await mount();
    expect(screen.getByText(/A plan can hold one default for the farm/)).toBeTruthy();
  });
});
