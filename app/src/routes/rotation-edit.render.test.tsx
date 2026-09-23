// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { GrazingEvent, MoveEdit, Paddock } from "../lib/grazing";

/**
 * Rotation → correcting the record.
 *
 * A round is a row the farm starts (066), but deleting one from here still
 * means deleting its moves — the other, gentler "not a new round" only takes
 * the boundary away. So both jobs here — fixing a move and clearing a round's
 * moves — come down to what is sent for which event, and that is what these
 * check. The chain repair itself is the database's, verified in migration 047
 * against real RLS.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const paddock = (id: string, name: string): Paddock => ({
  id, name, code: name.replace("Paddock ", "P"),
  pastureId: null,
  acresMeasured: 2, acresGrazable: 2, unitType: "permanent",
  sweepHeadingDeg: 270, sweepLengthFt: 500, rotationOrder: 1,
  seedingDate: null, fenceType: null, ecologicalSite: null, soilMapUnit: null,
  noxiousSpecies: null, noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
});

const ev = (over: Partial<GrazingEvent> & { id: string; paddockId: string; enteredAt: string }): GrazingEvent => ({
  groupId: "mob", exitedAt: null, headCount: 4, avgWeightLb: 1000,
  forageHeightInEntry: 9, residualHeightInExit: null, utilizationPct: null,
  soilMoisture: null, supplementalFeed: false, weatherNotes: null, notes: null,
  latitude: null, longitude: null, sweptFrom: 0, sweptTo: 0.2, grazedShape: null,
  ...over,
});

const paddocks = [paddock("p1", "Paddock 1"), paddock("p2", "Paddock 2")];

/** Two strips out of P1, then P2 — one round, then P1 again starts a second. */
let events: GrazingEvent[] = [];
const theMob = {
  id: "mob", name: "Main mob", species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null,
};

/**
 * One round, opened well before anything here.
 *
 * A round is a row the farm starts now rather than something derived from the
 * moves (066), so these fixtures need one for their grazing to hang on.
 */
let rounds: {
  id: string; groupId: string; pastureId: string | null;
  startedAt: string; name: string | null; notes: string | null; derived: boolean;
}[] = [];

