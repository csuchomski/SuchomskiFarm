// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";
import type { GrazingGroup, GrazingGroupMember } from "../lib/grazing";

/**
 * The herd, grouped by the mob it is worked in.
 *
 * Setting a herd up used to be two jobs in two places — enter the animal on
 * this page, then go to Grazing → Mobs and add her to one — and nothing on
 * either screen said the other existed. A farm could finish entering twenty
 * head and have no mob to move.
 *
 * So the mob is asked for where the animal is entered, made there if it does
 * not exist yet, and is the heading this list is grouped under. Dairy and
 * beef stay, because a milked cow and a suckler are run differently whichever
 * mob they are in — but they are a division *within* a mob now rather than
 * the shape of the whole page.
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

const animal = (over: Partial<RealAnimal> & { id: string; ear_tag: string }): RealAnimal =>
  ({
    barn_name: null, sex: "female", class: "cow", status: "active",
    birth_date: "2022-04-01", sire_id: null, dam_id: null, notes: null,
    // `origin` and `purpose` are both required to save, so a fixture without
    // them leaves the button disabled and every save assertion silently fails.
    purpose: "beef", origin: "born_on_farm", record_type: "herd",
    ...over,
  }) as RealAnimal;

let herd: RealAnimal[] = [];
let mobs: GrazingGroup[] = [];
let members: GrazingGroupMember[] = [];

const setAnimalMob = vi.fn<(f: string, a: string, g: string | null, on?: string) => Promise<void>>(
  async () => {},
);
const saveGrazingGroup = vi.fn<(f: string, d: { name: string }) => Promise<string>>(async () => "made");
const createAnimal = vi.fn(async (_farm: string, patch: Record<string, unknown>) =>
  animal({ id: "new", ear_tag: String(patch.ear_tag) }),
);
const updateAnimal = vi.fn(async (id: string, patch: Record<string, unknown>) =>
  animal({ id, ear_tag: String(patch.ear_tag) }),
);

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => herd),
  fetchBreedComposition: vi.fn(async () => new Map()),
  createAnimal: (...a: [string, Record<string, unknown>]) => createAnimal(...a),
  updateAnimal: (...a: [string, Record<string, unknown>]) => updateAnimal(...a),
}));

vi.mock("../lib/alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/alerts")>()),
  fetchAlertInputs: vi.fn(async () => null),
}));

vi.mock("../lib/grazing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/grazing")>()),
  fetchGrazingGroups: vi.fn(async () => mobs),
  fetchGroupMembers: vi.fn(async () => members),
  setAnimalMob,
  saveGrazingGroup,
}));

const mob = (id: string, name: string): GrazingGroup => ({
  id, name, species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null,
});

const memberOf = (animalId: string, groupId: string): GrazingGroupMember => ({
  id: `m-${animalId}`, groupId, animalId, joinedOn: "2026-08-01", leftOn: null,
});

beforeEach(() => {
  setAnimalMob.mockClear();
  saveGrazingGroup.mockClear();
  saveGrazingGroup.mockResolvedValue("made");
  createAnimal.mockClear();
  herd = [
    animal({ id: "a1", ear_tag: "101", barn_name: "Mercy", purpose: "dairy" }),
    animal({ id: "a2", ear_tag: "102", barn_name: "Bramble", purpose: "beef" }),
    animal({ id: "a3", ear_tag: "103", barn_name: "Juniper", purpose: "beef" }),
  ];
  mobs = [mob("main", "Main mob"), mob("weaners", "Weaners")];
  members = [memberOf("a1", "main"), memberOf("a2", "main"), memberOf("a3", "weaners")];
});

afterEach(cleanup);

const mount = async () => {
  const { default: Animals } = await import("./Animals");
  render(<MemoryRouter><Animals /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading herd…")).toBeNull());
};

/** Every mob heading on the page, in order. */
const headed = (): string[] =>
  [...document.querySelectorAll(".animals-mob__name")].map((n) => n.textContent ?? "");

