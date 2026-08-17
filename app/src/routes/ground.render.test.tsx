// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Paddock, Pasture } from "../lib/grazing";

/**
 * Settings → Ground: adding, changing and removing land.
 *
 * The three things worth pinning are the ones a form gets wrong quietly.
 *
 * **A paddock is added onto a pasture**, not next to one — if the pasture id
 * fails to reach the save, the hierarchy is a label rather than a fact.
 *
 * **Ground with history is retired, never removed.** The server refuses, and
 * the page has to carry that refusal to the farmer with the way out attached.
 * A page that swallowed it and said "couldn't save" would leave somebody
 * clicking remove forever.
 *
 * **An exact heading survives an edit.** The picker offers eight compass
 * points; the farm's own paddocks were measured off a KML and one of them is
 * not on any of the eight. Opening the form must not round it.
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

const pasture = (over: Partial<Pasture> & { id: string; name: string }): Pasture => ({
  code: null, acres: null, notes: null, active: true, boundary: null, ...over,
});

const paddock = (over: Partial<Paddock> & { id: string; name: string }): Paddock => ({
  pastureId: null, code: null, acresMeasured: 2, acresGrazable: 2, unitType: "permanent",
  sweepHeadingDeg: null, sweepLengthFt: null, rotationOrder: null, seedingDate: null,
  fenceType: null, ecologicalSite: null, soilMapUnit: null, noxiousSpecies: null,
  noxiousExtent: null,
  sensitive: { riparian: false, wetland: false, habitat: false, karst: false, highErosion: false },
  heavyUseNotes: null, boundary: null, active: true, notes: null,
  ...over,
});

let pastures: Pasture[] = [];
let paddocks: Paddock[] = [];

// Typed so the argument assertions below are checked rather than cast. An
// untyped `vi.fn(async () => …)` has `calls: []`, and every `as [\u2026]` on it
// passes the test runner while failing the build.
type Edit = Record<string, unknown>;
const fetchPastures = vi.fn<(farmId: string) => Promise<Pasture[]>>(async () => pastures);
const fetchPaddocks = vi.fn<(farmId: string) => Promise<Paddock[]>>(async () => paddocks);
const savePasture = vi.fn<(farmId: string, id: string | null, edit: Edit) => Promise<string>>(
  async () => "new-pasture",
);
const savePaddock = vi.fn<(farmId: string, id: string | null, edit: Edit) => Promise<string>>(
  async () => "new-paddock",
);
const deletePasture = vi.fn<(farmId: string, id: string) => Promise<void>>(async () => {});
const deletePaddock = vi.fn<(farmId: string, id: string) => Promise<void>>(async () => {});

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchPastures, fetchPaddocks, savePasture, savePaddock, deletePasture, deletePaddock,
  };
});

beforeEach(() => {
  [fetchPastures, fetchPaddocks, savePasture, savePaddock, deletePasture, deletePaddock].forEach((f) =>
    f.mockClear(),
  );
  savePasture.mockResolvedValue("new-pasture");
  savePaddock.mockResolvedValue("new-paddock");
  deletePaddock.mockResolvedValue(undefined);
  pastures = [
    pasture({ id: "home", name: "Home place", code: "HOME", acres: 62.5 }),
    pasture({ id: "rented", name: "Rented forty", acres: 40 }),
  ];
  paddocks = [
    paddock({ id: "p1", name: "Paddock 1", code: "P1", pastureId: "home", rotationOrder: 1,
              sweepHeadingDeg: 270, sweepLengthFt: 400, acresGrazable: 1.91 }),
    paddock({ id: "p2", name: "Paddock 2", pastureId: "home", rotationOrder: 2, acresGrazable: 3.2 }),
    paddock({ id: "old", name: "Old lot", acresGrazable: 5 }),
  ];
});

afterEach(cleanup);

const mount = async () => {
  const { default: Ground } = await import("./Ground");
  render(<MemoryRouter><Ground /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

/** The section a name heads, so a paddock can be located under its pasture
 *  rather than merely somewhere on the page. */
const section = (heading: string) => {
  const h = screen.getByText((_, el) => el?.textContent?.startsWith(heading) === true && el.tagName === "H2");
  return h.closest("section")!;
};

