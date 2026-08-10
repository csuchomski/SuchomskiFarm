// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";
import type { MoneyEntry } from "../lib/animal-money";

/**
 * An animal's record, showing what she has cost and what she has returned —
 * and offering a way back to the list she was opened from.
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

const martha: RealAnimal = {
  id: "cow-2",
  ear_tag: "1",
  barn_name: "Martha",
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2021-03-02",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "beef",
  origin: "purchased",
  record_type: "herd",
};

const entry = (over: Partial<MoneyEntry> & { kind: MoneyEntry["kind"]; amountCents: number }): MoneyEntry => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-08-04",
  label: "Breeding and semen",
  note: "",
  source: "manual",
  isBasis: false,
  isInternalTransfer: false,
  ledgerTransactionId: null,
  ...over,
});

const money: MoneyEntry[] = [];

vi.mock("../lib/animal-money", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/animal-money")>()),
  fetchAnimalMoney: vi.fn(async () => money),
}));

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => [martha]),
  fetchAnimalByTag: vi.fn(async () => martha),
  fetchBreedComposition: vi.fn(async () => new Map()),
}));

vi.mock("../lib/genetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/genetics")>()),
  fetchMarkers: vi.fn(async () => []),
  fetchConditions: vi.fn(async () => []),
  fetchGenotypes: vi.fn(async () => []),
  fetchStatuses: vi.fn(async () => []),
  fetchConditionStatuses: vi.fn(async () => []),
}));

afterEach(() => {
  cleanup();
  money.length = 0;
});

const mount = async () => {
  const { default: AnimalRecord } = await import("./AnimalRecord");
  render(
    <MemoryRouter initialEntries={["/animals/1"]}>
      <Routes>
        <Route path="/animals/:tag" element={<AnimalRecord />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Pedigree");
};

describe("A way back to Animals", () => {
  it("is a link that says where it goes", async () => {
    await mount();
    const back = screen.getByRole("link", { name: /Animals/ });
    expect(back.getAttribute("href")).toBe("/animals");
  });
});

describe("Costs and revenue on her record", () => {
  it("says so plainly when nothing has been costed against her", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText(/Nothing costed against Martha yet/)).toBeTruthy());
  });

  it("shows revenue, the cost of running her, and the net", async () => {
    money.push(
      entry({ kind: "revenue", amountCents: 40000, label: "Live sale" }),
      entry({ kind: "cost", amountCents: 9500 }),
    );
    await mount();

    await waitFor(() => expect(screen.getByText("Revenue")).toBeTruthy());
    const totals = document.querySelector(".money-totals")!;
    expect(totals.textContent).toContain("$400.00");
    expect(totals.textContent).toContain("$95.00");
    expect(totals.textContent).toContain("+$305.00");
  });

  it("reports what she cost to buy beside the net rather than inside it", async () => {
    money.push(
      entry({ kind: "cost", amountCents: 70000, isBasis: true, label: "Purchase price / acquisition" }),
      entry({ kind: "cost", amountCents: 9500 }),
    );
    await mount();

    await waitFor(() => expect(screen.getByText("Cost to buy")).toBeTruthy());
    const totals = document.querySelector(".money-totals")!;
    // Net is −$95.00, not −$795.00: basis is capital, not a cost of the year.
    expect(totals.textContent).toContain("−$95.00");
    expect(totals.textContent).toContain("$700.00");
    expect(screen.getByText(/basis — what she cost to buy, not an expense/)).toBeTruthy();
  });

  it("marks revenue apart from cost in the list", async () => {
    money.push(
      entry({ kind: "revenue", amountCents: 40000, label: "Live sale" }),
      entry({ kind: "cost", amountCents: 9500 }),
    );
    await mount();

    await waitFor(() => expect(document.querySelectorAll(".money-row").length).toBe(2));
    const amounts = [...document.querySelectorAll(".money-row__amount")].map((n) => n.textContent);
    expect(amounts).toContain("+$400.00");
    expect(amounts).toContain("−$95.00");
  });

  it("says the totals are what was attributed, not the whole of every bill", async () => {
    money.push(entry({ kind: "cost", amountCents: 9500 }));
    await mount();
    await waitFor(() => expect(screen.getByText(/Attribution can be partial/)).toBeTruthy());
  });

  it("names where a row came from", async () => {
    money.push(
      entry({ kind: "cost", amountCents: 9500, source: "breeding", note: "AI service" }),
      entry({ kind: "cost", amountCents: 4200, label: "Feed", ledgerTransactionId: 91, note: "Feed store" }),
    );
    await mount();

    await waitFor(() => expect(document.querySelectorAll(".money-row").length).toBe(2));
    const list = document.querySelector(".money-list")!;
    expect(list.textContent).toContain("recorded by breeding");
    expect(list.textContent).toContain("from the ledger");
  });
});
