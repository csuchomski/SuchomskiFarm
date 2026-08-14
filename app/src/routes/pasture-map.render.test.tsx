// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    sweepLengthFt: REAL_SWEEP[name].lengthFt, rotationOrder: null,
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
    fetchGroupMembers: vi.fn(async () => [
      { id: "m1", groupId: "mob", animalId: "a1", joinedOn: null, leftOn: null },
    ]),
    fetchLatestWeights: vi.fn(async () => new Map<string, number>()),
    fetchActivePlan: vi.fn(async () => null),
    fetchPlanPaddockTargets: vi.fn(async () => []),
    fetchForageAvailability: vi.fn(async () => []),
    logMove: moved,
  };
});

const moved = vi.fn(
  async (_farmId: string, draft: import("../lib/grazing").MoveDraft) => {
    void draft;
    return "new-event";
  },
);

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
  moved.mockClear();
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
    expect(text).toContain("2.23 ac"); // the south band
    expect(text).toContain("1.42 ac"); // the east lobe
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
    expect(screen.getByText(/swept east to west · 535 ft along the sweep/)).toBeTruthy();
    expect(screen.getByText(/swept south to north · 416 ft along the sweep/)).toBeTruthy();
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

/**
 * Placing the wire on the map.
 *
 * jsdom has no layout, so the SVG's bounding rect is stubbed to a known box.
 * That is exactly the mapping the component does — viewBox over rect — so the
 * arithmetic under test is the real one.
 */
const stubBox = (w = 720, h = 1000) => {
  const el = svg();
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { w, h };
};

/** The unit paths are the ones with a fill; they are in paddock order. */
const unitPath = (n: number) =>
  [...svg().querySelectorAll("path")].filter(
    (p) => p.getAttribute("fill") !== "none" && p.getAttribute("fill") !== null,
  )[n - 1];

describe("logging a move from the map", () => {
  it("is not offered until there is a mob and something drawn", async () => {
    units = paddocks.map((p) => ({ ...p, boundary: null }));
    items = [];
    await mount();
    expect((screen.getByText("Log a move") as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for the paddock first", async () => {
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    expect(screen.getByText(/Tap the paddock they are going into/)).toBeTruthy();
  });

  it("selects a unit on tap and offers a day's worth to start", async () => {
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    expect(screen.getByText(/Tap or drag across Paddock 3/)).toBeTruthy();
    // No weights on file, so no hours of feed — but the acreage stands.
    expect(document.querySelector(".grz-strip-stats__v")?.textContent).toMatch(/^0\.\d\d$/);
  });

  it("draws the strip about to be opened, and the wire that closes it", async () => {
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    expect(svg().querySelector("path.pm-proposed")).toBeTruthy();
    expect(svg().querySelector("line.pm-wire")).toBeTruthy();
    // A grip, because a line is hard to catch with a thumb.
    expect(svg().querySelector("circle.pm-wire-grip")).toBeTruthy();
  });

  it("puts the wire where the finger goes", async () => {
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    stubBox();

    // Paddock 3 is swept east to west, so a tap near its western edge is
    // most of the way through the sweep.
    fireEvent.pointerDown(unitPath(3), { clientX: 90, clientY: 620 });
    const far = Number(screen.getByText(/→ \d+%/).textContent!.match(/→ (\d+)%/)![1]);
    expect(far).toBeGreaterThan(70);

    // And a tap near the eastern edge is early in it.
    fireEvent.pointerDown(unitPath(3), { clientX: 640, clientY: 620 });
    const near = Number(screen.getByText(/→ \d+%/).textContent!.match(/→ (\d+)%/)![1]);
    expect(near).toBeLessThan(far);
  });

  it("never lets the wire go back over ground already grazed", async () => {
    events.push(strip("s1", "p3", 0, 0.6, "2026-08-10T12:00:00.000Z", null));
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    stubBox();
    // A tap at the eastern end — behind the back fence — is refused, and the
    // wire stays just ahead of where it already is.
    fireEvent.pointerDown(unitPath(3), { clientX: 700, clientY: 620 });
    expect(screen.getByText(/60% → 6[01]%/)).toBeTruthy();
  });

  it("sends the fractions it drew, not the ones a slider guessed", async () => {
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    stubBox();
    fireEvent.pointerDown(unitPath(3), { clientX: 360, clientY: 620 });
    const shown = Number(screen.getByText(/→ \d+%/).textContent!.match(/→ (\d+)%/)![1]);

    fireEvent.click(screen.getByText("Log the move"));
    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const draft = moved.mock.calls[0][1];
    expect(draft.paddockId).toBe("p3");
    expect(draft.sweptFrom).toBe(0);
    expect(Math.round(draft.sweptTo! * 100)).toBe(shown);
  });

  it("switches units when another is tapped", async () => {
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    fireEvent.pointerDown(unitPath(1));
    expect(screen.getByText(/Tap or drag across Paddock 1/)).toBeTruthy();
  });

  it("starts the next strip where the last one ended", async () => {
    events.push(strip("s1", "p3", 0, 0.4, "2026-08-10T12:00:00.000Z", null));
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    expect(screen.getByText(/^40% → /)).toBeTruthy();
  });

  it("says a unit is taken whole when it has no sweep on file", async () => {
    units = paddocks.map((p) => (p.id === "p3" ? { ...p, sweepHeadingDeg: null } : p));
    await mount();
    fireEvent.click(screen.getByText("Log a move"));
    fireEvent.pointerDown(unitPath(3));
    expect(screen.getByText(/taken whole — it has no sweep direction on file/)).toBeTruthy();
    fireEvent.click(screen.getByText("Log the move"));
    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(moved.mock.calls[0][1].sweptFrom).toBeNull();
  });

  it("says a unit with no boundary cannot be moved into from here", async () => {
    units = [...paddocks.slice(0, 4), { ...paddocks[4], boundary: null }];
    await mount();
    expect(screen.getByText(/cannot be moved into from here/)).toBeTruthy();
  });

  it("leaves the map alone when not moving", async () => {
    await mount();
    fireEvent.pointerDown(unitPath(3));
    expect(screen.queryByText(/Tap or drag across/)).toBeNull();
  });
});