/** A mob heading by name — the drop target and the picker both live on it. */
const heading = (name: string): HTMLElement =>
  [...document.querySelectorAll(".animals-mob")].find(
    (n) => n.querySelector(".animals-mob__name")?.textContent === name,
  ) as HTMLElement;

/** The block a mob heading opens, up to the next one. */
const rowsUnder = (mobName: string): string[] => {
  const heads = [...document.querySelectorAll(".animals-mob, .animals-group, .grid-row")];
  const start = heads.findIndex((n) => n.classList.contains("animals-mob") && n.textContent?.startsWith(mobName));
  const out: string[] = [];
  for (let i = start + 1; i < heads.length; i++) {
    if (heads[i].classList.contains("animals-mob")) break;
    const name = heads[i].querySelector(".serif")?.textContent;
    if (name) out.push(name);
  }
  return out;
};

describe("the herd, grouped by mob", () => {
  it("heads each mob and puts its animals under it", async () => {
    await mount();
    expect(rowsUnder("Main mob")).toEqual(expect.arrayContaining(["Mercy", "Bramble"]));
    expect(rowsUnder("Weaners")).toEqual(expect.arrayContaining(["Juniper"]));
    expect(rowsUnder("Main mob")).not.toContain("Juniper");
  });

  it("keeps dairy and beef as a division inside the mob", async () => {
    await mount();
    // Main mob holds one of each, so both side headings appear under it.
    const under = rowsUnder("Main mob");
    expect(under).toContain("Dairy");
    expect(under).toContain("Beef");
    // and Weaners is all beef, so it gets no side heading at all
    expect(rowsUnder("Weaners")).not.toContain("Beef");
  });

  it("gathers animals in no mob under a heading that says so", async () => {
    members = [memberOf("a1", "main")];
    await mount();
    expect(rowsUnder("Not in a mob")).toEqual(expect.arrayContaining(["Bramble", "Juniper"]));
  });

  it("heads nothing on a farm with no mobs at all", async () => {
    mobs = [];
    members = [];
    await mount();
    expect(document.querySelector(".animals-mob")).toBeNull();
    // and the list is still there, reading as it always did
    expect(screen.getByText("Mercy")).toBeTruthy();
  });

  it("keeps a 'Not in a mob' heading even when everybody is in one", async () => {
    // Otherwise there is nowhere to put an animal you want out of its mob,
    // and a farm can get animals into mobs but never back out.
    mobs = [mob("main", "Main mob")];
    members = herd.map((a) => memberOf(a.id, "main"));
    await mount();
    expect(headed()).toEqual(["Main mob", "Not in a mob"]);
  });

  it("heads a mob nobody is in yet, so a mob just made can be filled", async () => {
    members = herd.map((a) => memberOf(a.id, "main"));
    await mount();
    expect(headed()).toContain("Weaners");
  });

  it("heads a retired mob only while somebody is still in it", async () => {
    mobs = [mob("main", "Main mob"), { ...mob("old", "Last year's weaners"), active: false }];
    members = [memberOf("a1", "main")];
    await mount();
    expect(headed()).not.toContain("Last year's weaners");

    cleanup();
    members = [memberOf("a1", "main"), memberOf("a2", "old")];
    await mount();
    expect(headed()).toContain("Last year's weaners");
  });
});

