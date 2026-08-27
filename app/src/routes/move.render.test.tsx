// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  ForageAvailability,
  ForageRemoval,
  GrazingEvent,
  GrazingPlan,
  MoveDraft,
  Paddock,
  PlanPaddockTarget,
  RemovalDraft,
} from "../lib/grazing";
import { REAL_ACRES, REAL_BOUNDARIES, REAL_SWEEP } from "../lib/__fixtures__/farm-geometry";

/**
 * Herd → Move: the morning, on one page.
 *
 * What is under test is mostly what the page does *not* ask: it knows where
 * they are, where the back line is, and which unit comes next.
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

const unit = (n: number): Paddock => {
  const name = `Paddock ${n}`;
  return {
    id: `p${n}`, name, code: `P${n}`,
    acresMeasured: REAL_ACRES[name], acresGrazable: REAL_ACRES[name],
    pastureId: null,
    unitType: "permanent",
    sweepHeadingDeg: REAL_SWEEP[name].headingDeg,
    sweepLengthFt: REAL_SWEEP[name].lengthFt,
    rotationOrder: n,
    seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
    noxiousSpecies: null, noxiousExtent: null,
    sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
    heavyUseNotes: null, boundary: REAL_BOUNDARIES[name], active: true, notes: null,
  };
};

const strip = (
  id: string, paddockId: string, from: number | null, to: number | null, exited: string | null,
): GrazingEvent => ({
  id, paddockId, groupId: "mob",
  enteredAt: "2026-08-12T12:00:00.000Z", exitedAt: exited,
  headCount: 5, avgWeightLb: 1100,
  forageHeightInEntry: null, residualHeightInExit: null, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null,
  sweptFrom: from, sweptTo: to, grazedShape: null,
});

const mob = (id: string, name: string, active = true) => ({
  id, name, species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active, notes: null,
});

const pasture = (id: string, name: string) => ({
  id, name, code: id.toUpperCase(), acres: null, notes: null, active: true, propertyId: null, boundary: null,
});

let groups = [mob("mob", "Main mob")];
let pastures: ReturnType<typeof pasture>[] = [];
let paddocks = [1, 2, 3, 4, 5].map(unit);
const events: GrazingEvent[] = [];
const removals: ForageRemoval[] = [];
const availability: ForageAvailability[] = [];
const targets: PlanPaddockTarget[] = [];
const weights = new Map<string, number>();
let plan: GrazingPlan | null = null;

const moved = vi.fn(async (_f: string, _d: MoveDraft) => "e-new");
const cut = vi.fn(async (_f: string, _d: RemovalDraft) => "h-new");

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchPastures: vi.fn(async () => pastures),
    fetchGrazingEvents: vi.fn(async () => events),
    fetchForageRemovals: vi.fn(async () => removals),
    fetchForageAvailability: vi.fn(async () => availability),
    fetchGrazingGroups: vi.fn(async () => groups),
    fetchGroupMembers: vi.fn(async () => [1, 2, 3, 4, 5].map((n) => ({
      id: `m${n}`, groupId: "mob", animalId: `a${n}`, joinedOn: null, leftOn: null,
      animalStatus: "active",
    }))),
    fetchLatestWeights: vi.fn(async () => weights),
    fetchActivePlan: vi.fn(async () => plan),
    fetchPlanPaddockTargets: vi.fn(async () => targets),
    logMove: moved,
    recordRemoval: cut,
  };
});

const withPlan = (over: Partial<GrazingPlan> = {}): GrazingPlan => ({
  id: "plan", name: "2026", periodStart: null, periodEnd: null,
  contractNumber: null, tractNumber: null, fieldIds: null,
  longTermGoals: null, immediateObjectives: null, benchmarkStockingRateAumPerAcre: null,
  monitoringCadenceKind: "every_rotation", monitoringCadenceValue: null,
  defaultDmiPctBw: 3, lbDmPerAcreInch: 300, targetResidualHeightIn: null,
  defaultUtilizationPct: null, tramplingLossPct: null, fouledAreaPct: null, active: true, notes: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  groups = [mob("mob", "Main mob")];
  pastures = [];
  paddocks = [1, 2, 3, 4, 5].map(unit);
  events.length = 0;
  removals.length = 0;
  availability.length = 0;
  targets.length = 0;
  weights.clear();
  plan = null;
  moved.mockClear();
  cut.mockClear();
  // The width unit is deliberately remembered between visits, and jsdom keeps
  // one localStorage for the whole file — so without this the first test that
  // picks yards silently puts every later test in yards. That is not
  // hypothetical: it made "leaves the wire alone" measure 270ft while calling
  // it 90, and pass, because the round trip works in either unit.
  localStorage.clear();
});

const mount = async () => {
  const { default: Move } = await import("./Move");
  render(<MemoryRouter><Move /></MemoryRouter>);
  // queryAllBy, not queryBy: pages folded into others bring their own
  // loading state, and queryByText throws when it finds more than one.
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

const svg = () => document.querySelector("svg.pm-svg")!;

const stubBox = (w = 720, h = 1000) => {
  svg().getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
};

const unitPath = (n: number) =>
  [...svg().querySelectorAll("path")].filter((p) => p.getAttribute("fill") !== null)[n - 1];

/** The paddock buttons under the panel, not the labels drawn on the map. */
const onward = (label: string) =>
  [...document.querySelectorAll("button.grz-preset")].find((b) => b.textContent === label)!;

/**
 * "Elsewhere" — the ranked list of where else they could go.
 *
 * Opening it is idempotent: the toggle only matches while it is shut, so a
 * test that picks twice does not close the list on the second pick.
 */
const openElsewhere = () => {
  const toggle = [...document.querySelectorAll("button.grz-preset")].find(
    (b) => b.textContent === "Elsewhere…",
  );
  if (toggle) fireEvent.click(toggle);
};

const nameOf = (row: Element) => row.querySelector(".mv-cand__name")!.textContent!.trim();

/** Every paddock the list offers, in the order it offers them. */
const candidates = () => {
  openElsewhere();
  return [...document.querySelectorAll("button.mv-cand")].map(nameOf);
};

/** The row for a paddock, whatever it says after the name. */
const candidate = (name: string) => {
  openElsewhere();
  return [...document.querySelectorAll("button.mv-cand")].find((b) => nameOf(b).startsWith(name))!;
};

const goElsewhere = (name: string) => fireEvent.click(candidate(name));

const wirePct = () => {
  const m = screen.getByText(/% → \d+%/).textContent!.match(/(\d+)% → (\d+)%/)!;
  return { back: Number(m[1]), wire: Number(m[2]) };
};

/** Five head, mixed sizes — 5,000 lb of mob. */
const weighEveryone = () => {
  weights.set("a1", 1200); weights.set("a2", 1100);
  weights.set("a3", 950); weights.set("a4", 1050); weights.set("a5", 700);
};

