// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { GrazingEvent, GrazingGroup, Paddock } from "../lib/grazing";
import { allGroups } from "../components/shell/nav";
import appSource from "../App.tsx?raw";

/**
 * Grazing → Records: four pages under one heading.
 *
 * What matters is that the report is what you get without asking, that only
 * the open tab is mounted, and that folding these in did not take away the
 * buttons that were the point of them — the Print button in particular lives
 * in a header this page could easily have hidden.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(), reload: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
  useHasModule: () => true,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const paddock = (n: number): Paddock => ({
  id: `p${n}`, name: `Paddock ${n}`, code: `P${n}`,
  pastureId: null,
  acresMeasured: 2, acresGrazable: 2, unitType: "permanent",
  sweepHeadingDeg: 270, sweepLengthFt: 400, rotationOrder: n,
  seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
  noxiousSpecies: null, noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
});

const mob: GrazingGroup = {
  id: "mob", name: "Main mob", species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null,
};

const events: GrazingEvent[] = [{
  id: "e1", paddockId: "p1", groupId: "mob",
  enteredAt: "2026-08-10T12:00:00.000Z", exitedAt: null,
  headCount: 4, avgWeightLb: 1000, forageHeightInEntry: 9, residualHeightInExit: null,
  utilizationPct: null, soilMoisture: null, supplementalFeed: false, weatherNotes: null,
  notes: null, latitude: null, longitude: null, sweptFrom: 0, sweptTo: 0.2, grazedShape: null,
}];

const fetchPaddocks = vi.fn(async () => [1, 2].map(paddock));
const fetchGrazingEvents = vi.fn(async () => events);
const fetchGrazingGroups = vi.fn(async () => [mob]);
const fetchForageRemovals = vi.fn(async () => []);

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks, fetchGrazingEvents, fetchGrazingGroups, fetchForageRemovals,
    // Mocked so the Paddocks tab does not fall through to the live client and
    // sit in "Loading…" for as long as that takes to give up.
    fetchPastures: vi.fn(async () => []),
    fetchForageAvailability: vi.fn(async () => []),
    fetchGroupMembers: vi.fn(async () => []),
    fetchLatestWeights: vi.fn(async () => new Map()),
    fetchActivePlan: vi.fn(async () => null),
    fetchPlanPaddockTargets: vi.fn(async () => []),
    fetchInfrastructure: vi.fn(async () => []),
    fetchWeighings: vi.fn(async () => []),
  };
});

beforeEach(() => {
  [fetchPaddocks, fetchGrazingEvents, fetchGrazingGroups, fetchForageRemovals].forEach((f) => f.mockClear());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const mount = async (entry = "/") => {
  const { default: GrazingRecords } = await import("./GrazingRecords");
  render(<MemoryRouter initialEntries={[entry]}><GrazingRecords /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

const tabs = () => [...document.querySelectorAll(".gr-tab")].map((t) => t.textContent);
const openTab = (name: string) =>
  fireEvent.click([...document.querySelectorAll(".gr-tab")].find((t) => t.textContent === name)!);

describe("four pages under one heading", () => {
  it("offers the four, and opens on the report without being asked", async () => {
    await mount();
    expect(tabs()).toEqual(["Report", "Rounds", "Paddocks", "Mobs"]);
    expect(document.querySelector(".gr-tab--on")!.textContent).toBe("Report");
    expect(screen.getByText("Grazing Records")).toBeTruthy();
  });

  it("keeps the Print button, which lives in a header this page nearly hid", async () => {
    // The folded page's header becomes a section heading, and hiding it as a
    // duplicate of the tab would take its actions with it.
    await mount();
    expect(screen.getByRole("button", { name: "Print" })).toBeTruthy();
  });

  it("mounts only the open tab, so opening the page does not fetch four pages' worth", async () => {
    await mount();
    const onReport = fetchGrazingEvents.mock.calls.length;
    expect(onReport).toBeGreaterThan(0);
    // Rotation is not mounted, so its cutting form is nowhere.
    expect(screen.queryByText("Record hay")).toBeNull();
  });

  it("opens the tab named in the address, so a link can point at one", async () => {
    await mount("/?tab=paddocks");
    expect(document.querySelector(".gr-tab--on")!.textContent).toBe("Paddocks");
  });

  it("falls back to the report when the address names nothing it has", async () => {
    await mount("/?tab=weather");
    expect(document.querySelector(".gr-tab--on")!.textContent).toBe("Report");
  });

  it("swaps what is mounted when a tab is opened", async () => {
    await mount();
    openTab("Rounds");
    await waitFor(() => expect(screen.getByText("Record hay")).toBeTruthy());
    // and the report is gone rather than merely hidden
    expect(screen.queryByRole("button", { name: "Print" })).toBeNull();
  });
});

describe("the rail", () => {
  const grazing = allGroups.find((g) => g.heading === "Grazing")!;

  it("is down to the day's work and the record it leaves", async () => {
    expect(grazing.items.map((i) => i.label)).toEqual(["Move", "Grazing records"]);
  });

  it("no longer lists Plan or Record", async () => {
    const labels = grazing.items.map((i) => i.label);
    expect(labels).not.toContain("Plan");
    expect(labels).not.toContain("Record");
  });

  it("still routes them, because hidden is not deleted", async () => {
    // Read rather than rendered: mounting the whole router to prove a route
    // exists drags in every page. The routes are declared in one file, and
    // the thing worth guarding is that a bookmark to either still resolves.
    const src = appSource;
    expect(src).toContain('path="/grazing/plan"');
    expect(src).toContain('path="/grazing/record"');
    expect(src).toContain('path="/grazing/records"');
  });
});
