// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Paddock, Pasture, Property } from "../lib/grazing";

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

const property = (over: Partial<Property> & { id: string; name: string }): Property => ({
  code: null, acres: null, tenure: "owned", leaseEnds: null, notes: null, active: true, ...over,
});

const pasture = (over: Partial<Pasture> & { id: string; name: string }): Pasture => ({
  code: null, acres: null, notes: null, active: true, propertyId: null, boundary: null, ...over,
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

let properties: Property[] = [];
let pastures: Pasture[] = [];
let paddocks: Paddock[] = [];

// Typed so the argument assertions below are checked rather than cast. An
// untyped `vi.fn(async () => …)` has `calls: []`, and every `as [\u2026]` on it
// passes the test runner while failing the build.
type Edit = Record<string, unknown>;
const fetchProperties = vi.fn<(farmId: string) => Promise<Property[]>>(async () => properties);
const fetchPastures = vi.fn<(farmId: string) => Promise<Pasture[]>>(async () => pastures);
const fetchPaddocks = vi.fn<(farmId: string) => Promise<Paddock[]>>(async () => paddocks);
const savePasture = vi.fn<(farmId: string, id: string | null, edit: Edit) => Promise<string>>(
  async () => "new-pasture",
);
const savePaddock = vi.fn<(farmId: string, id: string | null, edit: Edit) => Promise<string>>(
  async () => "new-paddock",
);
const saveProperty = vi.fn<(farmId: string, id: string | null, edit: Edit) => Promise<string>>(
  async () => "new-property",
);
const deletePasture = vi.fn<(farmId: string, id: string) => Promise<void>>(async () => {});
const deletePaddock = vi.fn<(farmId: string, id: string) => Promise<void>>(async () => {});
const deleteProperty = vi.fn<(farmId: string, id: string) => Promise<void>>(async () => {});

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchProperties, fetchPastures, fetchPaddocks,
    saveProperty, savePasture, savePaddock,
    deleteProperty, deletePasture, deletePaddock,
  };
});

