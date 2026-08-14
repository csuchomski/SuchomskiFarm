// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  ContingencyPlan,
  ForageAvailability,
  ForageDemand,
  ForageRemoval,
  GrazingEvent,
  GrazingPlan,
  KeyArea,
  ManagementDecision,
  MonitoringRecord,
  Paddock,
  PlanPaddockTarget,
  PlanResourceConcern,
} from "../lib/grazing";
import { drawnSliceAcres } from "../lib/grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "../lib/__fixtures__/farm-geometry";

/**
 * Herd → Annual record.
 *
 * Two rules under test. The sections follow the standard's own order, and a
 * section with nothing in it says "not recorded" rather than disappearing —
 * because a reader must be able to tell "the farm has no contingency plan"
 * from "the app forgot to print one".
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

const paddock = (n: number): Paddock => {
  const name = `Paddock ${n}`;
  return {
    id: `p${n}`, name, code: `P${n}`,
    acresMeasured: REAL_ACRES[name], acresGrazable: REAL_ACRES[name],
    unitType: "permanent",
    sweepHeadingDeg: REAL_SWEEP[name].headingDeg,
    sweepLengthFt: REAL_SWEEP[name].lengthFt, rotationOrder: null,
    seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
    noxiousSpecies: null, noxiousExtent: null,
    sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
    heavyUseNotes: null, boundary: REAL_BOUNDARIES[name], active: true, notes: null,
  };
};

const paddocks = [1, 2, 3, 4, 5].map(paddock);
const events: GrazingEvent[] = [];
const removals: ForageRemoval[] = [];
const availability: ForageAvailability[] = [];
const demand: ForageDemand[] = [];
const targets: PlanPaddockTarget[] = [];
const concerns: PlanResourceConcern[] = [];
const contingencies: ContingencyPlan[] = [];
const areas: KeyArea[] = [];
const records: MonitoringRecord[] = [];
const decisions: ManagementDecision[] = [];
let plan: GrazingPlan | null = null;

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchActivePlan: vi.fn(async () => plan),
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchGrazingGroups: vi.fn(async () => [
      { id: "mob", name: "Main mob", species: "cattle", class: "mixed",
        headCountManual: null, avgWeightLbManual: null, active: true, notes: null },
    ]),
    fetchGrazingEvents: vi.fn(async () => events),
    fetchForageRemovals: vi.fn(async () => removals),
    fetchForageAvailability: vi.fn(async () => availability),
    fetchForageDemand: vi.fn(async () => demand),
    fetchKeyAreas: vi.fn(async () => areas),
    fetchMonitoringRecords: vi.fn(async () => records),
    fetchManagementDecisions: vi.fn(async () => decisions),
    fetchInfrastructure: vi.fn(async () => []),
    fetchPlanPaddockTargets: vi.fn(async () => targets),
    fetchResourceConcerns: vi.fn(async () => concerns),
    fetchContingencyPlans: vi.fn(async () => contingencies),
  };
});

const downloaded = vi.fn();
vi.mock("../lib/grazing-export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing-export")>();
  return { ...actual, downloadCsv: downloaded };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  for (const a of [events, removals, availability, demand, targets, concerns, contingencies, areas, records, decisions]) {
    a.length = 0;
  }
  plan = null;
  downloaded.mockClear();
});

/** The export buttons, not the nav links that share their words. */
const exportButton = (label: string) =>
  [...document.querySelectorAll("button.grz-preset")].find((b) => b.textContent === label)!;

