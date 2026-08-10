// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Render smoke tests for the two new herd pages.
 *
 * The logic in lib/genetics.ts and lib/sires.ts is covered by its own unit
 * tests; nothing there touches React. What those can't catch is a page that
 * throws on mount — a bad map over an undefined field, a component used
 * before it's defined — which typechecking and a build both happily allow.
 * That class of bug is exactly what reached production once already (see
 * workspace-session.test.tsx), so these mount the real components against
 * stubbed data and assert something from each section actually appears.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

const workspace = {
  loading: false,
  error: null,
  businesses: [business],
  business,
  modules: ["herd", "store", "books"],
  farmId: "farm-1",
  role: "owner",
  userId: "u1",
  migrated: true,
  setBusinessId: vi.fn(),
};

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => workspace,
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const animals = [
  {
    id: "cow-1",
    ear_tag: "0",
    barn_name: "Patience",
    sex: "female",
    class: "cow",
    status: "active",
    birth_date: "2020-07-04",
    sire_id: null,
    dam_id: null,
    notes: null,
    purpose: "dairy",
    origin: "purchased",
    record_type: "herd",
  },
  {
    id: "bull-1",
    ear_tag: "RT1",
    barn_name: "Chief",
    sex: "male",
    class: "bull",
    status: "active",
    birth_date: "2019-04-01",
    sire_id: null,
    dam_id: null,
    notes: null,
    purpose: "dairy",
    origin: "purchased",
    record_type: "reference",
  },
  {
    // A bull with no composition — Sunnybrook Patriot's real position, and
    // the reason a calf by him inherits nothing.
    id: "bull-2",
    ear_tag: "",
    barn_name: "Dutton",
    sex: "male",
    class: "bull",
    status: "active",
    birth_date: "2019-06-02",
    sire_id: null,
    dam_id: null,
    notes: null,
    purpose: "dairy",
    origin: "purchased",
    record_type: "reference",
  },
];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
}));

const conditions = [
  { id: "c1", code: "CVM", name: "Complex Vertebral Malformation", inheritance: "recessive", species_scope: "dairy" },
  { id: "c2", code: "JH1", name: "Jersey Haplotype 1", inheritance: "haplotype", species_scope: "dairy" },
];

vi.mock("../lib/genetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/genetics")>()),
  fetchConditions: vi.fn(async () => conditions),
  fetchConditionStatuses: vi.fn(async () => [
    { id: "s1", animal_id: "cow-1", condition_id: "c1", status: "carrier", source: "test", recorded_on: "2026-08-01" },
    { id: "s2", animal_id: "bull-1", condition_id: "c1", status: "carrier", source: "test", recorded_on: "2026-08-01" },
  ]),
  fetchMarkers: vi.fn(async () => [
    { id: "m1", animal_id: "cow-1", marker_code: "BETA_CASEIN", genotype: "A2A2", tested_on: null, source: "test" },
  ]),
  fetchBreeds: vi.fn(async () => [{ id: "b1", code: "JE", name: "Jersey", species_type: "dairy" }]),
}));

const lots = [
  {
    id: "lot-1",
    sire_id: "bull-1",
    naab_code: "7JE1234",
    unit_type: "conventional" as const,
    lot_code: "",
    tank: "A",
    canister: "3",
    cane: "7",
    straws_initial: 10,
    straws_remaining: 2,
    cost_per_straw_cents: 2500,
    purchase_date: "2026-01-01",
    supplier: "Select Sires",
    reorder_threshold: 3,
    active: true,
    notes: "",
  },
];

type SireDraft = import("../lib/sires").SireDraft;
const updateSire = vi.fn(async (_id: string, _d: SireDraft) => ({}) as never);

vi.mock("../lib/sires", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sires")>()),
  fetchSemenLots: vi.fn(async () => lots),
  fetchSemenTransactions: vi.fn(async () => []),
  fetchSireDraft: vi.fn(async () => ({
    barnName: "Chief",
    earTag: "RT1",
    naabCode: "",
    registrationNumber: "REG-9",
    birthDate: "2019-04-01",
    notes: "",
  })),
  updateSire: (id: string, d: SireDraft) => updateSire(id, d),
}));

// Sires now shows each bull's breed composition — a bull with none leaves his
// calves with none, so it belongs where the bulls are.
const herdBreeds = [
  { id: "je", code: "JE", name: "Jersey", species_type: "dairy", default_gestation_days: 279, active: true },
  { id: "an", code: "AN", name: "Angus", species_type: "beef", default_gestation_days: 283, active: true },
];

vi.mock("../lib/gestation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gestation")>()),
  fetchBreeds: vi.fn(async () => herdBreeds),
  fetchComposition: vi.fn(async () => [{ animal_id: "bull-1", breed_id: "je", percent: 100 }]),
  fetchOverrides: vi.fn(async () => []),
}));

afterEach(cleanup);

/** Mounts the page and waits for its data effect to settle. `settled` is a
 * string that only appears once the fetch has resolved — waiting on the
 * absence of "Loading…" isn't enough, because the shell around the page has
 * loading text of its own. */
const mount = async (Component: React.ComponentType, settled: string | RegExp) => {
  render(
    <MemoryRouter>
      <Component />
    </MemoryRouter>,
  );
  await screen.findByText(settled);
};

/** Sires, settled. "Semen lots" only renders once the fetch resolves. */
const mountSires = async () => {
  const { default: Sires } = await import("./Sires");
  await mount(Sires, "Semen lots");
};