describe("what it already knows", () => {
  it("opens on the paddock they are in, without asking", async () => {
    events.push(strip("s1", "p3", 0.2, 0.35, null));
    await mount();
    expect(screen.getByText(/is in/).textContent).toMatch(/Main mob is in Paddock 3/);
    expect(screen.getByText(/Drag the wire/)).toBeTruthy();
  });

  it("puts the back line at yesterday's wire", async () => {
    events.push(strip("s1", "p3", 0.2, 0.35, null));
    await mount();
    expect(wirePct().back).toBe(35);
  });

  it("opens the wire away from the back line, so there is something to grab", async () => {
    events.push(strip("s1", "p3", 0.2, 0.35, null));
    weighEveryone();
    await mount();
    const { back, wire } = wirePct();
    expect(wire).toBeGreaterThan(back);
  });

  it("draws the back line as its own line, not just an edge", async () => {
    events.push(strip("s1", "p3", 0.2, 0.35, null));
    await mount();
    expect(svg().querySelector("line.mv-backline")).toBeTruthy();
    expect(svg().querySelector("line.pm-wire")).toBeTruthy();
  });

  it("offers the next unit in the round by name", async () => {
    events.push(strip("s1", "p3", 0.2, 0.35, null));
    await mount();
    expect(screen.getByText("On to Paddock 4")).toBeTruthy();
  });

  it("says they are off pasture and asks where they go", async () => {
    await mount();
    expect(screen.getByText(/is not on pasture/)).toBeTruthy();
    expect(screen.getByText(/Tap the paddock they are going into/)).toBeTruthy();
  });

  it("totals the mob's real weights in the header", async () => {
    weighEveryone();
    await mount();
    expect(screen.getByText(/5,000 lb on grass/)).toBeTruthy();
  });

  it("leaves an animal that has left the farm out of the head count", async () => {
    // Victor, 2026-08-23: processed, and still holding an open membership, so
    // this page counted six head and sized the strip to feed him.
    const g = await import("../lib/grazing");
    vi.mocked(g.fetchGroupMembers).mockResolvedValueOnce(
      [1, 2, 3, 4, 5].map((n) => ({
        id: `m${n}`, groupId: "mob", animalId: `a${n}`, joinedOn: null, leftOn: null,
        animalStatus: n === 5 ? "processed" : "active",
      })),
    );
    weighEveryone();
    await mount();
    // 5,000 lb between the five; a5 weighs 700 and is not on the farm.
    expect(screen.getByText(/4,300 lb on grass/)).toBeTruthy();
    expect(screen.queryByText(/5,000 lb on grass/)).toBeNull();
  });

  it("says how many are unweighed rather than quietly totalling some", async () => {
    weights.set("a1", 1200);
    weights.set("a2", 1100);
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    // Interpolated, so the text is split across nodes — read the whole box.
    expect(document.querySelector(".grz-warn")?.textContent).toMatch(
      /3 of 5 in the mob have no weight on file/,
    );
  });
});

describe("grass height drives the figures", () => {
  it("says what a reading is worth, at the plan's own figure", async () => {
    plan = withPlan();
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });
    expect(screen.getByText(/2,400 lb DM\/acre standing — 8″ × 300 lb, your figures/)).toBeTruthy();
  });

  it("feeds the readout, and names itself as the source", async () => {
    plan = withPlan();
    weighEveryone();
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "6" } });
    expect(screen.getByText(/from this morning's height/)).toBeTruthy();
    // Once under the height field, once in the assumptions line.
    expect(screen.getAllByText(/1,800 lb DM\/acre standing/).length).toBe(2);
  });

  it("sends the reading with the move", async () => {
    plan = withPlan();
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "7.5" } });
    fireEvent.click(screen.getByText("Log the move"));
    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(moved.mock.calls[0][1].forageHeightInEntry).toBe(7.5);
  });

  it("points at the plan when there is no figure to convert with", async () => {
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    expect(screen.getByText(/pounds per acre-inch/)).toBeTruthy();
  });
});

describe("the wire", () => {
  it("says days of feed, which is the word used to decide", async () => {
    plan = withPlan();
    weighEveryone();
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    expect(screen.getByText("Days of feed")).toBeTruthy();
  });

  it("moves to where the finger goes and never behind the back line", async () => {
    events.push(strip("s1", "p3", 0, 0.5, null));
    await mount();
    stubBox();
    // Paddock 3 is swept east to west, so tapping at its eastern edge is
    // behind the mob. It should hold just ahead of them instead.
    fireEvent.pointerDown(unitPath(3), { clientX: 700, clientY: 620 });
    expect(wirePct().wire).toBeGreaterThanOrEqual(50);
  });

  it("logs the fractions it drew", async () => {
    events.push(strip("s1", "p3", 0, 0.3, null));
    await mount();
    stubBox();
    fireEvent.pointerDown(unitPath(3), { clientX: 300, clientY: 620 });
    const shown = wirePct();
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const d = moved.mock.calls[0][1];
    expect(d.paddockId).toBe("p3");
    expect(Math.round(d.sweptFrom! * 100)).toBe(shown.back);
    expect(Math.round(d.sweptTo! * 100)).toBe(shown.wire);
  });
});

describe("moving on, and skipping", () => {
  it("puts the back line at the start of the unit they move into", async () => {
    events.push(strip("s1", "p3", 0, 0.9, null));
    await mount();
    fireEvent.click(screen.getByText("On to Paddock 4"));
    expect(wirePct().back).toBe(0);
    expect(screen.getByText(/moving on to/)).toBeTruthy();
  });

  it("skips a whole paddock by going to the one after it", async () => {
    // Paddock 4 is shut up for hay, so they go from 3 to 5.
    events.push(strip("s1", "p3", 0, 0.9, null));
    await mount();
    goElsewhere("Paddock 5");
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(moved.mock.calls[0][1].paddockId).toBe("p5");
    expect(moved.mock.calls[0][1].sweptFrom).toBe(0);
  });

  it("lets the back line be moved, which is how a section is skipped", async () => {
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    stubBox();
    fireEvent.click(screen.getByText("Move the back line"));
    expect(screen.getByText(/that is how a section, or a paddock cut for hay, gets skipped/)).toBeTruthy();

    // Tap well down the sweep: the back line jumps forward, leaving the
    // ground between behind.
    fireEvent.pointerDown(unitPath(3), { clientX: 250, clientY: 620 });
    expect(wirePct().back).toBeGreaterThan(20);
  });

  it("sends the moved back line as swept_from", async () => {
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    stubBox();
    fireEvent.click(screen.getByText("Move the back line"));
    fireEvent.pointerDown(unitPath(3), { clientX: 250, clientY: 620 });
    const back = wirePct().back;
    fireEvent.click(screen.getByText("Done with the back line"));
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(Math.round(moved.mock.calls[0][1].sweptFrom! * 100)).toBe(back);
  });

  it("offers a way back to where they actually are", async () => {
    events.push(strip("s1", "p3", 0, 0.5, null));
    await mount();
    fireEvent.click(screen.getByText("On to Paddock 4"));
    fireEvent.click(screen.getByText("Stay in Paddock 3"));
    expect(wirePct().back).toBe(50);
  });
});

