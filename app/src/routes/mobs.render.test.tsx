// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { GrazingGroup, GrazingGroupMember, GroupDraft } from "../lib/grazing";
import type { RealAnimal } from "../lib/herd";

/**
 * Herd → Mobs.
 *
 * The page exists because `grazing_group_members` could be read and never
 * written, so an animal added to the herd was not in the mob and every figure
 * the grazing module produced was short by one. What is under test is mostly
 * that the roll is the roll: who can join, who cannot, and what the totals say
 * when somebody has no weight.
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

const animal = (over: Partial<RealAnimal> & { id: string }): RealAnimal =>
  ({
    ear_tag: over.id, barn_name: null, sex: "female", class: "cow", status: "active",
    birth_date: "2022-01-01", sire_id: null, dam_id: null, notes: null,
    purpose: "beef", origin: "purchased", record_type: "herd", ...over,
  }) as RealAnimal;

let animals: RealAnimal[] = [];
let groups: GrazingGroup[] = [];
let members: GrazingGroupMember[] = [];
const weights = new Map<string, number>();

const saved = vi.fn(async (_f: string, _d: GroupDraft) => "g-new");
const added = vi.fn(async (_i: unknown) => "m-new");
const removed = vi.fn(async (_f: string, _id: string, _on: string) => undefined);

vi.mock("../lib/herd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/herd")>();
  return { ...actual, fetchAnimals: vi.fn(async () => animals) };
});

vi.mock("../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grazing")>();
  return {
    ...actual,
    fetchGrazingGroups: vi.fn(async () => groups),
    fetchGroupMembers: vi.fn(async () => members),
    fetchLatestWeights: vi.fn(async () => weights),
    saveGrazingGroup: saved,
    addToGroup: added,
    removeFromGroup: removed,
  };
});

const mob = (over: Partial<GrazingGroup> = {}): GrazingGroup => ({
  id: "mob", name: "Main mob", species: "cattle", class: "mixed",
  headCountManual: null, avgWeightLbManual: null, active: true, notes: null, ...over,
});

const member = (id: string, animalId: string, over: Partial<GrazingGroupMember> = {}): GrazingGroupMember => ({
  id, groupId: "mob", animalId, joinedOn: "2026-04-01", leftOn: null, animalStatus: "active", ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  animals = [];
  groups = [];
  members = [];
  weights.clear();
  saved.mockClear();
  added.mockClear();
  removed.mockClear();
});

const mount = async () => {
  const { default: Mobs } = await import("./Mobs");
  render(<MemoryRouter><Mobs /></MemoryRouter>);
  // queryAllBy, not queryBy: pages folded into others bring their own
  // loading state, and queryByText throws when it finds more than one.
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

/** The farm as it actually is: five head, four AI bulls on file as pedigree. */
const theFarm = () => {
  animals = [
    animal({ id: "a1", barn_name: "Patience" }),
    animal({ id: "a2", barn_name: "Martha" }),
    animal({ id: "a3", barn_name: "Vera", class: "heifer" }),
    animal({ id: "a4", barn_name: "Abigail", class: "heifer" }),
    animal({ id: "a5", barn_name: "Mercy", class: "heifer" }),
    animal({ id: "b1", barn_name: "Overalls", sex: "male", class: "bull", record_type: "reference" }),
    animal({ id: "b2", barn_name: "Dutton", sex: "male", class: "bull", record_type: "reference" }),
  ];
  groups = [mob()];
  members = [member("m1", "a1"), member("m2", "a2"), member("m3", "a3"), member("m4", "a4")];
  weights.set("a1", 900); weights.set("a2", 1000);
  weights.set("a3", 850); weights.set("a4", 1000); weights.set("a5", 950);
};

const options = () =>
  [...(screen.getByLabelText("Who joins") as HTMLSelectElement).options].map((o) => o.textContent);

