// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ForageRemoval, GrazingEvent, Infrastructure, Paddock } from "../lib/grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_FENCES, REAL_SWEEP } from "../lib/__fixtures__/farm-geometry";

/**
 * Herd → Pasture map, drawn from the farm's own geometry.
 *
 * The fixture is the real thing out of migration 040 rather than a made-up
 * rectangle, so what these assert is what will be on screen.
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
    id: `p${n}`,
    name,
    code: `P${n}`,
    acresMeasured: REAL_ACRES[name],
    acresGrazable: REAL_ACRES[name],
    unitType: "permanent",
    sweepHeadingDeg: REAL_SWEEP[name].headingDeg,
    sweepLengthFt: REAL_SWEEP[name].lengthFt,
    seedingDate: null,
    fenceType: null,
    ecologicalSite: null,
    soilMapUnit: null,
    noxiousSpecies: null,
    noxiousExtent: null,
    sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
    heavyUseNotes: null,
    boundary: REAL_BOUNDARIES[name],
    active: true,
    notes: null,
  };
};

const fence = (f: (typeof REAL_FENCES)[number], i: number): Infrastructure => ({
  id: `f${i}`,
  paddockId: null,
  kind: "permanent_fence",
  name: f.name,
  geometry: f.geometry,
  status: f.status as Infrastructure["status"],
  installDate: null,
  condition: null,
  nrcsPracticeCode: "382",
  active: true,
  notes: null,
});

const strip = (
  id: string,
  paddockId: string,
  from: number | null,
  to: number | null,
  entered: string,
  exited: string | null,
): GrazingEvent => ({
  id, paddockId, groupId: "mob",
  enteredAt: entered, exitedAt: exited,
  headCount: 5, avgWeightLb: 1100,
  forageHeightInEntry: null, residualHeightInExit: null, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null,
  sweptFrom: from, sweptTo: to, grazedShape: null,
});

const paddocks = [1, 2, 3, 4, 5].map(paddock);
const infrastructure = REAL_FENCES.map(fence);
const events: GrazingEvent[] = [];
const removals: ForageRemoval[] = [];
let units = paddocks;
let items = infrastructure;

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => units),
    fetchGrazingEvents: vi.fn(async () => events),
    fetchForageRemovals: vi.fn(async () => removals),
    fetchGrazingGroups: vi.fn(async () => [
      { id: "mob", name: "Main mob", species: "cattle", class: "mixed",
        headCountManual: null, avgWeightLbManual: null, active: true, notes: null },
    ]),
    fetchInfrastructure: vi.fn(async () => items),
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
  removals.length = 0;
  units = paddocks;
  items = infrastructure;
});

const mount = async () => {
  const { default: PastureMap } = await import("./PastureMap");
  render(
    <MemoryRouter>
      <PastureMap />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

const svg = () => document.querySelector("svg.pm-svg")!;

describe("the drawing", () => {
  it("draws all five units", async () => {
    await mount();
    // Five unit fills, plus the fence paths which have no fill.
    const filled = [...svg().querySelectorAll("path")].filter(
      (p) => p.getAttribute("fill") !== "none" && p.getAttribute("fill") !== null,
    );
    expect(filled.length).toBe(5);
  });

  it("keeps the farm's proportions rather than squaring it off", async () => {
    await mount();
    const box = svg().getAttribute("viewBox")!.split(" ").map(Number);
    // 607 ft east-west by 841 ft north-south, so the drawing is taller than
    // it is wide. Squashing it into a square would misstate every distance.
    expect(box[3] / box[2]).toBeGreaterThan(1.1);
    expect(box[3] / box[2]).toBeLessThan(1.6);
  });

  it("labels each unit with its code and its real acreage", async () => {
    await mount();
    const text = svg().textContent ?? "";
    for (const code of ["P1", "P2", "P3", "P4", "P5"]) expect(text).toContain(code);
    // 2.255 stored; toFixed gives 2.25 because 2.255 has no exact binary
    // form. Half a hundredth of an acre, and not worth a rounding shim.
    expect(text).toContain("2.25 ac"); // the south band
    expect(text).toContain("1.38 ac"); // the east lobe
  });

  it("carries a scale bar, or it is a picture rather than a map", async () => {
    await mount();
    expect(svg().textContent).toMatch(/\d+ ft/);
  });

  it("tells a planned fence from an existing one", async () => {
    await mount();
    const paths = [...svg().querySelectorAll("path")];
    const dashed = paths.filter((p) => p.getAttribute("stroke-dasharray") !== null);
    const solid = paths.filter(
      (p) => p.getAttribute("fill") === "none" && p.getAttribute("stroke-dasharray") === null,
    );
    // Four interior fences are planned; the perimeter is there.
    expect(dashed.length).toBe(4);
    expect(solid.length).toBe(1);
  });
});

describe("the strip, drawn from fractions alone", () => {
  it("shades the ground taken this pass", async () => {
    // Half way across Paddock 3, recorded with no coordinates whatsoever.
    events.push(strip("s1", "p3", 0, 0.5, "2026-08-10T12:00:00.000Z", "2026-08-12T12:00:00.000Z"));
    await mount();
    const taken = [...svg().querySelectorAll("path")].filter(
      (p) => p.getAttribute("fill-opacity") === "0.5",
    );
    expect(taken.length).toBe(1);
  });

  it("draws the open strip with a hard edge — that is where the wire is", async () => {
    events.push(
      strip("s1", "p3", 0, 0.3, "2026-08-10T12:00:00.000Z", "2026-08-12T12:00:00.000Z"),
      strip("s2", "p3", 0.3, 0.45, "2026-08-12T12:00:00.000Z", null),
    );
    await mount();
    const wire = [...svg().querySelectorAll("path")].filter(
      (p) => p.getAttribute("stroke-width") === "1.5" && p.getAttribute("fill") !== "none",
    );
    expect(wire.length).toBe(1);
  });

  it("draws nothing extra for a unit nobody has been in", async () => {
    await mount();
    expect([...svg().querySelectorAll("path")].filter((p) => p.getAttribute("fill-opacity"))).toHaveLength(0);
  });
});

describe("when the geometry is missing or broken", () => {
  it("says which units are not drawn rather than dropping them silently", async () => {
    units = [...paddocks.slice(0, 4), { ...paddocks[4], boundary: null }];
    await mount();
    expect(screen.getByText(/Paddock 5 has no boundary on file/)).toBeTruthy();
  });

  it("loses one paddock to a malformed boundary, not the page", async () => {
    units = [...paddocks.slice(0, 4), { ...paddocks[4], boundary: { type: "Polygon", coordinates: "nope" } }];
    await mount();
    expect(svg()).toBeTruthy();
    const filled = [...svg().querySelectorAll("path")].filter(
      (p) => p.getAttribute("fill") !== "none" && p.getAttribute("fill") !== null,
    );
    expect(filled.length).toBe(4);
  });

  it("explains itself when there is no geometry at all", async () => {
    units = paddocks.map((p) => ({ ...p, boundary: null }));
    items = [];
    await mount();
    expect(screen.getByText(/Nothing to draw yet/)).toBeTruthy();
  });
});

describe("the lists under the map", () => {
  it("gives each unit its sweep in words and its length", async () => {
    await mount();
    expect(screen.getByText(/swept east to west · 533 ft along the sweep/)).toBeTruthy();
    expect(screen.getByText(/swept south to north · 405 ft along the sweep/)).toBeTruthy();
  });

  it("lists the fences and marks the planned ones", async () => {
    await mount();
    expect(screen.getByText("Perimeter fence")).toBeTruthy();
    expect(screen.getAllByText("planned").length).toBe(4);
  });

  it("says outright when something has no location, rather than implying one", async () => {
    items = [
      ...infrastructure,
      { ...fence(REAL_FENCES[0], 99), id: "w1", kind: "water_source", name: "Water point 1", geometry: null },
    ];
    await mount();
    expect(screen.getByText(/water source · practice 382 · no location on file/)).toBeTruthy();
  });
});
