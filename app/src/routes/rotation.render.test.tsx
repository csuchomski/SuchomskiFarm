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
const events: GrazingEvent[] = [];
const removals: ForageRemoval[] = [];

const recorded = vi.fn(async (_farmId: string, _draft: RemovalDraft) => "new-removal");

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
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
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

/** One round through three units in May, a second starting in late June. */
const twoRounds = () => {
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
    await mount();
    expect(screen.getByText(/No rounds yet/)).toBeTruthy();
    expect(screen.getByText(/one trip through the farm/)).toBeTruthy();
  });

  it("counts the rounds in the eyebrow", async () => {
    twoRounds();
    await mount();
    expect(screen.getByText(/2 rounds/)).toBeTruthy();
  });

  it("puts the round they are in now at the top", async () => {
    twoRounds();
    await mount();
    const heads = [...document.querySelectorAll(".rot-round__n")].map((n) => n.textContent);
    expect(heads).toEqual(["Round 2", "Round 1"]);
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
    await mount();
    const back = screen.getByText("← the board");
    expect(back.getAttribute("href")).toBe("/grazing");
  });
});