describe("the ground, as a hierarchy", () => {
  it("puts each paddock under the pasture it is on", async () => {
    await mount();
    const home = within(section("Home place"));
    expect(home.getByText("Paddock 1")).toBeTruthy();
    expect(home.getByText("Paddock 2")).toBeTruthy();
    expect(home.queryByText("Old lot")).toBeNull();
  });

  it("shows a pasture's deeded acres and what its paddocks actually add up to", async () => {
    await mount();
    // 62.5 deeded, two paddocks, 1.91 + 3.2 grazable.
    expect(section("Home place").textContent).toContain("62.5 acres");
    expect(section("Home place").textContent).toContain("2 paddocks");
    expect(section("Home place").textContent).toContain("5.11 grazable");
  });

  it("says a pasture is empty rather than leaving a heading over nothing", async () => {
    await mount();
    expect(section("Rented forty").textContent).toContain("Nothing fenced on this pasture yet");
  });

  it("gathers paddocks that predate pastures instead of guessing at one", async () => {
    await mount();
    const orphans = section("Not on a pasture yet");
    expect(within(orphans).getByText("Old lot")).toBeTruthy();
    expect(orphans.textContent).toContain("Edit one to say which piece of land it is on");
  });

  it("drops the unassigned group once every paddock is on a pasture", async () => {
    paddocks = paddocks.map((p) => ({ ...p, pastureId: "home" }));
    await mount();
    expect(screen.queryByText("Not on a pasture yet")).toBeNull();
  });

  it("says what to do first when there is no ground at all", async () => {
    pastures = [];
    paddocks = [];
    await mount();
    expect(screen.getByText(/No ground on file yet/)).toBeTruthy();
  });
});