describe("hay, from the same page", () => {
  it("records a cutting off the unit in front of you", async () => {
    events.push(strip("s1", "p3", 0, 0.5, null));
    await mount();
    fireEvent.click(screen.getByText("Cut for hay"));
    fireEvent.change(screen.getByLabelText("Cut on"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("Yield, lb"), { target: { value: "4200" } });
    fireEvent.click(screen.getByText("Record the cutting"));

    await waitFor(() => expect(cut).toHaveBeenCalledTimes(1));
    expect(cut.mock.calls[0][1]).toMatchObject({
      paddockId: "p3", removedOn: "2026-08-10", kind: "hay", yieldLb: 4200,
    });
    await screen.findByText(/rest now counts from Aug 10, 2026/);
  });

  it("says what recording it does to the rest clock", async () => {
    events.push(strip("s1", "p3", 0, 0.5, null));
    await mount();
    fireEvent.click(screen.getByText("Cut for hay"));
    expect(screen.getByText(/starts its rest from the day it was cut/)).toBeTruthy();
  });
});

describe("the drawing that does not fill its box", () => {
  /**
   * The map is capped in height now — the farm is a tall shape and a
   * full-height drawing pushed the acres off the bottom of the screen — so it
   * is letterboxed inside the figure. A touch has to have the gutters taken
   * off it before it means anything. Nothing looks wrong when this is missed;
   * the wire simply lands somewhere other than the finger.
   */
  const tapAt = (clientX: number) => {
    fireEvent.pointerDown(unitPath(3), { clientX, clientY: 500 });
    return wirePct().wire;
  };

  it("puts the same touch on the same ground however the box is shaped", async () => {
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();

    // The centre of the box is the centre of the drawing under xMidYMid,
    // whatever is left over — so the wire must not move when only the
    // letterbox does.
    stubBox(720, 1000);
    const square = tapAt(360);
    stubBox(1400, 1000);
    const wide = tapAt(700);
    stubBox(400, 1600);
    const tall = tapAt(200);

    expect(wide).toBe(square);
    expect(tall).toBe(square);
  });

  it("does not stretch the ground when the box gets wider than the drawing", async () => {
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();

    // The farm is taller than it is wide, so height is what the drawing is
    // fitted to and extra box width is gutter, not more map. A hundred pixels
    // of finger is therefore the same distance across the paddock at both
    // widths. Dividing by the box width — which is what a plain ratio does —
    // halves it here.
    // Signed west, since Paddock 3 sweeps east to west — what matters is that
    // the same finger covers the same ground, not which way it runs.
    const span = (w: number) => {
      stubBox(w, 1000);
      return Math.abs(tapAt(w / 2) - tapAt(w / 2 - 100));
    };
    expect(span(1400)).toBe(span(720));
    expect(span(720)).toBeGreaterThan(0);
  });
});

describe("the graze-down, on the page", () => {
  /**
   * Two heights, and the figures come off the difference. What matters here is
   * that the page shows the number it is actually using and records it —
   * a forecast built on an assumption the farmer cannot see is worse than no
   * forecast.
   */
  const inP3 = () => events.push(strip("s1", "p3", 0, 0.2, null));

  it("asks what to graze it down to, beside the height it comes off", async () => {
    inP3();
    await mount();
    expect(screen.getByLabelText("Grass height, inches")).toBeTruthy();
    expect(screen.getByLabelText("Graze it down to, inches")).toBeTruthy();
  });

  it("shows the paddock's own target as the figure standing in", async () => {
    inP3();
    plan = withPlan({ targetResidualHeightIn: 5 });
    targets.push({
      id: "t", planId: "plan", paddockId: "p3",
      targetEntryHeightIn: null, targetResidualHeightIn: 3,
      minRecoveryDaysGrowing: null, minRecoveryDaysDormant: null,
      targetUtilizationPct: null, plannedGrazingNotes: null, plannedDefermentNotes: null,
      sensitiveAreaStrategy: null, notes: null,
    });
    await mount();
    expect(
      (screen.getByLabelText("Graze it down to, inches") as HTMLInputElement).placeholder,
    ).toBe("3");
  });

  it("works the feed out from the two heights and says so", async () => {
    inP3();
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: "4" } });

    // 8″ − 4″ = 4″ at 300 lb an acre-inch = 1,200 lb an acre off the plant —
    // but that is what *disappeared*, not what an animal ate. This plan sets
    // no utilization, so the app's 85% stands and 1,020 lb of it is eaten.
    // The page says eaten, because saying "on offer" is what let the
    // difference go unnoticed.
    expect(screen.getByText(/8″ down to 4″/)).toBeTruthy();
    expect(screen.getByText(/1,020 lb DM an acre eaten/)).toBeTruthy();
    expect(screen.getByText(/50% of what is standing comes off/)).toBeTruthy();
    expect(screen.getByText(/85% of that is eaten/)).toBeTruthy();
  });

  it("carries the sources into the working, not just into the prose", async () => {
    // The panel and the paragraph under it must agree about whose figure the
    // utilization is. Passing `assumptions` without `sources` would leave the
    // panel showing a bare 85% that reads like the farm's own.
    inP3();
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "How days of feed is worked out" }));

    const panel = screen.getByRole("note");
    const eaten = [...panel.querySelectorAll(".tip-rows__label")].find((l) =>
      l.textContent!.startsWith("Of that, eaten"),
    )!;
    expect(eaten.textContent).toContain("this app's figure");
  });

  it("names the farm's utilization as the farm's, and its own as its own", async () => {
    // The parenthetical is the only thing separating a figure somebody stood
    // in a paddock and chose from one this app supplied, and the two lead to
    // different wire placements.
    inP3();
    weighEveryone();
    plan = withPlan({ defaultUtilizationPct: 60 });
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: "4" } });

    // 1,200 off the plant, 60% of it eaten = 720.
    expect(screen.getByText(/720 lb DM an acre eaten/)).toBeTruthy();
    expect(screen.getByText(/60% of that is eaten/)).toBeTruthy();
    // Attributed to the plan rather than to the app. The intake figure says
    // the same thing a few words later, so this counts them.
    expect(screen.getAllByText("(from your plan)").length).toBe(2);
    expect(screen.queryByText("(this app's figure)")).toBeNull();
  });

  it("narrows the strip when they are to graze it harder", async () => {
    inP3();
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });

    // The wire opens at a day's width and follows the assumptions, so taking
    // them further down means less ground for the same day's feed — which is
    // the whole point of setting the graze-down before placing the wire.
    fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: "6" } });
    const soft = wirePct().wire;
    fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: "3" } });
    expect(wirePct().wire).toBeLessThan(soft);
  });

  it("holds the feed at a day while the strip changes size", async () => {
    inP3();
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });

    // 5,000 lb of mob at 3% is 150 lb of dry matter a day, whatever height it
    // is taken off at.
    const eaten = () =>
      Number(document.querySelector(".grz-strip-stats")!.textContent!
        .match(/([\d,]+)lb they'll eat/)![1].replace(/,/g, ""));

    for (const to of ["6", "4", "3"]) {
      fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: to } });
      expect(eaten()).toBe(150);
    }
  });

  it("records the entry height against the strip being opened", async () => {
    inP3();
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const d = moved.mock.calls[0][1];
    expect(d.forageHeightInEntry).toBe(8);
  });

  it("does not file the graze-down it is aiming at as something that happened", async () => {
    // `log_grazing_move` puts residual and utilization on the strip it
    // *closes*, so anything sent here lands on the ground behind the wire.
    // A forecast sent through them would be filed against the wrong strip
    // and called a measurement.
    inP3();
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Graze it down to, inches"), { target: { value: "2" } });
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const d = moved.mock.calls[0][1];
    expect(d.residualHeightInExit).toBeNull();
    expect(d.utilizationPct).toBeNull();
  });
});

