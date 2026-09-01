// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ForageRemoval, GrazingEvent, Paddock, RemovalDraft } from "../lib/grazing";

/**
 * Herd → Rotation: rounds, and the hay that explains a rest figure.
 *
 * Five units and one mob, as on the farm. The flat 1.91 acres is a fixture —
 * the real units differ, and 040 has the measured figures.
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
  pastureId: null,
  unitType: "permanent",
  sweepHeadingDeg: n === 5 ? 0 : n % 2 === 0 ? 90 : 270,
  sweepLengthFt: 400, rotationOrder: null,
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

const event = (
  id: string,
  paddockId: string,
  entered: string,
  exited: string | null,
  from: number | null = null,
  to: number | null = null,
): GrazingEvent => ({
  id,
  paddockId,
  groupId: "mob",
  enteredAt: entered,
  exitedAt: exited,
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
  sweptFrom: from,
  sweptTo: to,
  grazedShape: null,
});

const paddocks = [1, 2, 3, 4, 5].map(paddock);
const theMob = {
  id: "mob", name: "Main mob", species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null,
};

/**
 * One round, opened well before anything in these fixtures.
 *
 * A round is a row the farm starts now rather than something derived from the
 * moves (066), so these tests need one to hang their grazing on. Dated in
 * April so every fixture's moves fall under it whatever month they use.
 */
let rounds: {
  id: string; groupId: string; pastureId: string | null;
  startedAt: string; name: string | null; notes: string | null; derived: boolean;
}[] = [];

const events: GrazingEvent[] = [];
const removals: ForageRemoval[] = [];

const recorded = vi.fn(async (_farmId: string, _draft: RemovalDraft) => "new-removal");
const savedRound = vi.fn(async (_f: string, _id: string | null, _e: Record<string, unknown>) => "new-round");
const deletedRound = vi.fn(async (_f: string, _id: string) => {});
let pastures: { id: string; name: string; code: null; acres: null; notes: null;
                active: boolean; propertyId: null; boundary: null }[] = [];

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchPastures: vi.fn(async () => pastures),
    saveRound: savedRound,
    deleteRound: deletedRound,
    fetchGrazingGroups: vi.fn(async () => [theMob]),
    fetchRounds: vi.fn(async () => rounds),
    fetchGrazingEvents: vi.fn(async () => events),
    fetchForageRemovals: vi.fn(async () => removals),
    recordRemoval: recorded,
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
  pastures = [];
  savedRound.mockClear();
  deletedRound.mockClear();
  rounds = [{
    id: "r1", groupId: "mob", pastureId: null,
    startedAt: "2026-04-01T00:00:00.000Z", name: null, notes: null, derived: false,
  }];

  recorded.mockClear();
});