describe("adding", () => {
  it("adds a pasture with what was typed, trimmed of nothing it should keep", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a pasture" }));
    fireEvent.change(screen.getByLabelText("Pasture name"), { target: { value: "River bottom" } });
    fireEvent.change(screen.getByLabelText("Pasture code"), { target: { value: "RIV" } });
    fireEvent.change(screen.getByLabelText("Pasture acres"), { target: { value: "38.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => expect(savePasture).toHaveBeenCalled());
    expect(savePasture.mock.calls[0]).toEqual([
      "farm-1", null,
      { name: "River bottom", code: "RIV", acres: 38.25, notes: null, active: true },
    ]);
  });

  it("adds a paddock onto the pasture whose button was pressed", async () => {
    await mount();
    // The "add a paddock" inside the Rented forty section, not the one above.
    fireEvent.click(screen.getByRole("button", { name: "add a paddock to Rented forty" }));
    fireEvent.change(screen.getByLabelText("Paddock name"), { target: { value: "West wire" } });
    fireEvent.change(screen.getByLabelText("Acres grazable"), { target: { value: "4.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => expect(savePaddock).toHaveBeenCalled());
    const [farm, id, edit] = savePaddock.mock.calls[0];
    expect([farm, id]).toEqual(["farm-1", null]);
    expect(edit.pastureId).toBe("rented");
    expect(edit.name).toBe("West wire");
    expect(edit.acresGrazable).toBe(4.5);
  });

  it("offers no paddock button before there is a pasture to put one on", async () => {
    pastures = [];
    paddocks = [];
    await mount();
    expect(screen.getByRole("button", { name: "Add a pasture" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a paddock" })).toBeNull();
  });

  it("keeps a blank name from being saved", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a pasture" }));
    expect(screen.getByRole("button", { name: "Add it" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("the strip axis, which is what makes a paddock strippable", () => {
  it("reads a heading back in words, not degrees", async () => {
    await mount();
    // The column is headed "Strips", so the cell is the direction and the
    // distance and nothing else — it wrapped to three lines when it repeated
    // the word.
    expect(section("Home place").textContent).toContain("west, 400 ft");
    expect(section("Home place").textContent).not.toContain("strips west");
  });

  it("says the strip setup under the name too, for the screen that hides those columns", async () => {
    await mount();
    // GridRow drops the last two cells below 640px. This page is edited from
    // a phone as often as a desk, and the strip axis is the reason to open it.
    const small = section("Home place").querySelectorAll(".gnd-onsmall");
    expect([...small].map((n) => n.textContent)).toContain("west · 400 ft across · no. 1");
  });

  it("says so when a paddock is taken whole", async () => {
    await mount();
    expect(section("Home place").textContent).toContain("taken whole");
  });

  it("keeps a measured heading that is not one of the eight", async () => {
    paddocks = [paddock({ id: "odd", name: "Odd corner", pastureId: "home", sweepHeadingDeg: 263 })];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Odd corner" }));
    const select = screen.getByLabelText("Strips run") as HTMLSelectElement;
    expect(select.value).toBe("263");
    expect(within(select).getByText("at 263° (as measured)")).toBeTruthy();
  });

  it("offers to leave a paddock unstripped", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Old lot" }));
    const select = screen.getByLabelText("Strips run") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(within(select).getByText("Not stripped — taken whole")).toBeTruthy();
  });
});

describe("removing ground the herd has been on", () => {
  it("carries the server's refusal to the farmer, with the way out attached", async () => {
    deletePaddock.mockRejectedValueOnce(
      new Error("This paddock has 7 recorded move(s) on it, so removing it would take them out of the record. Retire it instead."),
    );
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove Paddock 1" }));
    fireEvent.click(screen.getByRole("button", { name: "really remove Paddock 1" }));

    await waitFor(() => expect(screen.getByText(/7 recorded move/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Retire Paddock 1 instead" })).toBeTruthy();
  });

  it("retires it rather than deleting it, and takes it out of the round", async () => {
    deletePaddock.mockRejectedValueOnce(new Error("This paddock has 7 recorded move(s) on it."));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove Paddock 1" }));
    fireEvent.click(screen.getByRole("button", { name: "really remove Paddock 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retire Paddock 1 instead" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Retire Paddock 1 instead" }));
    await waitFor(() => expect(savePaddock).toHaveBeenCalled());
    const [, id, edit] = savePaddock.mock.calls[0];
    expect(id).toBe("p1");
    expect(edit.active).toBe(false);
    // A retired paddock left in the round would keep its number reserved and
    // hold up whatever should take its place.
    expect(edit.rotationOrder).toBeNull();
  });

  it("removes a paddock outright when nothing has happened on it", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove Old lot" }));
    fireEvent.click(screen.getByRole("button", { name: "really remove Old lot" }));
    await waitFor(() => expect(deletePaddock).toHaveBeenCalledWith("farm-1", "old"));
  });

  it("asks before removing anything", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove Old lot" }));
    expect(screen.getByRole("button", { name: "really remove Old lot" })).toBeTruthy();
    expect(deletePaddock).not.toHaveBeenCalled();
  });

  it("shows why a pasture holding paddocks will not go", async () => {
    deletePasture.mockRejectedValueOnce(
      new Error("This pasture still holds 2 paddock(s). Move them to another pasture, or remove them, first."),
    );
    await mount();
    // Named, because the pasture and every paddock under it offer a "remove".
    fireEvent.click(screen.getByRole("button", { name: "remove Home place" }));
    fireEvent.click(screen.getByRole("button", { name: "really remove Home place" }));
    await waitFor(() => expect(screen.getByText(/still holds 2 paddock/)).toBeTruthy());
  });
});

describe("putting retired ground back", () => {
  it("offers to bring it back rather than only to retire", async () => {
    paddocks = [paddock({ id: "p9", name: "Old lot", pastureId: "home", active: false })];
    await mount();
    expect(within(section("Home place")).getByText("retired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "put Old lot back in use" }));
    await waitFor(() => expect(savePaddock).toHaveBeenCalled());
    const [, , edit] = savePaddock.mock.calls[0];
    expect(edit.active).toBe(true);
  });
});

describe("where it lives", () => {
  it("is the first tab of Settings, ahead of Breeds", async () => {
    const { default: Settings } = await import("./Settings");
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const tabs = [...document.querySelectorAll(".gr-tab")].map((t) => t.textContent);
    expect(tabs).toEqual(["Ground", "Breeds"]);
    // Opening Settings lands on the ground rather than on the breed list.
    expect(document.querySelector(".gr-tab--on")!.textContent).toBe("Ground");
  });

  it("is where the read-only paddock board sends anyone wanting to change one", async () => {
    // The board is a board. Editing land from two places is how the two
    // disagree, so it points here instead of growing its own form.
    const src = (await import("./Grazing.tsx?raw")).default;
    expect(src).toContain('to="/settings?tab=ground"');
  });
});