describe("what they actually ate it down to", () => {
  const inP3 = () => events.push(strip("s1", "p3", 0, 0.2, null));

  /** The open strip, with a height taken when they went onto it. */
  const wentInAt = (inches: number) => {
    events.push({ ...strip("s1", "p3", 0, 0.2, null), forageHeightInEntry: inches });
  };

  it("asks only when there is a strip behind them to have eaten", async () => {
    await mount();
    expect(screen.queryByLabelText("They ate it down to, inches")).toBeNull();

    cleanup();
    inP3();
    await mount();
    expect(screen.getByLabelText("They ate it down to, inches")).toBeTruthy();
  });

  it("records it against the strip they are leaving", async () => {
    wentInAt(9);
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("They ate it down to, inches"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const d = moved.mock.calls[0][1];
    expect(d.residualHeightInExit).toBe(3);
    // 9″ in, 3″ out — two thirds of the sward, worked out from that strip's
    // own entry height rather than this morning's.
    expect(d.utilizationPct).toBeCloseTo(66.7, 1);
  });

  it("works the share out from the height that strip went in on, not today's", async () => {
    wentInAt(10);
    weighEveryone();
    plan = withPlan();
    await mount();
    // A different height ahead of them must not contaminate the strip behind.
    fireEvent.change(screen.getByLabelText("Grass height, inches"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("They ate it down to, inches"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(moved.mock.calls[0][1].utilizationPct).toBe(50); // 10″ → 5″
  });

  it("keeps the height but not a share when that strip has no entry height", async () => {
    inP3();
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("They ate it down to, inches"), { target: { value: "3" } });
    // Said on the page before it is said in the record.
    expect(screen.getByText(/nothing to work a share of the sward out from/)).toBeTruthy();
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    const d = moved.mock.calls[0][1];
    expect(d.residualHeightInExit).toBe(3);
    expect(d.utilizationPct).toBeNull();
  });

  it("refuses to call it eaten when they left more than they went in on", async () => {
    wentInAt(6);
    weighEveryone();
    plan = withPlan();
    await mount();
    fireEvent.change(screen.getByLabelText("They ate it down to, inches"), { target: { value: "7" } });
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    // The height stands — it is what was seen — but it is not a graze.
    expect(moved.mock.calls[0][1].residualHeightInExit).toBe(7);
    expect(moved.mock.calls[0][1].utilizationPct).toBeNull();
  });

  it("shows its working before anything is logged", async () => {
    wentInAt(8);
    await mount();
    fireEvent.change(screen.getByLabelText("They ate it down to, inches"), { target: { value: "2" } });
    expect(screen.getByText(/75% of the 8″ they went in on/)).toBeTruthy();
    expect(screen.getByText(/recorded against that strip, not this one/)).toBeTruthy();
  });
});

describe("the map, now that it is the only one", () => {
  /**
   * The Pasture map page folded into this one. It brought a scale bar and
   * nothing else: its unit list was already the board's, its infrastructure
   * list is already section 2 of the annual record, and a fence layer would
   * have drawn a second line along every boundary — the farm's interior
   * fences are the lines the units were cut from.
   */
  it("puts a scale on it, so a strip width means something", async () => {
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    expect([...svg().querySelectorAll("text")].some((t) => /\d+ ft$/.test(t.textContent ?? ""))).toBe(true);
  });

  it("draws each boundary once", async () => {
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    // Every filled path is a unit. Nothing is stroked over the top of them.
    const outlines = [...svg().querySelectorAll("path")].filter((p) => p.getAttribute("fill") === "none");
    expect(outlines).toHaveLength(0);
  });
});

describe("the far end of a paddock", () => {
  /**
   * "The rest of it" left two feet behind.
   *
   * The form draws a hair's breadth of strip when the wire sits on the back
   * line, so a freshly-opened form shows something rather than a line of no
   * width. That floor had no ceiling: with the back line at the far fence it
   * pushed the wire *past* it, and offered — and stood ready to record — a
   * strip of ground that is not there. On a 416-foot paddock, half a percent
   * reads as two feet of grass.
   */
  beforeEach(() => {
    events.length = 0;
    // The farm's own record: Paddock 5 taken in five bites, the last one
    // "the rest of it", so the mob is standing at the far end.
    events.push(strip("e1", "p5", 0, 0.165, "2026-08-17T12:37:00.000Z"));
    events.push(strip("e2", "p5", 0.165, 0.32, "2026-08-18T01:23:00.000Z"));
    events.push(strip("e3", "p5", 0.32, 0.49, "2026-08-18T23:42:00.000Z"));
    events.push(strip("e4", "p5", 0.49, 0.706851, "2026-08-20T03:02:00.000Z"));
    events.push(strip("e5", "p5", 0.706851, 1, null));
  });

  it("says the paddock is finished rather than offering two more feet of it", async () => {
    await mount();
    expect(screen.getByText(/grazed to the far end in this pass/)).toBeTruthy();
  });

  it("offers no width of grass at the far fence", async () => {
    // This is the figure the farm saw: the Width tile read 2′, because the
    // wire sat half a percent past the end of a 416-foot paddock.
    //
    // The percentage readout beside it was no help at all — 1.005 × 100 is
    // 100.49999999999999 in binary, so it rounded *down* and displayed a
    // tidy "100% → 100%" over a strip that was not zero. The width is where
    // the phantom shows, so the width is what this checks.
    await mount();
    const widths = [...document.querySelectorAll(".grz-strip-stats__v")].map((n) => n.textContent);
    expect(widths).not.toContain("2′");
  });

  it("offers no width to open, because there is none", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: "The rest of it" })).toBeNull();
    expect(screen.queryByRole("button", { name: "A day" })).toBeNull();
  });

  it("keeps the back line movable, which is how another pass is started", async () => {
    // Hiding this would strand the farmer on the message.
    await mount();
    expect(screen.getByRole("button", { name: "Move the back line" })).toBeTruthy();
  });

  it("will not record a strip of ground that is not there", async () => {
    await mount();
    const log = screen.getByRole("button", { name: "Log the move" });
    expect(log.hasAttribute("disabled")).toBe(true);
    fireEvent.click(log);
    expect(moved).not.toHaveBeenCalled();
  });

  it("still takes the rest of it when there is a rest to take", async () => {
    // The floor is right in the middle of a paddock; only the far end was
    // ever wrong.
    events.length = 0;
    events.push(strip("e1", "p5", 0, 0.7, null));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "The rest of it" }));
    fireEvent.click(screen.getByRole("button", { name: "Log the move" }));
    await waitFor(() => expect(moved).toHaveBeenCalled());
    const draft = moved.mock.calls[0][1];
    expect(draft.sweptFrom).toBeCloseTo(0.7, 6);
    expect(draft.sweptTo).toBe(1);
  });
});