const mount = async () => {
  const { default: Rotation } = await import("./Rotation");
  render(
    <MemoryRouter>
      <Rotation />
    </MemoryRouter>,
  );
  // Not the title — "Rotation" is also the nav entry, so it matches twice.
  // Waiting on the loader clearing is what actually means "the fetch landed".
  // queryAllBy, not queryBy: pages folded into others bring their own
  // loading state, and queryByText throws when it finds more than one.
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

/** One round through three units in May, a second starting in late June. */
/**
 * Two trips through the ground, as the farm would have marked them.
 *
 * The second starts on 20 June, when they walked back into P1. Under the old
 * derived rule the app worked that boundary out for itself; it is a row now,
 * because where a round begins depends on hay and weather and overwintering
 * and none of that is in the move record.
 */
const twoRounds = () => {
  rounds = [
    { id: "r1", groupId: "mob", pastureId: null,
      startedAt: "2026-05-01T00:00:00.000Z", name: null, notes: null, derived: false },
    { id: "r2", groupId: "mob", pastureId: null,
      startedAt: "2026-06-20T00:00:00.000Z", name: null, notes: null, derived: false },
  ];
  events.push(
    event("r1a", "p1", "2026-05-01T12:00:00.000Z", "2026-05-05T12:00:00.000Z"),
    event("r1b", "p2", "2026-05-05T12:00:00.000Z", "2026-05-08T12:00:00.000Z", 0, 0.5),
    event("r1c", "p2", "2026-05-08T12:00:00.000Z", "2026-05-11T12:00:00.000Z", 0.5, 1),
    event("r1d", "p3", "2026-05-11T12:00:00.000Z", "2026-05-15T12:00:00.000Z"),
    event("r2a", "p1", "2026-06-20T12:00:00.000Z", "2026-06-24T12:00:00.000Z"),
  );
};

describe("the rounds", () => {
  it("explains what a round is when there are none yet", async () => {
    // A round is now a row the farm starts, so "none yet" means no rows —
    // not "no moves". The wording says who starts one and why.
    rounds = [];
    await mount();
    expect(screen.getByText(/No rounds yet/)).toBeTruthy();
    expect(screen.getByText(/one mob's trip through one pasture, and you start it/)).toBeTruthy();
  });

  it("counts the rounds in the eyebrow", async () => {
    twoRounds();
    await mount();
    expect(screen.getByText(/2 rounds/)).toBeTruthy();
  });

  it("puts the round they are in now at the top", async () => {
    twoRounds();
    await mount();
    // Named by mob and ground now, because a farm running four mobs over six
    // pastures has thirty rounds and "Round 2" alone says nothing about which.
    const heads = [...document.querySelectorAll(".rot-round__n")].map((n) => n.textContent);
    expect(heads).toEqual(["Main mob · Round 2", "Main mob · Round 1"]);
  });

  it("collapses a stay's wire moves into one row and counts them", async () => {
    twoRounds();
    await mount();
    // Paddock 2 was taken in two strips but visited once.
    expect(screen.getByText(/2 strips · 1\.91 ac/)).toBeTruthy();
  });

  it("says 'first time' rather than a rest of zero on the opening pass", async () => {
    twoRounds();
    await mount();
    expect(screen.getAllByText("first time").length).toBe(3);
  });

  it("reports the rest a unit had when they walked back into it", async () => {
    twoRounds();
    await mount();
    // Paddock 1 left 5 May, re-entered 20 June.
    expect(screen.getByText("46 days")).toBeTruthy();
  });

  it("marks a round that is still running", async () => {
    events.push(
      event("a", "p1", "2026-08-01T12:00:00.000Z", "2026-08-05T12:00:00.000Z"),
      event("b", "p2", "2026-08-05T12:00:00.000Z", null),
    );
    await mount();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText(/still in it/)).toBeTruthy();
  });
});

describe("hay on the record", () => {
  it("shows a cutting against the round it fell in", async () => {
    twoRounds();
    removals.push({
      id: "h1", paddockId: "p3", removedOn: "2026-06-01",
      kind: "hay", cuttingNumber: 1, yieldLb: 4200, yieldBasis: "estimated", notes: null,
    });
    await mount();
    const cut = document.querySelector(".rot-cut");
    expect(cut?.textContent).toMatch(/Hay off Paddock 3, Jun 1, 2026 — 1st cutting, 4,200 lb, estimated/);
  });

  it("shows a cutting even when nothing has been grazed at all", async () => {
    removals.push({
      id: "h1", paddockId: "p2", removedOn: "2026-06-01",
      kind: "baleage", cuttingNumber: 2, yieldLb: null, yieldBasis: null, notes: null,
    });
    await mount();
    expect(document.querySelector(".rot-cut")?.textContent).toMatch(
      /Baleage off Paddock 2, Jun 1, 2026 — 2nd cutting/,
    );
  });

  it("records one, and says what it did to the rest clock", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record hay"));
    fireEvent.change(screen.getByLabelText("Off which paddock"), { target: { value: "p4" } });
    fireEvent.change(screen.getByLabelText("Cut on"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText("Cutting no."), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Yield, lb"), { target: { value: "4200" } });
    fireEvent.change(screen.getByLabelText("Weighed or estimated"), { target: { value: "weighed" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(recorded).toHaveBeenCalledTimes(1));
    expect(recorded.mock.calls[0][1]).toMatchObject({
      paddockId: "p4",
      removedOn: "2026-07-01",
      kind: "hay",
      cuttingNumber: 1,
      yieldLb: 4200,
      yieldBasis: "weighed",
    });
    await screen.findByText(/Its rest now counts from Jul 1, 2026/);
  });

  it("will not save without a paddock", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record hay"));
    fireEvent.click(screen.getByText("Record it"));
    expect(recorded).not.toHaveBeenCalled();
  });

  it("leaves the optional figures null rather than zero", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record hay"));
    fireEvent.change(screen.getByLabelText("Off which paddock"), { target: { value: "p1" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(recorded).toHaveBeenCalledTimes(1));
    expect(recorded.mock.calls[0][1]).toMatchObject({
      cuttingNumber: null,
      yieldLb: null,
      yieldBasis: null,
    });
  });

  it("offers the other forms a cut can take", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record hay"));
    const options = [...screen.getByLabelText("What").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Hay", "Haylage", "Baleage", "Green chop", "Other"]);
  });
});

describe("getting back", () => {
  it("links to the board, since the daily job is there", async () => {
    // The board is a tab now rather than a page of its own, so the link
    // carries which tab to open. Asserting the whole href rather than the
    // path keeps that honest — a link to the page with no tab lands on the
    // report, which is not where "the board" means.
    await mount();
    const back = screen.getByText("← the board");
    expect(back.getAttribute("href")).toBe("/grazing/records?tab=paddocks");
  });
});

describe("starting and correcting a round", () => {
  /**
   * A round is a row the farm starts. Where the mob overwinters, which
   * paddock is shut up for hay and which is too wet this week all move where
   * a round begins, and none of that is in the move record — so the app
   * cannot work it out, and stopped trying.
   */
  const openStart = () => fireEvent.click(screen.getByRole("button", { name: "Start a round" }));

  it("starts one for the mob and ground chosen", async () => {
    rounds = [];
    pastures = [
      { id: "north", name: "North Pasture", code: null, acres: null, notes: null,
        active: true, propertyId: null, boundary: null },
    ];
    paddocks.forEach((p) => { p.pastureId = "north"; });
    await mount();
    openStart();
    fireEvent.change(screen.getByLabelText("Started"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Round name"), { target: { value: "After the hay" } });
    fireEvent.click(screen.getByRole("button", { name: "Start it" }));

    await waitFor(() => expect(savedRound).toHaveBeenCalled());
    expect(savedRound.mock.calls[0][1]).toBeNull();
    expect(savedRound.mock.calls[0][2]).toMatchObject({
      groupId: "mob", pastureId: "north", name: "After the hay",
    });
    paddocks.forEach((p) => { p.pastureId = null; });
  });

  it("dates a round from midnight, so it owns the whole day it started", async () => {
    // Started "today" from a form opened at noon, an instant would leave the
    // morning's moves in the round before it.
    rounds = [];
    await mount();
    openStart();
    fireEvent.change(screen.getByLabelText("Started"), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Start it" }));

    await waitFor(() => expect(savedRound).toHaveBeenCalled());
    const started = savedRound.mock.calls[0][2].startedAt as string;
    expect(new Date(started).getHours()).toBe(0);
  });

  it("offers no ground picker on a farm whose paddocks carry no pasture", async () => {
    // The round is of the whole farm there, which is what it has always meant.
    rounds = [];
    await mount();
    openStart();
    expect(screen.queryByLabelText("Ground")).toBeNull();
  });

  it("corrects the day a round started, without offering to move its mob", async () => {
    // Changing the mob or the ground would hand a round's grazing to a round
    // on other ground and leave this one empty. The day is the thing that is
    // actually got wrong.
    twoRounds();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Main mob · Round 2" }));
    expect(screen.queryByLabelText("Mob")).toBeNull();
    fireEvent.change(screen.getByLabelText("Started"), { target: { value: "2026-06-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(savedRound).toHaveBeenCalled());
    expect(savedRound.mock.calls[0][1]).toBe("r2");
  });

  it("takes a boundary away without touching the moves", async () => {
    // "That was not a new round after all." Its moves stay exactly where they
    // are and fall into the round before it.
    twoRounds();
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Main mob · Round 2" }));
    fireEvent.click(screen.getByRole("button", { name: "not a new round" }));

    await waitFor(() => expect(deletedRound).toHaveBeenCalledWith("farm-1", "r2"));
    expect(recorded).not.toHaveBeenCalled();
  });

  it("says which round's start was guessed rather than recorded", async () => {
    // 066 backfilled the history. A guess about last season presented as a
    // record is worse than no record.
    twoRounds();
    rounds = rounds.map((r) => (r.id === "r1" ? { ...r, derived: true } : r));
    await mount();
    const heads = [...document.querySelectorAll(".rot-round")].map((el) => el.textContent ?? "");
    expect(heads[0]).not.toContain("start guessed");
    expect(heads[1]).toContain("start guessed");
  });

  it("shows grazing older than any round rather than dropping it", async () => {
    // A move corrected to a date before the first round is something the farm
    // should see. Sweeping it into the first round would move a boundary
    // nobody asked to move.
    twoRounds();
    rounds = rounds.filter((r) => r.id !== "r1");
    await mount();
    expect(screen.getByText("Before any round was started")).toBeTruthy();
    expect(screen.getByText(/Start a round dated on or before/)).toBeTruthy();
  });
});
