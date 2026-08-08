// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * The "Attributed to" column and the panel behind it.
 *
 * The callout this replaces said the column needed migration 002 to be run.
 * It had been run for a fortnight; the two nullable columns it added were
 * simply never written to. These drive the control that writes them.
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

const booksData = {
  businesses: [business],
  accounts: [{ id: 3, name: "Landmark CU - Farm", opening_balance: 454.54, business_id: 5 }],
  transactions: [
    { id: 5, business_id: 5, date: "2026-07-20", type: "expense", category: "Feed", amount: 30, note: "Co-op feed", payer: "Co-op", account: "Landmark CU - Farm" },
    { id: 2, business_id: 5, date: "2026-07-16", type: "income", category: "Other farm income", amount: 20, note: "Milk", payer: "Thomas", account: "Landmark CU - Farm" },
  ],
  types: [
    { code: "income", label: "Income", direction: "income" as const, active: true, sort_order: 10 },
    { code: "expense", label: "Expense", direction: "expense" as const, active: true, sort_order: 20 },
  ],
  typesTableExists: true,
};

vi.mock("../lib/books-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/books-data")>()),
  fetchBooksData: vi.fn(async () => booksData),
}));

vi.mock("../lib/tax", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/tax")>()),
  fetchTaxCategories: vi.fn(async () => []),
}));

const animals = [
  { id: "cow-1", ear_tag: "101", barn_name: "Rosie" },
  { id: "cow-2", ear_tag: "102", barn_name: "Clover" },
  { id: "cow-3", ear_tag: "103", barn_name: null },
];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
}));

type AttributeInput = Parameters<typeof import("../lib/attribution").attribute>[0];
const attribute = vi.fn(async (_input: AttributeInput) => undefined);
const unattributeFn = vi.fn(async () => undefined);
// Transaction 2 already has one; 5 has none.
let existing = [{ id: "rev-1", kind: "revenue" as const, transactionId: 2, animalId: "cow-1", amount: 20 }];

vi.mock("../lib/attribution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/attribution")>()),
  fetchAttributions: vi.fn(async () => existing),
  fetchExpenseCategories: vi.fn(async () => [
    { id: "cat-feed", code: "feed", label: "Feed and hay" },
    { id: "cat-vet", code: "vet_med", label: "Veterinary, medicine, supplies" },
  ]),
  attribute: (input: AttributeInput) => attribute(input),
  unattribute: () => unattributeFn(),
}));

afterEach(() => {
  cleanup();
  attribute.mockClear();
  unattributeFn.mockClear();
  existing = [{ id: "rev-1", kind: "revenue" as const, transactionId: 2, animalId: "cow-1", amount: 20 }];
});

const mount = async () => {
  const { default: BooksTransactions } = await import("./BooksTransactions");
  render(
    <MemoryRouter>
      <BooksTransactions />
    </MemoryRouter>,
  );
  // The header renders before the attributions land, and until they do every
  // row offers "attribute". Waiting on the one that has an animal is what
  // says the second fetch has settled.
  await screen.findAllByText("Attributed to");
  await screen.findByRole("button", { name: "Rosie" });
};

describe("Attributed to", () => {
  it("replaces the callout that said the migration hadn't been run", async () => {
    await mount();
    expect(screen.queryByText(/hasn't been run/)).toBeNull();
    expect(screen.getAllByText("Attributed to").length).toBeGreaterThan(0);
  });

  it("names the animals a transaction is already attributed to", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Rosie" })).toBeTruthy();
  });

  it("offers to attribute one that isn't", async () => {
    await mount();
    expect(screen.getAllByRole("button", { name: "attribute" }).length).toBe(1);
  });

  it("splits evenly across the animals added, and adds back up", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "attribute" }));

    // One row, holding the whole $30.
    expect((screen.getByLabelText("Amount 1") as HTMLInputElement).value).toBe("30.00");

    fireEvent.click(screen.getByRole("button", { name: /another animal/ }));
    fireEvent.click(screen.getByRole("button", { name: /another animal/ }));

    const amounts = [1, 2, 3].map((i) => (screen.getByLabelText(`Amount ${i}`) as HTMLInputElement).value);
    expect(amounts).toEqual(["10.00", "10.00", "10.00"]);
    expect(amounts.reduce((s, v) => s + Number(v), 0)).toBe(30);
  });

  it("won't attribute more than the transaction is worth", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "attribute" }));
    fireEvent.change(screen.getByLabelText("Animal 1"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Amount 1"), { target: { value: "50" } });

    expect(screen.getByText(/more than the transaction's \$30\.00/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Attribute" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says what stays unattributed, because partial is allowed", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "attribute" }));
    fireEvent.change(screen.getByLabelText("Animal 1"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Amount 1"), { target: { value: "20" } });

    expect(screen.getByText(/\$10\.00 of this transaction stays unattributed/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Attribute" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("writes the split against the transaction's own date and farm", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "attribute" }));
    fireEvent.change(screen.getByLabelText("Animal 1"), { target: { value: "cow-1" } });
    fireEvent.click(screen.getByRole("button", { name: /another animal/ }));
    fireEvent.change(screen.getByLabelText("Animal 2"), { target: { value: "cow-2" } });
    fireEvent.change(screen.getByLabelText("Expense category"), { target: { value: "cat-feed" } });

    fireEvent.click(screen.getByRole("button", { name: "Attribute" }));
    await waitFor(() => expect(attribute).toHaveBeenCalledTimes(1));

    expect(attribute.mock.calls[0][0]).toMatchObject({
      transactionId: 5,
      farmId: "farm-1",
      date: "2026-07-20",
      direction: "expense",
      categoryId: "cat-feed",
      rows: [
        { animalId: "cow-1", amount: "15.00" },
        { animalId: "cow-2", amount: "15.00" },
      ],
    });
  });

  it("asks for an income category on an income transaction, not an expense one", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Rosie" }));

    expect(screen.getByLabelText("Income category")).toBeTruthy();
    expect(screen.queryByLabelText("Expense category")).toBeNull();
  });

  it("takes an attribution back off", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Rosie" }));

    // Two "remove"s in the panel: one per existing attribution, one per
    // draft row. This is the existing one.
    const existingRow = document.querySelector(".attribute-existing__row")!;
    fireEvent.click(existingRow.querySelector("button")!);
    await waitFor(() => expect(unattributeFn).toHaveBeenCalledTimes(1));
  });
});
