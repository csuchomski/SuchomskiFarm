// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";
import type { MoneyEntry } from "../lib/animal-money";
import type { Valuation } from "../lib/depreciation";

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

/** An AI bull: reached from Sires, and not on the Animals list at all. */
const dutton: RealAnimal = {
  ...martha,
  id: "ai-1",
  ear_tag: "250JE2379",
  barn_name: "Dutton",
  sex: "male",
  class: "bull",
  purpose: "dairy",
  record_type: "reference",
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

const valuations: Valuation[] = [];

vi.mock("../lib/depreciation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/depreciation")>()),
  fetchValuations: vi.fn(async () => valuations),
}));

vi.mock("../lib/animal-money", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/animal-money")>()),
  fetchAnimalMoney: vi.fn(async () => money),
}));

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => [martha, dutton]),
  fetchAnimalByTag: vi.fn(async (tag: string) => [martha, dutton].find((a) => a.ear_tag === tag) ?? null),
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
  valuations.length = 0;
});

const mount = async (tag = "1") => {
  const { default: AnimalRecord } = await import("./AnimalRecord");
  render(
    <MemoryRouter initialEntries={[`/animals/${tag}`]}>
      <Routes>
        <Route path="/animals/:tag" element={<AnimalRecord />} />
      </Routes>
    </MemoryRouter>,
  );
  // The record tab opens on the animal's life, so this is the sentinel for
  // "the page has finished loading" now. The pronoun follows `sex`, so a bull
  // says "he" — which is the whole point, and was what this test caught when
  // it was still hard-coded to "she".
  await screen.findByText(/What (she|he) has done/);
};

describe("A way back", () => {
  it("goes to Animals from a cow's record", async () => {
    await mount();
    const back = screen.getByRole("link", { name: /← Animals/ });
    expect(back.getAttribute("href")).toBe("/animals");
    expect(document.querySelector(".record-topbar .eyebrow")?.textContent).toBe("Herd · Animals · Martha");
  });

  it("goes to Sires from a bull's record, which is where he was opened from", async () => {
    await mount("250JE2379");
    const back = screen.getByRole("link", { name: /← Sires/ });
    expect(back.getAttribute("href")).toBe("/sires");
    // Animals would be a link to a page he isn't on: reference bulls are kept
    // off that list on purpose.
    expect(screen.queryByRole("link", { name: /← Animals/ })).toBeNull();
    expect(document.querySelector(".record-topbar .eyebrow")?.textContent).toBe("Herd · Sires · Dutton");
  });
});

describe("What she is carried at", () => {
  it("says why the roll doesn't speak for her, beside the net rather than in a section", async () => {
    // Martha is a beef cow — the herd roll covers the dairy string. It used
    // to be a section of its own; a valuation is one line, not a heading.
    await mount();
    await waitFor(() =>
      expect(screen.getByText(/the herd roll covers the dairy string; anyone else is valued by hand/)).toBeTruthy(),
    );
  });

  it("shows what the roll carries her at when it has marked her", async () => {
    valuations.push(
      { id: "v2", animalId: "cow-2", asOf: "2026-08-10", valueCents: 142458, basis: "marked", note: "" },
      { id: "v1", animalId: "cow-2", asOf: "2025-08-10", valueCents: 179601, basis: "marked", note: "" },
    );
    await mount();

    // Nothing is costed against Martha, so the carried figure stands on its
    // own rather than beside a net there is no arithmetic for.
    await waitFor(() => expect(screen.getByText("Carried at")).toBeTruthy());
    const aside = document.querySelector(".money-answer__aside")!;
    // The newest figure. The year-on-year movement is Depreciation's job —
    // this page says what she is worth, not how she got there.
    expect(aside.textContent).toContain("$1,424.58");
    expect(aside.textContent).not.toContain("$1,796.01");
  });

  it("keeps another animal's valuations off her page", async () => {
    valuations.push({ id: "v9", animalId: "someone-else", asOf: "2026-08-10", valueCents: 500000, basis: "marked", note: "" });
    await mount();
    await waitFor(() => expect(screen.getByText(/valued by hand/)).toBeTruthy());
    expect(document.querySelector(".money-answer__aside")!.textContent).not.toContain("$5,000.00");
  });
});

describe("What she has cost and earned", () => {
  /** The two ledgers, not the answer panel beside them. */
  const books = () => [...document.querySelectorAll(".money-book")].map((n) => n.textContent).join(" ");

  it("says so plainly when nothing has been costed against her", async () => {
    await mount();
    await waitFor(() => expect(screen.getByText(/Nothing costed against Martha yet/)).toBeTruthy());
  });

  it("keeps what she earned and what she cost in columns of their own", async () => {
    money.push(
      entry({ kind: "revenue", amountCents: 40000, label: "Live sale" }),
      entry({ kind: "cost", amountCents: 9500 }),
    );
    await mount();

    await waitFor(() => expect(screen.getByText("Earned")).toBeTruthy());
    expect(books()).toContain("Live sale");
    expect(books()).toContain("$400.00");
    expect(books()).toContain("$95.00");
  });

  it("answers the question the two columns are asked for", async () => {
    money.push(
      entry({ kind: "revenue", amountCents: 40000, label: "Live sale" }),
      entry({ kind: "cost", amountCents: 9500 }),
    );
    await mount();

    await waitFor(() => expect(screen.getByText("She is ahead by")).toBeTruthy());
    expect(document.querySelector(".money-answer__value")!.textContent).toBe("$305.00");
  });

  it("says she is behind when she is, without a minus sign to miss", async () => {
    money.push(entry({ kind: "cost", amountCents: 9500 }));
    await mount();
    await waitFor(() => expect(screen.getByText("She is behind by")).toBeTruthy());
    expect(document.querySelector(".money-answer__value")!.textContent).toBe("$95.00");
  });

  it("reports what she cost to buy beside the net rather than inside it", async () => {
    money.push(
      entry({ kind: "cost", amountCents: 70000, isBasis: true, label: "Purchase price / acquisition" }),
      entry({ kind: "cost", amountCents: 9500 }),
    );
    await mount();

    await waitFor(() => expect(screen.getByText("Cost to buy")).toBeTruthy());
    const answer = document.querySelector(".money-answer")!;
    // Behind by $95.00, not $795.00: basis is capital, not a cost of the year.
    expect(document.querySelector(".money-answer__value")!.textContent).toBe("$95.00");
    expect(answer.textContent).toContain("$700.00");
    expect(answer.textContent).toContain("not an expense, so not in the net");
    // and it is nowhere in the cost column
    expect(books()).not.toContain("$700.00");
  });

  it("groups what the money was for rather than listing every attribution", async () => {
    // Three AI services are one line saying three. The dates and the
    // individual attributions are on the transactions they came from.
    money.push(
      entry({ kind: "cost", amountCents: 9500, label: "Breeding and semen" }),
      entry({ kind: "cost", amountCents: 9500, label: "Breeding and semen" }),
      entry({ kind: "cost", amountCents: 4200, label: "Feed" }),
    );
    await mount();

    await waitFor(() => expect(screen.getByText("Cost")).toBeTruthy());
    expect(books()).toContain("· 2");
    expect(books()).toContain("$190.00");
    expect(books()).toContain("Feed");
  });

  it("says the totals are what was attributed, not the whole of every bill", async () => {
    money.push(entry({ kind: "cost", amountCents: 9500 }));
    await mount();
    await waitFor(() => expect(screen.getByText(/Attribution can be partial/)).toBeTruthy());
  });
});