describe("Genetics page", () => {
  it("renders the herd's markers and the conditions it carries", async () => {
    const { default: Genetics } = await import("./Genetics");
    await mount(Genetics, "Check a pairing");

    // "Genetics" is also the nav rail's link, so both are expected.
    expect(screen.getAllByText("Genetics").length).toBeGreaterThan(0);
    expect(screen.getByText("Check a pairing")).toBeTruthy();
    // A2A2 appears three times, all of them intended: the "A2A2" stat
    // tile's label, Patience's pill in the marker table, and the row in
    // the "Beta casein" spread box.
    expect(screen.getAllByText("A2A2")).toHaveLength(3);
    // CVM has two carriers, so it belongs in "Conditions in the herd".
    expect(screen.getAllByText("CVM").length).toBeGreaterThan(0);
    // JH1 has no carrier and must not be listed.
    expect(screen.queryByText("Jersey Haplotype 1")).toBeNull();
  });

  it("offers the reference bull as a sire but not as a dam", async () => {
    const { default: Genetics } = await import("./Genetics");
    await mount(Genetics, "Check a pairing");

    const sire = screen.getByRole("combobox", { name: /sire/i });
    const dam = screen.getByRole("combobox", { name: /dam/i });
    expect(sire.textContent).toContain("Chief");
    expect(dam.textContent).toContain("Patience");
    // A reference bull is not a dam, and not livestock either.
    expect(dam.textContent).not.toContain("Chief");
  });
});

describe("Sires page", () => {
  it("lists the sire, his straws and where the lot is stored", async () => {
    const { default: Sires } = await import("./Sires");
    await mount(Sires, "Semen lots");

    expect(screen.getAllByText("Sires").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chief").length).toBeGreaterThan(0);
    // Two AI bulls on file now, so this label is expected twice — one per
    // sire in the "New semen lot" picker's hint.
    expect(screen.getAllByText("AI sire · not in the herd").length).toBe(2);
    expect(screen.getByText("Tank A · can 3 · cane 7")).toBeTruthy();
  });

  it("marks a lot at its reorder point as low", async () => {
    // 2 straws left against a threshold of 3.
    const { default: Sires } = await import("./Sires");
    await mount(Sires, "Semen lots");
    expect(screen.getByText("low")).toBeTruthy();
  });

  it("values the tank on what's left, not what was bought", async () => {
    // 2 remaining × $25 = $50. Ten straws were bought; eight are spent.
    const { default: Sires } = await import("./Sires");
    await mount(Sires, "Semen lots");
    // Once on the "Inventory value" tile, once on the sire's own row.
    expect(screen.getAllByText("$50.00")).toHaveLength(2);
  });
});

describe("Sires · breeds on the bull", () => {
  it("shows each bull's breeds and marks the ones with none", async () => {
    await mountSires();
    // Chief has Jersey on file from the mock; Dutton has nothing, which is
    // Sunnybrook Patriot's real position.
    // "Jersey" also appears in the breed <select> the edit-and-breeds forms
    // build, so scope it to the row's own breeds cell.
    const breedCells = [...document.querySelectorAll(".sire-row__breeds")].map((c) => c.textContent);
    // The cell carries the breeds and the button that edits them.
    expect(breedCells.some((t) => t?.includes("Jersey"))).toBe(true);
    expect(screen.getByText("no breeds on file")).toBeTruthy();
    expect(document.querySelectorAll(".sire-row--needs-breeds").length).toBe(1);
  });

  it("says why a bull without breeds matters", async () => {
    await mountSires();
    expect(screen.getByText(/A bull with none leaves his calves with none/)).toBeTruthy();
  });

  it("opens a breed editor on the bull you pick", async () => {
    await mountSires();
    const buttons = screen.getAllByRole("button", { name: "set breeds" });
    fireEvent.click(buttons[0]);
    // The editor is the same one the animal record uses.
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
  });
});

describe("Sires · editing a bull", () => {
  it("fills the form from his record rather than from the list", async () => {
    await mountSires();
    fireEvent.click(screen.getAllByRole("button", { name: "edit" })[0]);
    // Read fresh, because the list doesn't carry a registration number — a
    // form filled from it would show blank and write that back.
    expect((await screen.findByDisplayValue("REG-9")).getAttribute("value")).toBe("REG-9");
    expect(screen.getByDisplayValue("Chief")).toBeTruthy();
  });

  it("saves the corrected details", async () => {
    await mountSires();
    fireEvent.click(screen.getAllByRole("button", { name: "edit" })[0]);
    await screen.findByDisplayValue("Chief");

    fireEvent.change(screen.getByDisplayValue("Chief"), { target: { value: "Chieftain" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSire).toHaveBeenCalledTimes(1));
    expect(updateSire.mock.calls[0][1]).toMatchObject({ barnName: "Chieftain", registrationNumber: "REG-9" });
  });

  it("has no purpose field — it follows his breeds", async () => {
    await mountSires();
    fireEvent.click(screen.getAllByRole("button", { name: "edit" })[0]);
    await screen.findByDisplayValue("Chief");
    // Maintaining the same fact in two places is what put a beef breed on a
    // bull recorded as dairy. See docs/migrations/033.
    expect(screen.queryByLabelText("Purpose")).toBeNull();
    expect(screen.getByText(/follows from his breeds rather than being a field/)).toBeTruthy();
  });

  it("won't take a birth date in the future", async () => {
    await mountSires();
    fireEvent.click(screen.getAllByRole("button", { name: "edit" })[0]);
    await screen.findByDisplayValue("Chief");

    fireEvent.change(screen.getByLabelText("Birth date"), { target: { value: "2099-01-01" } });
    expect(screen.getByText(/birth date is in the future/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
