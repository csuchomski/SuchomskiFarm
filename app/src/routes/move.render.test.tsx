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
    fetchGrazingEvents: vi.fn(async () => events),
    fetchForageRemovals: vi.fn(async () => removals),
    fetchForageAvailability: vi.fn(async () => availability),
    fetchGrazingGroups: vi.fn(async () => [
      { id: "mob", name: "Main mob", species: "cattle", class: "mixed",
        headCountManual: null, avgWeightLbManual: null, active: true, notes: null },
    ]),
    fetchGroupMembers: vi.fn(async () => [1, 2, 3, 4, 5].map((n) => ({
      id: `m${n}`, groupId: "mob", animalId: `a${n}`, joinedOn: null, leftOn: null,
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
  tramplingLossPct: null, fouledAreaPct: null, active: true, notes: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  paddocks = [1, 2, 3, 4, 5].map(unit);
  events.length = 0;
  removals.length = 0;
  availability.length = 0;
  targets.length = 0;
  weights.clear();
  plan = null;
  moved.mockClear();
  cut.mockClear();
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
    fireEvent.click(onward("P5"));
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
    // but that is what *disappeared*. This plan sets no trampling figure, so
    // the app's 15% applies and 1,020 lb of it is eaten. The page says eaten,
    // because saying "on offer" is what let the loss go unnoticed.
    expect(screen.getByText(/8″ down to 4″/)).toBeTruthy();
    expect(screen.getByText(/1,020 lb DM an acre eaten/)).toBeTruthy();
    expect(screen.getByText(/50% of what is standing/)).toBeTruthy();
    expect(screen.getByText(/15% trodden in and 3% of the ground fouled/)).toBeTruthy();
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
