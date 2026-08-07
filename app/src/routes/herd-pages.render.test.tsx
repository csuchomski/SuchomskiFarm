// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("../lib/sires", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sires")>()),
  fetchSemenLots: vi.fn(async () => lots),
  fetchSemenTransactions: vi.fn(async () => []),
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
    expect(screen.getByText("AI sire · not in the herd")).toBeTruthy();
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