beforeEach(() => {
  [
    fetchProperties, fetchPastures, fetchPaddocks,
    saveProperty, savePasture, savePaddock,
    deleteProperty, deletePasture, deletePaddock,
  ].forEach((f) => f.mockClear());
  properties = [];
  saveProperty.mockResolvedValue("new-property");
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
  // H3 since properties arrived: a pasture is one level down from a place.
  const h = screen.getByText((_, el) => el?.textContent?.startsWith(heading) === true && el.tagName === "H3");
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
      { name: "River bottom", code: "RIV", acres: 38.25, notes: null, active: true, propertyId: null },
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
  it("is the first tab of Settings, ahead of everything else the farm is set up with", async () => {
    const { default: Settings } = await import("./Settings");
    render(<MemoryRouter><Settings /></MemoryRouter>);
    const tabs = [...document.querySelectorAll(".gr-tab")].map((t) => t.textContent);
    expect(tabs).toEqual([
      "Ground",
      "Mobs",
      "Grazing plan",
      "Breeds",
      "Accounts",
      "Schedules",
      "Payments",
      "Farm & people",
    ]);
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

describe("the strip direction, on a paddock that is drawn", () => {
  /** Paddock 1's real ring, from migration 044 — 533 ft across east–west. */
  const RING = {
    type: "Polygon",
    coordinates: [[
      [-88.41291314, 42.87833348], [-88.41299683, 42.87876087], [-88.41331173, 42.87882226],
      [-88.41412428, 42.87883078], [-88.41463922, 42.87873318], [-88.41489766, 42.87874084],
      [-88.41491083, 42.87833348], [-88.41291314, 42.87833348],
    ]],
  };

  it("measures the feet across off the boundary when a direction is picked", async () => {
    paddocks = [paddock({ id: "drawn", name: "Drawn one", pastureId: "home", boundary: RING })];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Drawn one" }));
    fireEvent.change(screen.getByLabelText("Strips run"), { target: { value: "270" } });
    // 044 measured 533 ft along due west, by hand, off this same ring.
    const across = Number((screen.getByLabelText("Feet across") as HTMLInputElement).value);
    expect(across).toBeGreaterThan(520);
    expect(across).toBeLessThan(545);
  });

  it("never overwrites a figure somebody measured with a wheel", async () => {
    paddocks = [
      paddock({ id: "drawn", name: "Drawn one", pastureId: "home", boundary: RING, sweepLengthFt: 400 }),
    ];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Drawn one" }));
    fireEvent.change(screen.getByLabelText("Strips run"), { target: { value: "270" } });
    expect((screen.getByLabelText("Feet across") as HTMLInputElement).value).toBe("400");
  });

  it("leaves it to be typed when there is nothing drawn to measure", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Paddock 2" }));
    fireEvent.change(screen.getByLabelText("Strips run"), { target: { value: "90" } });
    expect((screen.getByLabelText("Feet across") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/without it the same move is recorded as a share/)).toBeTruthy();
  });

  it("says the drawing will answer it, on a paddock that has one", async () => {
    paddocks = [paddock({ id: "drawn", name: "Drawn one", pastureId: "home", boundary: RING })];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Drawn one" }));
    expect(screen.getByText(/measured from it as soon as you pick a direction/)).toBeTruthy();
  });
});

describe("the level above the pasture", () => {
  /**
   * Green Pastures leases ground across a county: named places, each with
   * pastures on them. The place and the pasture are two different things
   * there, and a farm with one block of land must never be made to read
   * past a level that tells it nothing.
   */

  const band = (name: string) => {
    const h = screen.getByText(
      (_, el) => el?.textContent?.startsWith(name) === true && el.tagName === "H2",
    );
    return h.closest("section")!;
  };

  it("shows no property band at all on a farm that has none", async () => {
    // Which is every farm on file the day 064 runs.
    await mount();
    expect(document.querySelector(".gnd-property")).toBeNull();
    expect(screen.queryByText("Not on a property yet")).toBeNull();
    // And every pasture is still on the page, unbanded.
    expect(section("Home place")).toBeTruthy();
    expect(section("Rented forty")).toBeTruthy();
  });

  it("puts each pasture under the place it is on", async () => {
    properties = [property({ id: "vollmer", name: "The Vollmer place" })];
    pastures = [
      pasture({ id: "home", name: "Home place", propertyId: "vollmer" }),
      pasture({ id: "rented", name: "Rented forty" }),
    ];
    await mount();
    expect(within(band("The Vollmer place")).getByText("Home place")).toBeTruthy();
    expect(within(band("The Vollmer place")).queryByText("Rented forty")).toBeNull();
  });

  it("gathers pastures nobody has placed rather than guessing at one", async () => {
    properties = [property({ id: "vollmer", name: "The Vollmer place" })];
    pastures = [
      pasture({ id: "home", name: "Home place", propertyId: "vollmer" }),
      pasture({ id: "rented", name: "Rented forty" }),
    ];
    await mount();
    expect(screen.getByText("Not on a property yet")).toBeTruthy();
    expect(section("Rented forty")).toBeTruthy();
  });

  it("says what a place is held on, and until when", async () => {
    // The one thing nowhere else on the page says. Ground that goes back to
    // the landlord in eighteen months is not ground you reseed.
    properties = [
      property({ id: "v", name: "The Vollmer place", tenure: "leased", leaseEnds: "2028-03-01", acres: 214 }),
    ];
    pastures = [pasture({ id: "home", name: "Home place", propertyId: "v" })];
    await mount();
    const sub = band("The Vollmer place").querySelector(".gnd-property__sub")!;
    // Read as a date, not as the ISO string the server keeps.
    expect(sub.textContent).toMatch(/leased · until Mar 1, 2028 · 214 acres · 1 pasture/);
  });

  it("adds up the grazable acres of every paddock on the place", async () => {
    properties = [property({ id: "v", name: "The Vollmer place" })];
    pastures = [
      pasture({ id: "home", name: "Home place", propertyId: "v" }),
      pasture({ id: "rented", name: "Rented forty" }),
    ];
    paddocks = [
      paddock({ id: "a", name: "A", pastureId: "home", acresGrazable: 12.5 }),
      paddock({ id: "b", name: "B", pastureId: "home", acresGrazable: 7.25 }),
      // On another place, so it must not be counted here.
      paddock({ id: "c", name: "C", pastureId: "rented", acresGrazable: 40 }),
    ];
    await mount();
    expect(band("The Vollmer place").querySelector(".gnd-property__sub")!.textContent)
      .toMatch(/19\.75 grazable/);
  });

  it("says a place is empty rather than leaving a band over nothing", async () => {
    properties = [property({ id: "v", name: "The Vollmer place" })];
    pastures = [];
    paddocks = [];
    await mount();
    expect(within(band("The Vollmer place")).getByText("No pastures on this place yet.")).toBeTruthy();
  });

  it("adds a property with what was typed", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a property" }));
    fireEvent.change(screen.getByLabelText("Property name"), { target: { value: "  The Vollmer place " } });
    fireEvent.change(screen.getByLabelText("Tenure"), { target: { value: "leased" } });
    fireEvent.change(screen.getByLabelText("Lease ends"), { target: { value: "2028-03-01" } });
    fireEvent.change(screen.getByLabelText("Property acres"), { target: { value: "214" } });
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => expect(saveProperty).toHaveBeenCalled());
    expect(saveProperty.mock.calls[0]).toEqual([
      "farm-1", null,
      {
        name: "  The Vollmer place ", code: null, acres: 214,
        tenure: "leased", leaseEnds: "2028-03-01", notes: null, active: true,
      },
    ]);
  });

  it("offers no lease date on ground the farm owns", async () => {
    // The server nulls it out anyway, and a date box on owned land is a
    // figure that would go stale with nothing to correct it against.
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a property" }));
    expect(screen.queryByLabelText("Lease ends")).toBeNull();
    fireEvent.change(screen.getByLabelText("Tenure"), { target: { value: "shared" } });
    expect(screen.getByLabelText("Lease ends")).toBeTruthy();
  });

  it("offers no property picker on a pasture until there is a property", async () => {
    // A select with one option in it — "Not said yet" — is not a choice.
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a pasture" }));
    expect(screen.queryByLabelText("On which property")).toBeNull();
  });

  it("files a pasture under the place chosen for it", async () => {
    properties = [property({ id: "v", name: "The Vollmer place" })];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a pasture" }));
    fireEvent.change(screen.getByLabelText("Pasture name"), { target: { value: "River bottom" } });
    fireEvent.change(screen.getByLabelText("On which property"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => expect(savePasture).toHaveBeenCalled());
    expect(savePasture.mock.calls[0][2].propertyId).toBe("v");
  });

  it("opens the pasture form already on the place its button was pressed from", async () => {
    properties = [property({ id: "v", name: "The Vollmer place" })];
    pastures = [pasture({ id: "home", name: "Home place", propertyId: "v" })];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "add a pasture to The Vollmer place" }));
    expect((screen.getByLabelText("On which property") as HTMLSelectElement).value).toBe("v");
  });

  it("keeps the property a pasture is already on when it is edited", async () => {
    properties = [property({ id: "v", name: "The Vollmer place" })];
    pastures = [pasture({ id: "home", name: "Home place", propertyId: "v" })];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "edit Home place" }));
    expect((screen.getByLabelText("On which property") as HTMLSelectElement).value).toBe("v");
  });

  it("asks before removing a place", async () => {
    properties = [property({ id: "v", name: "The Vollmer place" })];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove The Vollmer place" }));
    expect(screen.getByRole("button", { name: "really remove The Vollmer place" })).toBeTruthy();
    expect(deleteProperty).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "really remove The Vollmer place" }));
    await waitFor(() => expect(deleteProperty).toHaveBeenCalledWith("farm-1", "v"));
  });
});
