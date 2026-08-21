// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";

/**
 * One animal's record, rearranged.
 *
 * It used to be two columns of sections in no particular order — breeding,
 * notes, lactation, money, weights — with the family in a 348px sidebar. What
 * it could not tell you was the order things happened in, or what she is
 * giving now.
 *
 * So: her life along a line first, then her milk, then what she has cost, then
 * where she came from. Genetics moved to a tab of its own, which is also what
 * keeps it from being fetched by everyone who opens a cow.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd", "store"], farmId: "farm-1", role: "owner",
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
    birth_date: "2020-07-04", purpose: "dairy", origin: "purchased",
    record_type: "herd", sire_id: null, dam_id: null, notes: null,
    ...over,
  }) as RealAnimal;

const patience = animal({ id: "a1", ear_tag: "0", barn_name: "Patience" });
const vera = animal({ id: "a2", ear_tag: "2", barn_name: "Vera", birth_date: "2024-07-09", dam_id: "a1", class: "heifer" });

let herd: RealAnimal[] = [];
const geneticsMounted = vi.fn();

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimalByTag: vi.fn(async (tag: string) => herd.find((a) => a.ear_tag === tag) ?? null),
  fetchAnimals: vi.fn(async () => herd),
  fetchBreedComposition: vi.fn(async () => new Map([["a1", [{ breedId: "b1", name: "Jersey", percent: 100 }]]])),
}));

vi.mock("../lib/repro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/repro")>()),
  fetchCalvings: vi.fn(async () => [{ id: "c1", dam_id: "a1", date: "2024-07-09", is_twin: false }]),
}));

vi.mock("../lib/lactations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/lactations")>()),
  // Whole rows, not the three fields the timeline reads: LactationSection
  // renders the same list and reaches for termination_reason, which is NOT
  // NULL in the database and so is never absent on a real row.
  fetchLactations: vi.fn(async () => [
    { id: "l1", animal_id: "a1", lactation_number: 1, fresh_date: "2024-07-09", dry_off_date: "2026-08-06",
      calving_id: "c1", peak_milk_lb: 41, peak_dim: 62, total_yield_lb: 12400, me305_lb: null, termination_reason: "" },
    { id: "l3", animal_id: "a1", lactation_number: 3, fresh_date: "2026-08-06", dry_off_date: null,
      calving_id: null, peak_milk_lb: null, peak_dim: null, total_yield_lb: null, me305_lb: null, termination_reason: "" },
  ]),
}));

vi.mock("../lib/breedings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/breedings")>()),
  fetchBreedings: vi.fn(async () => [
    { id: "b1", animal_id: "a1", date: "2023-07-01", method: "ai", voided: false },
    { id: "b2", animal_id: "a1", date: "2023-09-26", method: "ai", voided: false },
  ]),
  fetchBreedingCosts: vi.fn(async () => new Map()),
}));

vi.mock("../lib/grazing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/grazing")>()),
  fetchWeighings: vi.fn(async () => [
    { id: "w1", animalId: "a1", date: "2026-08-14", weightLb: 900, weightType: "scale", notes: null },
  ]),
}));

// Two milkings on file: one whose batch is still in the shop, one whose
// batch is gone — the difference between stock and a sale.
vi.mock("../lib/milkings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/milkings")>()),
  fetchProductionRecords: vi.fn(async () => [
    { id: "p1", animal_id: "a1", product_id: 1, product_name: "Milk", quantity: 4.2, unit: "gallon", produced_date: "2026-08-19", batch_id: 11, note: "" },
    { id: "p2", animal_id: "a1", product_id: 1, product_name: "Milk", quantity: 4.6, unit: "gallon", produced_date: "2026-08-21", batch_id: 13, note: "" },
    { id: "p3", animal_id: "a9", product_id: 1, product_name: "Milk", quantity: 9.9, unit: "gallon", produced_date: "2026-08-21", batch_id: 14, note: "" },
  ]),
}));

// 19 Aug: the batch is gone, so the day sold. 21 Aug: 4.6 still in the tank,
// 2 of it promised to an open order.
vi.mock("../lib/animal-milk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/animal-milk")>()),
  fetchMilkContext: vi.fn(async () => ({
    priceCents: 1000,
    productId: 1,
    onHand: new Map([["2026-08-21", { quantity: 4.6, reserved: 2 }]]),
    binned: new Map<string, number>(),
    soldOn: new Map([["2026-08-19", ["2026-08-20"]]]),
  })),
}));

vi.mock("../lib/animal-money", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/animal-money")>()),
  fetchAnimalMoney: vi.fn(async () => []),
}));

vi.mock("../lib/depreciation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/depreciation")>()),
  fetchValuations: vi.fn(async () => []),
}));

vi.mock("../components/herd/GeneticsSection", () => ({
  GeneticsSection: () => {
    geneticsMounted();
    return <div>her markers</div>;
  },
}));

vi.mock("../lib/local-time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/local-time")>()),
  todayLocal: () => "2026-08-21",
}));

beforeEach(() => {
  herd = [patience, vera];
  geneticsMounted.mockClear();
});
afterEach(cleanup);

/** A real route, because the page reads her tag off the URL. */
const mount = async (tag = "0") => {
  const { default: AnimalRecord } = await import("./AnimalRecord");
  render(
    <MemoryRouter initialEntries={[`/animals/${tag}`]}>
      <Routes>
        <Route path="/animals/:tag" element={<AnimalRecord />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

describe("the four figures at the top", () => {
  it("leads with breed, age, weight and where she is in her year", async () => {
    await mount();
    const stats = document.querySelector(".record-head__stats")!;
    expect(within(stats as HTMLElement).getByText("Jersey")).toBeTruthy();
    expect(within(stats as HTMLElement).getByText("900")).toBeTruthy();
    expect(stats.textContent).toContain("Weighed 14 Aug 2026");
    // Fresh on 6 Aug, read on 21 Aug.
    expect(stats.textContent).toContain("In milk · lactation 3");
    expect(within(stats as HTMLElement).getByText("15")).toBeTruthy();
  });
});

describe("her life, along a line", () => {
  it("runs from birth to the end that has not happened", async () => {
    await mount();
    const steps = [...document.querySelectorAll(".life__title")].map((n) => n.textContent);
    expect(steps).toEqual([
      "Born",
      "First service",
      "First calf",
      "Lactation 1",
      "Lactation 3",
      "Sold or processed",
    ]);
  });

  it("marks the lactation she is in now, and only that", async () => {
    await mount();
    const now = document.querySelectorAll(".life__step--now");
    expect(now).toHaveLength(1);
    expect(now[0].textContent).toContain("Lactation 3");
  });

  it("names the calf a calving produced", async () => {
    await mount();
    expect(screen.getByText("Vera, a heifer")).toBeTruthy();
  });
});

describe("her milk", () => {
  it("says what became of each day, and when it sold", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("19 Aug 2026")).toBeTruthy());
    // Read off the rows themselves: "Sold" is also a stat-tile label, and
    // the status is deliberately in the row twice — once in its own column
    // and once under the date, for the phone where that column is dropped.
    const rows = [...document.querySelectorAll(".milk-table .grid-row--body")];
    const nineteenth = rows.find((r) => r.textContent?.includes("19 Aug 2026"))!;
    const twentyFirst = rows.find((r) => r.textContent?.includes("21 Aug 2026"))!;
    // 19 Aug's batch is gone and one pickup drew from that day alone, so the
    // day is sold and dated. 21 Aug is still in the tank, part of it promised.
    expect(nineteenth.textContent).toContain("4.2 sold 20 Aug");
    expect(nineteenth.textContent).toContain("$42.00");
    expect(twentyFirst.textContent).toContain("2 promised");
    expect(twentyFirst.textContent).toContain("2.6 in the tank");
    expect(twentyFirst.textContent).toContain("$46.00");
  });

  it("leaves another cow's milking off her page", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("19 Aug 2026")).toBeTruthy());
    expect(screen.queryByText("9.9")).toBeNull();
  });

  it("changes the window when a different range is asked for", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText("19 Aug 2026")).toBeTruthy());
    expect(screen.getByText(/30 days to 21 Aug 2026/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    expect(screen.getByText(/7 days to 21 Aug 2026/)).toBeTruthy();
    // 19 Aug is still inside seven days; a 60-day window would reach further
    // back but there is nothing older on file.
    expect(screen.getByText("19 Aug 2026")).toBeTruthy();
  });

  it("keeps the milk off a beef cow, who has none", async () => {
    herd = [animal({ id: "a3", ear_tag: "7", barn_name: "Martha", purpose: "beef" })];
    await mount("7");
    expect(screen.queryByText("Milk")).toBeNull();
  });
});

describe("genetics, on its own tab", () => {
  it("offers the two tabs, opening on the record", async () => {
    await mount();
    expect([...document.querySelectorAll(".gr-tab")].map((t) => t.textContent)).toEqual([
      "Record",
      "Genetics",
    ]);
    expect(document.querySelector(".gr-tab--on")!.textContent).toBe("Record");
  });

  it("does not fetch her markers until the tab is opened", async () => {
    // The reason it is a tab rather than a section: everyone who opens a cow
    // was paying for the genetics read, and almost nobody was looking.
    await mount();
    expect(geneticsMounted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Genetics" }));
    expect(geneticsMounted).toHaveBeenCalled();
    expect(screen.getByText("her markers")).toBeTruthy();
  });

  it("puts the record's own sections away while genetics is open", async () => {
    await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Genetics" }));
    expect(screen.queryByText("What she has done")).toBeNull();
  });
});