describe("moving an animal between mobs", () => {
  it("moves her when she is dropped on another mob", async () => {
    await mount();
    const row = screen.getByText("Bramble").closest("a")!;
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    const target = [...document.querySelectorAll(".animals-mob")].find((n) =>
      n.textContent?.startsWith("Weaners"),
    )!;
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a2", "weaners"));
  });

  it("takes her out of every mob when dropped on the loose heading", async () => {
    members = [memberOf("a1", "main"), memberOf("a2", "main")];
    await mount();
    const row = screen.getByText("Mercy").closest("a")!;
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    const loose = [...document.querySelectorAll(".animals-mob")].find((n) =>
      n.textContent?.startsWith("Not in a mob"),
    )!;
    fireEvent.drop(loose);
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a1", null));
  });

  it("says so when the move is refused rather than looking like it worked", async () => {
    setAnimalMob.mockRejectedValueOnce(new Error("That mob is not on this farm."));
    await mount();
    const row = screen.getByText("Bramble").closest("a")!;
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    const target = [...document.querySelectorAll(".animals-mob")].find((n) =>
      n.textContent?.startsWith("Weaners"),
    )!;
    fireEvent.drop(target);
    await waitFor(() => expect(screen.getByText(/not on this farm/)).toBeTruthy());
  });

  it("drags on a farm with one mob, because in and out is still two places", async () => {
    mobs = [mob("main", "Main mob")];
    members = [memberOf("a1", "main")];
    await mount();
    expect(screen.getByText("Mercy").closest("a")!.getAttribute("draggable")).toBe("true");

    const row = screen.getByText("Mercy").closest("a")!;
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.drop(heading("Not in a mob"));
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a1", null));
  });

  it("puts an animal into a mob nobody is in yet", async () => {
    members = herd.map((a) => memberOf(a.id, "main"));
    await mount();
    const row = screen.getByText("Juniper").closest("a")!;
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.drop(heading("Weaners"));
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a3", "weaners"));
  });

  it("takes no drops into a retired mob", async () => {
    mobs = [mob("main", "Main mob"), { ...mob("old", "Last year's weaners"), active: false }];
    members = [memberOf("a1", "main"), memberOf("a2", "old")];
    await mount();
    const row = screen.getByText("Mercy").closest("a")!;
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.drop(heading("Last year's weaners"));
    expect(setAnimalMob).not.toHaveBeenCalled();
  });

  it("still lets an animal out of a retired mob", async () => {
    mobs = [mob("main", "Main mob"), { ...mob("old", "Last year's weaners"), active: false }];
    members = [memberOf("a1", "main"), memberOf("a2", "old")];
    await mount();
    const row = screen.getByText("Bramble").closest("a")!;
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    fireEvent.drop(heading("Not in a mob"));
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a2", null));
  });
});

describe("the same three jobs without a pointer", () => {
  /* Drag and drop does not happen on a phone — a touch never fires
     dragstart — and the barn is where this page gets opened. Every heading
     that takes a drop carries a picker that does the same job by tap. */

  const pick = (mobName: string, label: string, value: string) => {
    fireEvent.click(within(heading(mobName)).getByRole("button", { name: label }));
    fireEvent.change(within(heading(mobName)).getByRole("combobox"), { target: { value } });
  };

  it("adds an animal to a mob", async () => {
    await mount();
    pick("Weaners", "add an animal to Weaners", "a2");
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a2", "weaners"));
  });

  it("takes an animal out of every mob", async () => {
    await mount();
    pick("Not in a mob", "take an animal out of its mob", "a1");
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a1", null));
  });

  it("says which mob each candidate is in now, so the wrong cow is not moved", async () => {
    await mount();
    fireEvent.click(within(heading("Weaners")).getByRole("button", { name: "add an animal to Weaners" }));
    const options = [...within(heading("Weaners")).getByRole("combobox").querySelectorAll("option")]
      .map((o) => o.textContent);
    expect(options).toEqual(["Which one…", "Bramble · Main mob", "Mercy · Main mob"]);
  });

  it("offers only animals who are in a mob when taking one out", async () => {
    members = [memberOf("a1", "main")];
    await mount();
    fireEvent.click(
      within(heading("Not in a mob")).getByRole("button", { name: "take an animal out of its mob" }),
    );
    const options = [...within(heading("Not in a mob")).getByRole("combobox").querySelectorAll("option")]
      .map((o) => o.textContent);
    expect(options).toEqual(["Which one…", "Mercy · Main mob"]);
  });

  it("offers nothing to take out when nobody is in a mob", async () => {
    members = [];
    await mount();
    expect(
      within(heading("Not in a mob")).queryByRole("button", { name: "take an animal out of its mob" }),
    ).toBeNull();
  });

  it("backs out without moving anybody", async () => {
    await mount();
    fireEvent.click(within(heading("Weaners")).getByRole("button", { name: "add an animal to Weaners" }));
    fireEvent.click(within(heading("Weaners")).getByRole("button", { name: "cancel" }));
    expect(within(heading("Weaners")).queryByRole("combobox")).toBeNull();
    expect(setAnimalMob).not.toHaveBeenCalled();
  });

  it("offers the whole herd, not just what the search box left on screen", async () => {
    // Picking by name is an explicit choice. Offering only the filtered list
    // would look like animals had gone missing.
    await mount();
    fireEvent.change(screen.getByLabelText("Search animals"), { target: { value: "Mercy" } });
    fireEvent.click(within(heading("Weaners")).getByRole("button", { name: "add an animal to Weaners" }));
    const options = [...within(heading("Weaners")).getByRole("combobox").querySelectorAll("option")]
      .map((o) => o.textContent);
    expect(options).toContain("Bramble · Main mob");
  });
});