describe("who is on the grass", () => {
  it("counts the mob and totals what they weigh", async () => {
    theFarm();
    await mount();
    expect(screen.getByText(/4 head/)).toBeTruthy();
    expect(screen.getByText(/3,750 lb/)).toBeTruthy(); // 900 + 1,000 + 850 + 1,000
  });

  it("says who is on the farm and in no mob, because nothing counts them", async () => {
    theFarm();
    await mount();
    expect(screen.getByText(/On the farm and in no mob: Mercy · a5/)).toBeTruthy();
  });

  it("does not offer an AI bull as somebody to put on grass", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Add an animal"));
    const shown = options().join(" ");
    expect(shown).toContain("Mercy");
    expect(shown).not.toContain("Overalls");
    expect(shown).not.toContain("Dutton");
  });

  it("does not offer somebody already in a mob", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Add an animal"));
    expect(options().join(" ")).not.toContain("Patience");
  });

  it("leaves a sold animal off the list", async () => {
    theFarm();
    animals = animals.map((a) => (a.id === "a5" ? { ...a, status: "sold" } : a));
    await mount();
    fireEvent.click(screen.getByText("Add an animal"));
    expect(options().join(" ")).not.toContain("Mercy");
  });

  it("says how many are unweighed rather than quietly totalling the rest", async () => {
    theFarm();
    weights.delete("a3");
    await mount();
    expect(screen.getByText(/1 unweighed/)).toBeTruthy();
    expect(screen.getByText(/no weight on file/)).toBeTruthy();
  });

  it("says nobody is weighed rather than showing nought pounds", async () => {
    theFarm();
    weights.clear();
    await mount();
    expect(screen.getByText(/nobody weighed/)).toBeTruthy();
  });
});

describe("putting an animal in", () => {
  it("adds her as of today, and hands the roll over so it can be checked", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Add an animal"));
    fireEvent.change(screen.getByLabelText("Who joins"), { target: { value: "a5" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => expect(added).toHaveBeenCalledTimes(1));
    expect(added.mock.calls[0][0]).toMatchObject({
      farmId: "farm-1", groupId: "mob", animalId: "a5", joinedOn: "2026-08-14",
    });
    // The membership list goes with it: the database has no unique index on an
    // open membership, so the check that she is not already in one is the
    // app's to make, and it cannot make it without the roll.
    expect((added.mock.calls[0][0] as { members: unknown[] }).members).toHaveLength(4);
  });

  it("will not add nobody", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Add an animal"));
    expect((screen.getByText("Add") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so when the save is refused, rather than looking like it worked", async () => {
    theFarm();
    added.mockRejectedValueOnce(new Error("She is in another mob. Take her out of that one first."));
    await mount();
    fireEvent.click(screen.getByText("Add an animal"));
    fireEvent.change(screen.getByLabelText("Who joins"), { target: { value: "a5" } });
    fireEvent.click(screen.getByText("Add"));
    await screen.findByText(/She is in another mob/);
  });

  it("says there is nobody left to add rather than offering an empty picker", async () => {
    theFarm();
    members = [...members, member("m5", "a5")];
    await mount();
    fireEvent.click(screen.getByText("Add an animal"));
    expect(screen.getByText(/Everything on the farm is already in a mob/)).toBeTruthy();
  });
});

describe("taking one out", () => {
  it("dates her leaving rather than removing the row", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getAllByText("Take out")[0]);
    await waitFor(() => expect(removed).toHaveBeenCalledTimes(1));
    expect(removed.mock.calls[0][1]).toBe("m1");
    expect(removed.mock.calls[0][2]).toBe("2026-08-14");
  });

  it("leaves an animal who has already left out of the count", async () => {
    theFarm();
    members = [...members, member("m5", "a5", { leftOn: "2026-08-01" })];
    await mount();
    expect(screen.getByText(/4 head/)).toBeTruthy();
  });
});

describe("starting and editing a mob", () => {
  it("says there is nothing to move when no mob is on file", async () => {
    animals = [animal({ id: "a1", barn_name: "Patience" })];
    await mount();
    expect(screen.getByText(/No mob on file, so nothing can be moved/)).toBeTruthy();
  });

  it("writes a new one", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Start a mob"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bull pen" } });
    fireEvent.change(screen.getByLabelText("Class"), { target: { value: "steers" } });
    fireEvent.click(screen.getByText("Start it"));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0][1]).toMatchObject({
      id: null, name: "Bull pen", species: "cattle", class: "steers", active: true,
    });
  });

  it("will not write one with no name", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Start a mob"));
    expect((screen.getByText("Start it") as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits in place rather than making a second one", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "The girls" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0][1]).toMatchObject({ id: "mob", name: "The girls" });
  });

  it("never sends a manual head count, which would override the roll", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0][1].headCountManual).toBeNull();
    expect(saved.mock.calls[0][1].avgWeightLbManual).toBeNull();
  });

  it("stands a mob down instead of deleting it", async () => {
    theFarm();
    await mount();
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByLabelText("Still running"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0][1].active).toBe(false);
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("marks a mob that is no longer running", async () => {
    theFarm();
    groups = [mob({ active: false })];
    await mount();
    expect(screen.getByText(/not running/)).toBeTruthy();
  });
});