const reset = () => {
  rounds = [
    { id: "r1", groupId: "mob", pastureId: null,
      startedAt: "2026-04-01T00:00:00.000Z", name: null, notes: null, derived: false },
    // P1 again on the 10th is the start of the next trip round, which the
    // farm would have said at the time. Two rounds, as the fixture's own
    // comment has always described.
    { id: "r2", groupId: "mob", pastureId: null,
      startedAt: "2026-08-10T00:00:00.000Z", name: null, notes: null, derived: false },
  ];
  events = [
    ev({ id: "e1", paddockId: "p1", enteredAt: "2026-08-01T12:00:00.000Z",
         exitedAt: "2026-08-02T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.2 }),
    ev({ id: "e2", paddockId: "p1", enteredAt: "2026-08-02T12:00:00.000Z",
         exitedAt: "2026-08-03T12:00:00.000Z", sweptFrom: 0.2, sweptTo: 0.4 }),
    ev({ id: "e3", paddockId: "p2", enteredAt: "2026-08-03T12:00:00.000Z",
         exitedAt: "2026-08-05T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.5 }),
    ev({ id: "e4", paddockId: "p1", enteredAt: "2026-08-10T12:00:00.000Z",
         exitedAt: null, sweptFrom: 0.4, sweptTo: 0.6 }),
  ];
};

const editMove = vi.fn<(farmId: string, eventId: string, edit: MoveEdit) => Promise<void>>(async () => {});
const deleteMove = vi.fn<(farmId: string, eventId: string) => Promise<void>>(async () => {});
const deleteMoves = vi.fn<(farmId: string, ids: string[]) => Promise<number>>(async () => 3);

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPaddocks: vi.fn(async () => paddocks),
    fetchPastures: vi.fn(async () => []),
    fetchGrazingGroups: vi.fn(async () => [theMob]),
    fetchRounds: vi.fn(async () => rounds),
    fetchGrazingEvents: vi.fn(async () => events),
    fetchForageRemovals: vi.fn(async () => []),
    editMove,
    deleteMove,
    deleteMoves,
  };
});

beforeEach(() => {
  reset();
  editMove.mockClear();
  deleteMove.mockClear();
  deleteMoves.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const mount = async () => {
  const { default: Rotation } = await import("./Rotation");
  render(<MemoryRouter><Rotation /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

/** Open the stay whose row shows this paddock, in the newest round first. */
const openStay = (name: string) => {
  const row = screen.getAllByRole("button").find((b) => b.textContent?.includes(name));
  fireEvent.click(row!);
};

describe("opening a stay out into its moves", () => {
  it("keeps the moves hidden until the stay is asked for", async () => {
    await mount();
    expect(screen.queryAllByText("Edit")).toHaveLength(0);
  });

  it("shows one line per wire move, not one per stay", async () => {
    await mount();
    // The second round's P1 stay is a single move; the first round's is two.
    openStay("Paddock 2");
    expect(screen.getAllByText("Edit")).toHaveLength(1);
  });

  it("says what each move was, so the right one can be picked", async () => {
    await mount();
    openStay("Paddock 2");
    expect(screen.getByText(/wire 0→50%/)).toBeTruthy();
  });
});

describe("correcting a move", () => {
  const openEditor = async () => {
    await mount();
    openStay("Paddock 2");
    fireEvent.click(screen.getByText("Edit"));
  };

  it("opens on what was recorded rather than an empty form", async () => {
    await openEditor();
    // The paddock is the one thing a static dump of the page cannot show — a
    // select's choice is a property, not an attribute — so it is asserted
    // here rather than eyeballed.
    expect((screen.getByLabelText("Which paddock") as HTMLSelectElement).value).toBe("p2");
    expect((screen.getByLabelText("Wire from, %") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("Wire to, %") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Head") as HTMLInputElement).value).toBe("4");
  });

  it("sends the wire back as a fraction, not the percentage on screen", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Wire to, %"), { target: { value: "65" } });
    fireEvent.click(screen.getByText("Save the correction"));
    await waitFor(() => expect(editMove).toHaveBeenCalled());
    expect(editMove.mock.calls[0][2]).toMatchObject({ sweptFrom: 0, sweptTo: 0.65 });
  });

  it("refuses one end of a wire without the other", async () => {
    await openEditor();
    fireEvent.change(screen.getByLabelText("Wire to, %"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save the correction"));
    await waitFor(() => expect(screen.getByText(/both ends of the wire/)).toBeTruthy());
    expect(editMove).not.toHaveBeenCalled();
  });

  it("will not let a move that has one edit its departure, because the next move owns it", async () => {
    await openEditor();
    const left = screen.getByLabelText("They left") as HTMLInputElement;
    expect(left.readOnly).toBe(true);
    expect(screen.getByText(/edit that move to change it/)).toBeTruthy();
  });

  it("lets the last move state its own departure", async () => {
    await mount();
    // The second round's P1 stay holds e4, which nothing follows.
    const rows = screen.getAllByRole("button").filter((b) => b.textContent?.includes("Paddock 1"));
    fireEvent.click(rows[0]);
    fireEvent.click(screen.getByText("Edit"));
    expect((screen.getByLabelText("They left") as HTMLInputElement).readOnly).toBe(false);
  });
});

describe("deleting", () => {
  it("says what will happen before it happens, and does nothing until asked twice", async () => {
    await mount();
    openStay("Paddock 2");
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByText(/gap/)).toBeTruthy();
    expect(deleteMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete the move"));
    await waitFor(() => expect(deleteMove).toHaveBeenCalledWith("farm-1", "e3"));
  });

  it("backs out of a delete without touching the record", async () => {
    await mount();
    openStay("Paddock 2");
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Keep it"));
    expect(screen.getByText("Save the correction")).toBeTruthy();
    expect(deleteMove).not.toHaveBeenCalled();
  });

  it("takes every move of a round, because a round is only its moves", async () => {
    await mount();
    const rounds = document.querySelectorAll(".rot-round");
    const round1 = rounds[1] as HTMLElement;
    // By its accessible name, not its visible words: every round's link says
    // "Delete these moves", and the name is what tells them apart.
    fireEvent.click(within(round1).getByRole("button", { name: /delete the moves in/ }));
    fireEvent.click(within(round1).getByText("Delete these moves"));
    await waitFor(() => expect(deleteMoves).toHaveBeenCalled());
    // Round 1 is the three moves of the first trip round; the fourth belongs
    // to the round after it and must not be swept up with them.
    expect(deleteMoves.mock.calls[0][1]).toEqual(["e1", "e2", "e3"]);
  });

  it("counts the moves it is about to take, rather than the stays", async () => {
    await mount();
    const rounds = document.querySelectorAll(".rot-round");
    fireEvent.click((rounds[1] as HTMLElement).querySelector(".rot-round__del")!);
    expect(screen.getByText(/all 3 of them off the record/)).toBeTruthy();
  });
});

/**
 * A wire that nobody moved.
 *
 * The percentages are shown to a tenth — 0.905782805986017 reads as "90.6" —
 * and a fraction rebuilt from that display is not the fraction that came out
 * of the database. Send the rebuilt one back on an edit that never touched
 * the wire and `edit_grazing_move` sees the strip go backwards, because its
 * tolerance is a hundredth of a percentage point and the display's is a
 * tenth: ten times coarser.
 *
 * The farm this was reported from grazes in strips with fractions like
 * 0.8211121495327103 and 0.5191121495327102, so it is not a rare corner.
 */
describe("a wire the edit never touched", () => {
  /** The last stay in the paddock — the one whose wire continues from the
   *  one before it, which is where the round trip has to hold. */
  const openLast = async () => {
    await mount();
    openStay("Paddock 2");
    const edits = screen.getAllByText("Edit");
    fireEvent.click(edits[edits.length - 1]);
  };

  it("sends back the fraction that was stored, not one rebuilt from the display", async () => {
    events = [
      ev({ id: "e1", paddockId: "p2", enteredAt: "2026-08-01T12:00:00.000Z",
           exitedAt: "2026-08-02T12:00:00.000Z", sweptFrom: 0, sweptTo: 0.5191121495327102 }),
      ev({ id: "e2", paddockId: "p2", enteredAt: "2026-08-02T12:00:00.000Z",
           exitedAt: null, sweptFrom: 0.5191121495327102, sweptTo: 0.6745046728971962 }),
    ];
    await openLast();
    // Only the date is touched.
    fireEvent.change(screen.getByLabelText("They arrived"), { target: { value: "2026-08-02T09:00" } });
    fireEvent.click(screen.getByText("Save the correction"));
    await waitFor(() => expect(editMove).toHaveBeenCalled());
    expect(editMove.mock.calls[0][2]).toMatchObject({
      sweptFrom: 0.5191121495327102,
      sweptTo: 0.6745046728971962,
    });
  });

  it("still converts the percentage when somebody types one", async () => {
    events = [
      ev({ id: "e1", paddockId: "p2", enteredAt: "2026-08-01T12:00:00.000Z",
           exitedAt: null, sweptFrom: 0.5191121495327102, sweptTo: 0.6745046728971962 }),
    ];
    await openLast();
    fireEvent.change(screen.getByLabelText("Wire to, %"), { target: { value: "72" } });
    fireEvent.click(screen.getByText("Save the correction"));
    await waitFor(() => expect(editMove).toHaveBeenCalled());
    expect(editMove.mock.calls[0][2]).toMatchObject({
      sweptFrom: 0.5191121495327102,
      sweptTo: 0.72,
    });
  });

  it("clears a wire that is emptied rather than restoring the stored one", async () => {
    events = [
      ev({ id: "e1", paddockId: "p2", enteredAt: "2026-08-01T12:00:00.000Z",
           exitedAt: null, sweptFrom: 0.51, sweptTo: 0.67 }),
    ];
    await openLast();
    fireEvent.change(screen.getByLabelText("Wire from, %"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Wire to, %"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save the correction"));
    await waitFor(() => expect(editMove).toHaveBeenCalled());
    expect(editMove.mock.calls[0][2]).toMatchObject({ sweptFrom: null, sweptTo: null });
  });
});

/**
 * The wire, in yards.
 *
 * The record keeps a fraction of the sweep, because that survives a paddock
 * being remeasured. What anybody actually paced out is yards, so the editor
 * shows both and lets you type either. The fixture's paddocks sweep 500 ft —
 * 166.7 yd — end to end.
 */
describe("the strip in yards", () => {
  const openLast = async () => {
    await mount();
    openStay("Paddock 2");
    const edits = screen.getAllByText("Edit");
    fireEvent.click(edits[edits.length - 1]);
  };
  const yd = () => (screen.getByLabelText("Strip, yd") as HTMLInputElement).value;
  const wireTo = () => (screen.getByLabelText("Wire to, %") as HTMLInputElement).value;
  const wireFrom = () => (screen.getByLabelText("Wire from, %") as HTMLInputElement).value;

  beforeEach(() => {
    events = [
      ev({ id: "e1", paddockId: "p2", enteredAt: "2026-08-01T12:00:00.000Z",
           exitedAt: null, sweptFrom: 0.2, sweptTo: 0.5 }),
    ];
  });

  it("shows how far the wire moved, not just where it sits", async () => {
    // 0.5 − 0.2 of a 500 ft sweep is 150 ft, which is 50 yards.
    await openLast();
    expect(yd()).toBe("50");
  });

  it("says how long the whole sweep is, so the strip has something to be a part of", async () => {
    await openLast();
    expect(screen.getByText(/166.7 yd/)).toBeTruthy();
  });

  it("follows the percentage when the far wire is typed", async () => {
    await openLast();
    fireEvent.change(screen.getByLabelText("Wire to, %"), { target: { value: "80" } });
    expect(yd()).toBe("100");
  });

  it("follows the percentage when the near wire is typed", async () => {
    await openLast();
    fireEvent.change(screen.getByLabelText("Wire from, %"), { target: { value: "10" } });
    expect(yd()).toBe("66.7");
  });

  it("moves the far wire when yards are typed", async () => {
    // 25 yd is 75 ft of a 500 ft sweep: 15 percentage points on from 20.
    await openLast();
    fireEvent.change(screen.getByLabelText("Strip, yd"), { target: { value: "25" } });
    expect(wireTo()).toBe("35");
  });

  it("leaves the near wire alone, because the last strip put it there", async () => {
    await openLast();
    fireEvent.change(screen.getByLabelText("Strip, yd"), { target: { value: "25" } });
    expect(wireFrom()).toBe("20");
  });

  it("keeps what was typed rather than the figure that survives a round trip", async () => {
    // 23.4 yd is 14.04 percentage points of a 500 ft sweep, and the wire box
    // holds a tenth — so putting it through and back gives 23.3. The box has
    // to keep what the hand typed, or a digit disappears while you type it.
    await openLast();
    fireEvent.change(screen.getByLabelText("Strip, yd"), { target: { value: "23.4" } });
    expect(yd()).toBe("23.4");
    expect(wireTo()).toBe("34");
  });

  it("saves the wire the yards moved", async () => {
    await openLast();
    fireEvent.change(screen.getByLabelText("Strip, yd"), { target: { value: "25" } });
    fireEvent.click(screen.getByText("Save the correction"));
    await waitFor(() => expect(editMove).toHaveBeenCalled());
    expect(editMove.mock.calls[0][2]).toMatchObject({ sweptFrom: 0.2, sweptTo: 0.35 });
  });

  it("says when the yards run off the end of the paddock", async () => {
    await openLast();
    fireEvent.change(screen.getByLabelText("Strip, yd"), { target: { value: "160" } });
    expect(screen.getByText(/past the end of the paddock/)).toBeTruthy();
  });

  it("does not leave the yards behind when the paddock changes under them", async () => {
    // A different paddock is a different sweep, so the same wire is a
    // different number of yards. P1 here sweeps 300 ft — 100 yd.
    paddocks[0] = { ...paddocks[0], sweepLengthFt: 300 };
    await openLast();
    expect(yd()).toBe("50");
    fireEvent.change(screen.getByLabelText("Which paddock"), { target: { value: "p1" } });
    expect(yd()).toBe("30");
  });

  it("offers no yards at all on a paddock whose sweep is unknown", async () => {
    // Inventing a length would put a figure on screen that no fence supports.
    paddocks[1] = { ...paddocks[1], sweepLengthFt: null };
    await openLast();
    expect(screen.queryByLabelText("Strip, yd")).toBeNull();
    expect(screen.getByText(/has not got/)).toBeTruthy();
  });

  it("still sends an untouched wire back exactly as stored", async () => {
    // The yards field must not become a third way to coarsen the fraction.
    events = [
      ev({ id: "e1", paddockId: "p2", enteredAt: "2026-08-01T12:00:00.000Z",
           exitedAt: null, sweptFrom: 0.5191121495327102, sweptTo: 0.6745046728971962 }),
    ];
    await openLast();
    fireEvent.change(screen.getByLabelText("They arrived"), { target: { value: "2026-08-01T09:00" } });
    fireEvent.click(screen.getByText("Save the correction"));
    await waitFor(() => expect(editMove).toHaveBeenCalled());
    expect(editMove.mock.calls[0][2]).toMatchObject({
      sweptFrom: 0.5191121495327102,
      sweptTo: 0.6745046728971962,
    });
  });
});