describe("setting the mob where the animal is entered", () => {
  const openForm = async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add animal" }));
    await waitFor(() => expect(screen.getByLabelText("Mob")).toBeTruthy());
  };

  it("offers the farm's mobs on the animal form", async () => {
    await openForm();
    const pick = screen.getByLabelText("Mob") as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual([
      "— not in a mob —", "Main mob", "Weaners", "+ a new mob…",
    ]);
  });

  it("puts the new animal in the mob that was picked", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Ear tag/), { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("Mob"), { target: { value: "weaners" } });
    fireEvent.click(screen.getByRole("button", { name: "Add animal" }));
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "new", "weaners"));
  });

  it("makes a mob on the spot, so the first animal a farm enters can bring one", async () => {
    mobs = [];
    await openForm();
    fireEvent.change(screen.getByLabelText(/Ear tag/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Mob"), { target: { value: "+new" } });
    fireEvent.change(screen.getByLabelText("Call the mob"), { target: { value: "Main mob" } });
    fireEvent.click(screen.getByRole("button", { name: "Add animal" }));

    await waitFor(() => expect(saveGrazingGroup).toHaveBeenCalled());
    expect(saveGrazingGroup.mock.calls[0][1]).toMatchObject({ name: "Main mob" });
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "new", "made"));
  });

  it("will not make a mob with no name", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Ear tag/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Mob"), { target: { value: "+new" } });
    fireEvent.click(screen.getByRole("button", { name: "Add animal" }));
    await waitFor(() => expect(screen.getByText("The new mob needs a name.")).toBeTruthy());
    expect(saveGrazingGroup).not.toHaveBeenCalled();
    expect(createAnimal).not.toHaveBeenCalled();
  });

  it("leaves the mob alone when none is picked", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Ear tag/), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add animal" }));
    await waitFor(() => expect(createAnimal).toHaveBeenCalled());
    expect(setAnimalMob).not.toHaveBeenCalled();
  });
});

describe("the way that works without a pointer", () => {
  it("keeps the mob editable on the animal, which is how it is done by keyboard", async () => {
    // Drag and drop is the quick way and the only way that needs a mouse.
    // The picker on the form is the one that has to keep working.
    const { AnimalForm } = await import("../components/herd/AnimalForm");
    render(
      <MemoryRouter>
        <AnimalForm
          animal={herd[0]}
          herd={herd}
          farmId="farm-1"
          mobs={mobs}
          mobId="main"
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );
    const pick = screen.getByLabelText("Mob") as HTMLSelectElement;
    expect(pick.value).toBe("main");
    fireEvent.change(pick, { target: { value: "weaners" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(setAnimalMob).toHaveBeenCalledWith("farm-1", "a1", "weaners"));
  });
});