describe("typing the width of the strip", () => {
  /**
   * The wire is dragged with a finger, on a phone held in one hand, standing
   * in a paddock. A finger is worth about ten feet — fine for "about a day's
   * worth" and useless for "the same 60-foot break as yesterday". Some
   * strips are stepped off and known, and those want typing.
   *
   * Paddock 3 runs 425ft end to end and the mob is 20% of the way along it,
   * so the arithmetic below is against a back line at 0.2.
   */
  const inP3 = () => events.push(strip("s1", "p3", 0, 0.2, null));

  /** The Width tile, which is the readout the typed figure has to agree with. */
  const widthShown = () => {
    const tiles = [...document.querySelectorAll(".grz-strip-stats > div")];
    const tile = tiles.find((d) => d.querySelector(".eyebrow")?.textContent === "Width")!;
    return tile.querySelector(".grz-strip-stats__v")!.textContent;
  };

  const box = () => screen.getByLabelText(/^Strip width,/) as HTMLInputElement;

  it("puts the wire exactly where the typed width says", async () => {
    inP3();
    weighEveryone();
    await mount();
    fireEvent.change(box(), { target: { value: "90" } });

    // 90ft of a 425ft sweep, starting at the back line — and the readout
    // beside it has to say 90, not 88. That is the whole point of an exact
    // inverse rather than a search that stops when it is close.
    expect(widthShown()).toBe("90′");
    expect(wirePct().wire).toBe(41); // 20% + 90/425
  });

  it("reads the wire back when it is dragged or set by a preset", async () => {
    inP3();
    weighEveryone();
    await mount();
    fireEvent.change(box(), { target: { value: "90" } });
    expect(box().value).toBe("90");

    // "The rest of it" takes the wire to the far fence; the box has to follow
    // rather than sit on a width nobody is using any more.
    fireEvent.click(onward("The rest of it"));
    expect(wirePct().wire).toBe(100);
    expect(box().value).toBe("340"); // the 80% of 425ft that is left
  });

  it("changes unit without moving the wire", async () => {
    inP3();
    weighEveryone();
    await mount();
    fireEvent.change(box(), { target: { value: "90" } });

    fireEvent.click(screen.getByRole("button", { name: "yd" }));
    // Same strip, said in yards. The wire must not shift under the farmer
    // because they changed how they are reading it.
    expect(widthShown()).toBe("90′");
    expect(box().value).toBe("30");
    expect(screen.getByLabelText("Strip width, yards")).toBeTruthy();
  });

  it("takes yards as yards", async () => {
    inP3();
    weighEveryone();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "yd" }));
    fireEvent.change(box(), { target: { value: "30" } });
    expect(widthShown()).toBe("90′");
  });

  it("leaves the wire alone while a number is still being typed", async () => {
    inP3();
    weighEveryone();
    await mount();
    fireEvent.change(box(), { target: { value: "90" } });
    const at90 = wirePct().wire;

    // Clearing the box on the way to another number must not throw the wire
    // to one end of the paddock.
    fireEvent.change(box(), { target: { value: "" } });
    expect(wirePct().wire).toBe(at90);
    expect(box().value).toBe("");

    // And on blur it goes back to reading the wire rather than staying blank.
    fireEvent.blur(box());
    expect(box().value).toBe("90");
  });

  it("never runs the wire past the far fence", async () => {
    inP3();
    weighEveryone();
    await mount();
    // 900ft of a 425ft paddock, from 20% along.
    fireEvent.change(box(), { target: { value: "900" } });
    expect(wirePct().wire).toBe(100);
  });

  it("says why, rather than offering a box that cannot work", async () => {
    // A paddock can be swept — it has a heading — and still have no sweep
    // length measured. There is then no width to set one by, and a box that
    // silently did nothing would be worse than one that says so.
    paddocks = paddocks.map((p) => (p.id === "p3" ? { ...p, sweepLengthFt: null } : p));
    inP3();
    weighEveryone();
    await mount();
    expect(box().disabled).toBe(true);
    expect(screen.getByText(/has no sweep length on file/)).toBeTruthy();
  });

  it("remembers feet or yards between mornings", async () => {
    // A habit, not a decision: a farm that steps its wire off in yards thinks
    // in yards every morning and should not re-pick it every morning.
    inP3();
    weighEveryone();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "yd" }));
    cleanup();

    await mount();
    expect(screen.getByLabelText("Strip width, yards")).toBeTruthy();
    expect(screen.getByRole("button", { name: "yd" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens in feet when nothing has been picked", async () => {
    // Guards the test above from passing on a leaked choice, and the app from
    // opening in a unit nobody chose.
    inP3();
    weighEveryone();
    await mount();
    expect(screen.getByLabelText("Strip width, feet")).toBeTruthy();
  });

  it("is not on the page while the back line is being moved", async () => {
    // The number would be answering a different question there.
    inP3();
    weighEveryone();
    await mount();
    fireEvent.click(onward("Move the back line"));
    expect(screen.queryByLabelText(/^Strip width,/)).toBeNull();
  });
});