const mount = async () => {
  const { default: GrazingRecord } = await import("./GrazingRecord");
  render(<MemoryRouter><GrazingRecord /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

describe("the shape of the document", () => {
  it("follows the standard's section order", async () => {
    await mount();
    const headings = [...document.querySelectorAll(".rec-h2")].map((h) => h.textContent);
    expect(headings).toEqual([
      "1 Goals and objectives",
      "2 Management units and supporting infrastructure",
      "3 Forage availability by unit",
      "4 Forage demand",
      "5 Feed and forage balance by unit",
      "6 Grazing strategy: intensity, timing, duration, frequency",
      "7 Contingency plan for episodic events",
      "8 Monitoring: key areas, protocols and records",
      "9 Adaptive management decisions",
    ]);
  });

  it("keeps an empty section and marks it, rather than dropping it", async () => {
    await mount();
    // A reader has to be able to tell "no contingency plan" from "the app
    // did not print one".
    expect(screen.getByText(/No contingency triggers recorded/)).toBeTruthy();
    expect(screen.getByText(/No monitoring records/)).toBeTruthy();
    expect(screen.getAllByText("not recorded").length).toBeGreaterThan(5);
  });

  it("carries no claim about compliance anywhere", async () => {
    plan = {
      id: "plan", name: "2026 season", periodStart: "2026-04-01", periodEnd: "2026-10-31",
      contractNumber: "12345", tractNumber: "678", fieldIds: null,
      longTermGoals: "Deeper roots", immediateObjectives: "Cover the bare corner",
      benchmarkStockingRateAumPerAcre: null,
      monitoringCadenceKind: "every_n_days", monitoringCadenceValue: 30,
      defaultDmiPctBw: 3, lbDmPerAcreInch: 300, targetResidualHeightIn: null, active: true, notes: null,
    };
    await mount();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/compliant/i);
    expect(text).not.toMatch(/meets 528/i);
    expect(text).toMatch(/the conservationist's determination/);
  });

  it("prints the units with their measured acreage and sweep", async () => {
    await mount();
    expect(screen.getByText("2.26")).toBeTruthy(); // south band
    expect(screen.getAllByText("east to west").length).toBe(2);
    expect(screen.getByText("south to north")).toBeTruthy();
  });

  it("names the contract and tract when the plan carries them", async () => {
    plan = {
      id: "plan", name: "2026 season", periodStart: null, periodEnd: null,
      contractNumber: "12345", tractNumber: "678", fieldIds: null,
      longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
      monitoringCadenceKind: "every_rotation", monitoringCadenceValue: null,
      defaultDmiPctBw: null, lbDmPerAcreInch: 300, targetResidualHeightIn: null, active: true, notes: null,
    };
    await mount();
    expect(screen.getByText(/contract 12345 · tract 678/)).toBeTruthy();
  });

  it("still reports what happened in the field with no plan at all", async () => {
    events.push({
      id: "e1", paddockId: "p3", groupId: "mob",
      enteredAt: "2026-08-01T12:00:00.000Z", exitedAt: "2026-08-05T12:00:00.000Z",
      headCount: 5, avgWeightLb: 1100,
      forageHeightInEntry: null, residualHeightInExit: 4, utilizationPct: null,
      soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
      latitude: null, longitude: null, sweptFrom: 0, sweptTo: 0.5, grazedShape: null,
    });
    await mount();
    expect(screen.getByText(/a record of what happened does not depend on a plan existing/)).toBeTruthy();
    // Once in the units table, once in what-actually-happened.
    expect(screen.getAllByText("Paddock 3").length).toBeGreaterThanOrEqual(2);
  });
});

describe("the CSVs", () => {
  it("exports grazing events with the strip fractions and the acres they came to", async () => {
    events.push({
      id: "e1", paddockId: "p3", groupId: "mob",
      enteredAt: "2026-08-01T12:00:00.000Z", exitedAt: "2026-08-05T12:00:00.000Z",
      headCount: 5, avgWeightLb: 1100,
      forageHeightInEntry: null, residualHeightInExit: 4, utilizationPct: null,
      soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
      latitude: null, longitude: null, sweptFrom: 0, sweptTo: 0.5, grazedShape: null,
    });
    await mount();
    fireEvent.click(screen.getByText("Grazing events"));
    expect(downloaded).toHaveBeenCalledTimes(1);
    const [filename, csv] = downloaded.mock.calls[0] as [string, string];
    expect(filename).toBe("grazing-events-2026-08-13.csv");
    expect(csv).toMatch(/Paddock,Group,Entered/);
    expect(csv).toMatch(/Paddock 3,Main mob/);
    // Measured off the drawn boundary, not half the unit's acreage — so it
    // is checked against the same function the page uses rather than a
    // number copied out of the old arithmetic.
    const acres = drawnSliceAcres(paddocks[2], 0, 0.5)!;
    expect(csv).toContain(acres.toFixed(3));
  });

  it("neutralises a note a spreadsheet would run as a formula", async () => {
    events.push({
      id: "e1", paddockId: "p3", groupId: "mob",
      enteredAt: "2026-08-01T12:00:00.000Z", exitedAt: null,
      headCount: 5, avgWeightLb: 1100,
      forageHeightInEntry: null, residualHeightInExit: null, utilizationPct: null,
      soilMoisture: null, supplementalFeed: false, weatherNotes: null,
      notes: "=HYPERLINK(\"http://x\")",
      latitude: null, longitude: null, sweptFrom: null, sweptTo: null, grazedShape: null,
    });
    await mount();
    fireEvent.click(screen.getByText("Grazing events"));
    const [, csv] = downloaded.mock.calls[0] as [string, string];
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it("puts availability, demand and hay in one forage file", async () => {
    availability.push({
      id: "a1", planId: null, paddockId: "p3",
      periodStart: "2026-06-01", periodEnd: "2026-06-30", periodLabel: "June",
      lbDmPerAcre: 2400, aum: null, speciesMix: "Orchard/clover", qualityNote: null,
      isPlanned: false, basis: "clipping", notes: null,
    });
    removals.push({
      id: "h1", paddockId: "p2", removedOn: "2026-06-15",
      kind: "hay", cuttingNumber: 1, yieldLb: 4200, yieldBasis: "estimated", notes: null,
    });
    await mount();
    fireEvent.click(screen.getByText("Forage records"));
    const [, csv] = downloaded.mock.calls[0] as [string, string];
    expect(csv).toMatch(/availability,Paddock 3/);
    expect(csv).toMatch(/removed \(hay\),Paddock 2/);
  });

  it("writes a header even when there is nothing to export", async () => {
    await mount();
    // "Monitoring" is also a nav entry, so pick the export button itself.
    fireEvent.click(exportButton("Monitoring"));
    const [, csv] = downloaded.mock.calls[0] as [string, string];
    expect(csv).toBe(
      "Key area,Paddock,Observed,Protocol,Residual (in),Ground cover %,Litter %,Bare ground %,Species composition,Key plant vigour,Erosion,Compaction,Observer,Notes",
    );
  });
});