describe("more than one mob", () => {
  /**
   * `groups[0]` left three of Green Pastures' four mobs with no route to this
   * page at all. The switcher is the fix, and the order it comes back in is
   * the point of it.
   */
  const stripFor = (id: string, groupId: string, paddockId: string, entered: string): GrazingEvent => ({
    ...strip(id, paddockId, 0, 0.2, null),
    groupId,
    enteredAt: entered,
  });

  const chip = (name: string) =>
    [...document.querySelectorAll("button.mv-mob")].find((b) => b.textContent?.startsWith(name))!;

  it("shows nothing at all when there is only one mob", async () => {
    // A single-mob farm must not gain a control it has no use for.
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    expect(document.querySelectorAll("button.mv-mob")).toHaveLength(0);
  });

  it("lists every mob, longest-standing first", async () => {
    groups = [mob("a", "Finishers"), mob("b", "Main mob"), mob("c", "Yearlings")];
    events.push(
      stripFor("s1", "a", "p1", "2026-08-13T06:00:00.000Z"), // today
      stripFor("s2", "b", "p2", "2026-08-10T06:00:00.000Z"), // 3 days
      stripFor("s3", "c", "p3", "2026-08-12T06:00:00.000Z"), // 1 day
    );
    await mount();

    const names = [...document.querySelectorAll("button.mv-mob")].map((b) => b.textContent);
    expect(names[0]).toMatch(/^Main mob/);
    expect(names[1]).toMatch(/^Yearlings/);
    expect(names[2]).toMatch(/^Finishers/);
  });

  it("opens on the mob that has stood longest", async () => {
    groups = [mob("a", "Finishers"), mob("b", "Main mob")];
    events.push(
      stripFor("s1", "a", "p1", "2026-08-13T06:00:00.000Z"),
      stripFor("s2", "b", "p2", "2026-08-09T06:00:00.000Z"),
    );
    await mount();
    expect(screen.getByText(/is in/).textContent).toMatch(/Main mob is in Paddock 2/);
    expect(chip("Main mob").getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the whole page to the mob that is tapped", async () => {
    // Three mobs on purpose. The one tapped is neither `groups[0]` nor the
    // roster's default, so this fails both if the switcher does nothing and
    // if the page quietly went back to reading the first of the array.
    groups = [mob("a", "Finishers"), mob("b", "Main mob"), mob("c", "Yearlings")];
    events.push(
      stripFor("s1", "a", "p1", "2026-08-13T06:00:00.000Z"), // today
      stripFor("s2", "b", "p2", "2026-08-09T06:00:00.000Z"), // longest — the default
      stripFor("s3", "c", "p3", "2026-08-12T06:00:00.000Z"), // 1 day
    );
    await mount();
    fireEvent.click(chip("Yearlings"));

    expect(screen.getByText(/is in/).textContent).toMatch(/Yearlings is in Paddock 3/);
    expect(chip("Yearlings").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Main mob").getAttribute("aria-pressed")).toBe("false");
    expect(chip("Finishers").getAttribute("aria-pressed")).toBe("false");
  });

  it("says where each mob is and how long it has been there", async () => {
    groups = [mob("a", "Finishers"), mob("b", "Main mob")];
    events.push(
      stripFor("s1", "a", "p1", "2026-08-13T06:00:00.000Z"),
      stripFor("s2", "b", "p2", "2026-08-10T06:00:00.000Z"),
    );
    await mount();
    expect(chip("Main mob").textContent).toContain("P2 · 3 days in");
    expect(chip("Finishers").textContent).toContain("P1 · in today");
  });

  it("marks a mob with nowhere to be, rather than calling it freshly moved", async () => {
    groups = [mob("a", "Dry cows"), mob("b", "Main mob")];
    events.push(stripFor("s2", "b", "p2", "2026-08-10T06:00:00.000Z"));
    await mount();
    expect(chip("Dry cows").textContent).toContain("not on pasture");
    expect(chip("Dry cows").textContent).not.toContain("in today");
  });

  it("drops the last mob's destination when another is picked", async () => {
    // Everything the form holds belongs to the mob that was selected.
    // Carrying a destination across would place this mob's wire in a paddock
    // chosen for a different one.
    groups = [mob("a", "Finishers"), mob("b", "Main mob")];
    events.push(
      stripFor("s1", "a", "p1", "2026-08-13T06:00:00.000Z"),
      stripFor("s2", "b", "p2", "2026-08-09T06:00:00.000Z"),
    );
    weighEveryone();
    await mount();

    // Send Main mob somewhere other than where it stands.
    goElsewhere("Paddock 4");
    expect(screen.getByText(/is in/).textContent).toMatch(/moving on to Paddock 4/);

    fireEvent.click(chip("Finishers"));
    // Finishers is in P1 and going nowhere — not inheriting P4.
    expect(screen.getByText(/is in/).textContent).toMatch(/Finishers is in Paddock 1/);
    expect(screen.getByText(/is in/).textContent).not.toMatch(/moving on/);
  });

  it("logs the move against the mob that is selected", async () => {
    // The one that would be silently wrong: the right paddock, the wrong mob.
    // Again three, so "c" is neither the array's first nor the default.
    groups = [mob("a", "Finishers"), mob("b", "Main mob"), mob("c", "Yearlings")];
    events.push(
      stripFor("s1", "a", "p1", "2026-08-13T06:00:00.000Z"),
      stripFor("s2", "b", "p2", "2026-08-09T06:00:00.000Z"),
      stripFor("s3", "c", "p3", "2026-08-12T06:00:00.000Z"),
    );
    weighEveryone();
    await mount();
    fireEvent.click(chip("Yearlings"));
    fireEvent.click(screen.getByText("Log the move"));

    await waitFor(() => expect(moved).toHaveBeenCalledTimes(1));
    expect(moved.mock.calls[0][1].groupId).toBe("c");
  });
});

describe("more than one pasture", () => {
  /**
   * Green Pastures is 46 paddocks over 1,579 acres. Drawn as one map that is
   * 46 postage stamps, and offered as one picker it is 46 buttons. Scoping to
   * a pasture is what makes both usable — without breaking the farms that
   * have only one.
   */
  const inPastures = () => {
    pastures = [pasture("north", "North Pasture"), pasture("creek", "Creek Pasture")];
    // P1–P3 north, P4–P5 creek. Rotation order already runs 1..5.
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
  };

  /**
   * The locator's pasture segment, opened.
   *
   * Opening is idempotent the same way "Elsewhere" is: the bar's segment is
   * the one thing that toggles, and it is only pressed when shut.
   */
  const openPastures = () => {
    const seg = document.querySelector(".mv-loc__seg");
    if (seg && seg.getAttribute("aria-expanded") === "false") fireEvent.click(seg);
  };

  const pastureChip = (name: string) => {
    openPastures();
    return [...document.querySelectorAll(".mv-loc__opt")].find((b) => b.textContent?.startsWith(name))!;
  };

  it("shows no pasture picker on a farm with one", async () => {
    pastures = [pasture("north", "North Pasture")];
    paddocks = paddocks.map((p) => ({ ...p, pastureId: "north" }));
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    expect(document.querySelector(".mv-locator")).toBeNull();
  });

  it("shows none at all when no paddock carries a pasture", async () => {
    // Green Pastures was in exactly this state before the seed was fixed.
    // The page has to read as it always did rather than scoping to nothing.
    events.push(strip("s1", "p3", 0, 0.2, null));
    await mount();
    expect(document.querySelector(".mv-locator")).toBeNull();
    // Every other paddock on the farm is still reachable — the whole farm is
    // one scope when nothing carries a pasture.
    expect(candidates().sort()).toEqual(["Paddock 1", "Paddock 2", "Paddock 4", "Paddock 5"]);
  });

  it("offers only the paddocks of the pasture the mob is standing in", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();

    // North holds P1–P3, and the mob is in P1. Creek's P4 and P5 are not on
    // offer at all.
    expect(candidates().sort()).toEqual(["Paddock 2", "Paddock 3"]);
  });

  it("draws only that pasture's paddocks, and fits the map to them", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();

    // North's three, and nothing of Creek's two. Fitting to all five is what
    // made Green Pastures 46 postage stamps.
    expect([...svg().querySelectorAll("path.pm-unit-hit")]).toHaveLength(3);
    expect(svg().querySelectorAll("text.pm-label")).toHaveLength(3);
  });

  it("moves to another pasture and offers its paddocks instead", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    fireEvent.click(pastureChip("Creek Pasture"));

    expect(pastureChip("Creek Pasture").getAttribute("aria-pressed")).toBe("true");
    expect(candidates().sort()).toEqual(["Paddock 4", "Paddock 5"]);
  });

  it("drops the destination when the pasture changes", async () => {
    // A paddock chosen in North is not a destination in Creek, and leaving it
    // set would draw one pasture with the wire on ground outside it.
    inPastures();
    weighEveryone();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();

    goElsewhere("Paddock 3");
    expect(screen.getByText(/is in/).textContent).toMatch(/moving on to Paddock 3/);

    fireEvent.click(pastureChip("Creek Pasture"));
    expect(screen.getByText(/is in/).textContent).not.toMatch(/moving on/);
  });

  it("follows the paddock back when one is picked in another pasture", async () => {
    // Picking a paddock settles the pasture, so the two can never disagree.
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();

    fireEvent.click(pastureChip("Creek Pasture"));
    goElsewhere("Paddock 5");
    expect(pastureChip("Creek Pasture").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/is in/).textContent).toMatch(/moving on to Paddock 5/);
  });

  it("says how much ground each pasture holds", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    expect(pastureChip("North Pasture").textContent).toMatch(/3 paddocks · \d+ ac/);
    expect(pastureChip("Creek Pasture").textContent).toMatch(/2 paddocks · \d+ ac/);
  });

  it("goes back to the mob's own pasture when the mob changes", async () => {
    inPastures();
    groups = [mob("a", "Main mob"), mob("b", "Yearlings")];
    events.push(
      { ...strip("s1", "p1", 0, 0.2, null), groupId: "a", enteredAt: "2026-08-09T06:00:00.000Z" },
      { ...strip("s2", "p4", 0, 0.2, null), groupId: "b", enteredAt: "2026-08-12T06:00:00.000Z" },
    );
    await mount();

    // Main mob stands in North. Wander to Creek, then switch mob.
    fireEvent.click(pastureChip("Creek Pasture"));
    const yearlings = [...document.querySelectorAll("button.mv-mob")].find((b) =>
      b.textContent?.startsWith("Yearlings"),
    )!;
    fireEvent.click(yearlings);

    // Yearlings are in P4, which is Creek — and that is where the page is,
    // because the mob decided it rather than the leftover override.
    expect(screen.getByText(/is in/).textContent).toMatch(/Yearlings is in Paddock 4/);
    expect(pastureChip("Creek Pasture").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("where else they could go", () => {
  /**
   * The picker used to be a row of paddock codes in rotation order. At
   * forty-six that is not a picker, and at eight it still made you hold the
   * rest days in your head — which is the one figure the decision turns on.
   *
   * The ranking is `boardRows`, the same function the grazing board draws
   * with, so the two cannot disagree about which ground is ready.
   */

  /** A closed graze: in on `entered`, out on `exited`. */
  const grazed = (id: string, paddockId: string, entered: string, exited: string): GrazingEvent => ({
    ...strip(id, paddockId, 0, 1, exited),
    enteredAt: entered,
  });

  const target = (paddockId: string, growing: number): PlanPaddockTarget => ({
    id: `t-${paddockId}`, planId: "plan", paddockId,
    targetEntryHeightIn: null, targetResidualHeightIn: null,
    minRecoveryDaysGrowing: growing, minRecoveryDaysDormant: null,
    targetUtilizationPct: null, plannedGrazingNotes: null, plannedDefermentNotes: null,
    sensitiveAreaStrategy: null, notes: null,
  });

  it("puts the longest-rested paddock at the top, not the next one in the round", async () => {
    // Rotation order runs 1..5, so a list in rotation order would read
    // 2, 4, 5. Rest says otherwise: P5 has been shut up since June.
    events.push(
      strip("open", "p1", 0, 0.2, null),
      grazed("g2", "p2", "2026-08-01T12:00:00.000Z", "2026-08-06T12:00:00.000Z"),
      grazed("g4", "p4", "2026-07-10T12:00:00.000Z", "2026-07-14T12:00:00.000Z"),
      grazed("g5", "p5", "2026-06-01T12:00:00.000Z", "2026-06-05T12:00:00.000Z"),
    );
    await mount();
    // P3 has never been grazed, which is a candidate without a number — it
    // sorts below anything with a real rest figure.
    expect(candidates()).toEqual(["Paddock 5", "Paddock 4", "Paddock 2", "Paddock 3"]);
  });

  it("says how long each one has rested", async () => {
    events.push(
      strip("open", "p1", 0, 0.2, null),
      grazed("g2", "p2", "2026-08-01T12:00:00.000Z", "2026-08-06T12:00:00.000Z"),
    );
    await mount();
    expect(candidate("Paddock 2").querySelector(".mv-cand__rest")!.textContent).toMatch(/^7d/);
    expect(candidate("Paddock 3").querySelector(".mv-cand__rest")!.textContent).toMatch(/never grazed/);
  });

  it("dates the last grazing, which is an instant rather than a day", async () => {
    // The page's other date is a cutting, which is a plain day. Formatting a
    // timestamp the same way produced "…000ZT00:00:00" — an Invalid Date,
    // rendered as those words in the column.
    events.push(
      strip("open", "p1", 0, 0.2, null),
      grazed("g2", "p2", "2026-08-01T12:00:00.000Z", "2026-08-06T12:00:00.000Z"),
    );
    await mount();
    expect(candidate("Paddock 2").querySelector(".mv-cand__seen")!.textContent).toBe("Aug 6, 2026");
  });

  it("marks ground short of the plan's recovery figure, and still lets you take it", async () => {
    // Seven days rested against a fourteen-day recovery. A warning, not a
    // lock: sometimes you graze it anyway, and the app has no business
    // deciding that for the farm.
    plan = withPlan();
    targets.push(target("p2", 14));
    events.push(
      strip("open", "p1", 0, 0.2, null),
      grazed("g2", "p2", "2026-08-01T12:00:00.000Z", "2026-08-06T12:00:00.000Z"),
    );
    await mount();
    expect(candidate("Paddock 2").querySelector(".grz-eligible--early")!.textContent).toMatch(/7d short/);

    goElsewhere("Paddock 2");
    expect(screen.getByText(/is in/).textContent).toMatch(/moving on to Paddock 2/);
  });

  it("says nothing about ground that has met its target", async () => {
    plan = withPlan();
    targets.push(target("p2", 5));
    events.push(
      strip("open", "p1", 0, 0.2, null),
      grazed("g2", "p2", "2026-08-01T12:00:00.000Z", "2026-08-06T12:00:00.000Z"),
    );
    await mount();
    expect(candidate("Paddock 2").querySelector(".grz-eligible--early")).toBeNull();
  });

  it("sinks a paddock another mob is standing in, and says whose", async () => {
    // It is on the list because the ground exists, not because it is a
    // candidate — putting two mobs on the same paddock is the mistake this
    // row is there to prevent, not to invite.
    // Yearlings are in P2 — near the front of the round, and rested since
    // June before they went in. Both of those would float it to the top of a
    // list that ranked any other way.
    groups = [mob("a", "Main mob"), mob("b", "Yearlings")];
    events.push(
      { ...strip("s1", "p1", 0, 0.2, null), groupId: "a" },
      { ...strip("s2", "p2", 0, 0.2, null), groupId: "b" },
      grazed("g2", "p2", "2026-06-01T12:00:00.000Z", "2026-06-05T12:00:00.000Z"),
      grazed("g5", "p5", "2026-08-01T12:00:00.000Z", "2026-08-06T12:00:00.000Z"),
    );
    await mount();
    const list = candidates();
    expect(list[list.length - 1]).toMatch(/^Paddock 2/);
    expect(nameOf(candidate("Paddock 2"))).toMatch(/Yearlings in it/);
  });

  it("does not offer the paddock they are already in", async () => {
    events.push(strip("open", "p3", 0, 0.2, null));
    await mount();
    expect(candidates()).not.toContain("Paddock 3");
  });

  it("does not offer the paddock already chosen to move to", async () => {
    // Once you have picked P4, "elsewhere" means somewhere other than P4.
    events.push(strip("open", "p3", 0, 0.2, null));
    await mount();
    fireEvent.click(screen.getByText("On to Paddock 4"));
    expect(candidates()).not.toContain("Paddock 4");
    // And the ground they are standing on comes back on offer, named with
    // the mob that is on it — "stay put" is a destination like any other.
    expect(nameOf(candidate("Paddock 3"))).toMatch(/Main mob in it/);
  });

  it("shuts the list once a paddock is taken", async () => {
    events.push(strip("open", "p3", 0, 0.2, null));
    await mount();
    goElsewhere("Paddock 5");
    expect(document.querySelectorAll("button.mv-cand")).toHaveLength(0);
  });

  it("offers nowhere else on a one-paddock farm", async () => {
    // No toggle rather than a toggle that opens an empty list.
    paddocks = [unit(1)];
    events.push(strip("open", "p1", 0, 0.2, null));
    await mount();
    expect(onward("Elsewhere…")).toBeUndefined();
  });
});

describe("the locator bar", () => {
  /**
   * One line saying where on the farm you are, however deep the ground goes.
   *
   * The rule that keeps it out of the way is that a level holding one thing
   * gets no segment — which is why a farm with one pasture sees no bar, and
   * why the farm level is absent until properties land.
   */
  const inPastures = () => {
    pastures = [pasture("north", "North Pasture"), pasture("creek", "Creek Pasture")];
    paddocks = paddocks.map((p, i) => ({ ...p, pastureId: i < 3 ? "north" : "creek" }));
  };

  const openPastures = () => {
    const seg = document.querySelector(".mv-loc__seg");
    if (seg && seg.getAttribute("aria-expanded") === "false") fireEvent.click(seg);
  };

  const locator = () =>
    document.querySelector(".mv-locator")?.textContent?.replace(/[▾▸]/g, " ").replace(/\s+/g, " ").trim() ?? null;

  it("reads pasture then paddock", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    expect(locator()).toBe("North Pasture Paddock 1");
  });

  it("follows the mob when it is moving on", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    fireEvent.click(screen.getByText("On to Paddock 2"));
    expect(locator()).toBe("North Pasture Paddock 2");
  });

  it("keeps the siblings shut until the segment is tapped", async () => {
    // A bar that opened on load would be a chip row with extra steps.
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    expect(document.querySelectorAll(".mv-loc__opt")).toHaveLength(0);
    expect(document.querySelector(".mv-loc__seg")!.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(document.querySelector(".mv-loc__seg")!);
    expect(document.querySelectorAll(".mv-loc__opt")).toHaveLength(2);
  });

  it("shuts again on a second tap", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    fireEvent.click(document.querySelector(".mv-loc__seg")!);
    fireEvent.click(document.querySelector(".mv-loc__seg")!);
    expect(document.querySelectorAll(".mv-loc__opt")).toHaveLength(0);
  });

  it("shuts when a pasture is taken, and the bar says the new one", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    openPastures();
    fireEvent.click([...document.querySelectorAll(".mv-loc__opt")].find((b) => b.textContent!.startsWith("Creek"))!);

    expect(document.querySelectorAll(".mv-loc__opt")).toHaveLength(0);
    // No paddock chosen in Creek yet, and the bar says so rather than
    // showing a paddock from the pasture just left.
    expect(locator()).toBe("Creek Pasture no paddock yet");
  });

  it("shuts when the mob changes", async () => {
    // Left open, it would be offering the last mob's siblings over the top
    // of the new mob's ground.
    inPastures();
    groups = [mob("a", "Main mob"), mob("b", "Yearlings")];
    events.push(
      { ...strip("s1", "p1", 0, 0.2, null), groupId: "a", enteredAt: "2026-08-09T06:00:00.000Z" },
      { ...strip("s2", "p4", 0, 0.2, null), groupId: "b", enteredAt: "2026-08-12T06:00:00.000Z" },
    );
    await mount();
    openPastures();
    fireEvent.click([...document.querySelectorAll("button.mv-mob")].find((b) => b.textContent!.startsWith("Yearlings"))!);
    expect(document.querySelectorAll(".mv-loc__opt")).toHaveLength(0);
    expect(locator()).toBe("Creek Pasture Paddock 4");
  });

  it("says how much ground each sibling holds", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    openPastures();
    const creek = [...document.querySelectorAll(".mv-loc__opt")].find((b) => b.textContent!.startsWith("Creek"))!;
    expect(creek.textContent).toMatch(/2 paddocks · \d+ ac/);
  });

  it("marks which sibling is the one you are in", async () => {
    inPastures();
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    openPastures();
    const opts = [...document.querySelectorAll(".mv-loc__opt")];
    expect(opts.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent!.slice(0, 13)))
      .toEqual(["North Pasture"]);
  });

  it("shows no bar at all on a farm with one pasture", async () => {
    // The collapse rule: a level holding one thing is not a choice, and the
    // page has to read exactly as it did before any of this.
    pastures = [pasture("north", "North Pasture")];
    paddocks = paddocks.map((p) => ({ ...p, pastureId: "north" }));
    events.push(strip("s1", "p1", 0, 0.2, null));
    await mount();
    expect(document.querySelector(".mv-locator")).toBeNull();
  });
});
