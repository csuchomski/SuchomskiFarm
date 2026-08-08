// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Adding, editing and removing an account.
 *
 * The parts worth driving are the ones the type system can't see: that a
 * rename warns it will move the entries with it, and that removing an
 * account with entries insists on somewhere for them to go.
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
  accounts: [
    { id: 3, name: "Landmark CU - Farm", opening_balance: 454.54, business_id: 5 },
    { id: 6, name: "Farm Savings", opening_balance: 1200, business_id: 5 },
    // Another business's account. It must not be offered as a destination,
    // but its name still counts against the global unique constraint.
    { id: 2, name: "Landmark CU - Realtor", opening_balance: 2076.59, business_id: 3 },
  ],
  transactions: [
    { id: 5, business_id: 5, date: "2026-07-20", type: "expense", category: "Feed", amount: 30, note: null, payer: "Co-op", account: "Landmark CU - Farm" },
    // Names an account with no row under this business: "unlisted".
    { id: 7, business_id: 5, date: "2026-07-22", type: "income", category: "Other farm income", amount: 5, note: null, payer: "Stand", account: "Cash" },
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

type CreateInput = Parameters<typeof import("../lib/ledger-accounts").createAccount>[0];
type SaveInput = Parameters<typeof import("../lib/ledger-accounts").saveAccount>[0];
const createAccount = vi.fn(async (_i: CreateInput) => booksData.accounts[0]);
const saveAccount = vi.fn(async (_i: SaveInput) => undefined);
const deleteAccount = vi.fn(async (_id: number, _to?: string | null) => undefined);

vi.mock("../lib/ledger-accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ledger-accounts")>()),
  createAccount: (i: CreateInput) => createAccount(i),
  saveAccount: (i: SaveInput) => saveAccount(i),
  deleteAccount: (id: number, to?: string | null) => deleteAccount(id, to),
}));

afterEach(() => {
  cleanup();
  createAccount.mockClear();
  saveAccount.mockClear();
  deleteAccount.mockClear();
});

const mount = async () => {
  const { default: BooksAccounts } = await import("./BooksAccounts");
  render(
    <MemoryRouter>
      <BooksAccounts />
    </MemoryRouter>,
  );
  await screen.findAllByText("Landmark CU - Farm");
};

describe("Accounts admin", () => {
  it("adds an account against the business you're in", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New account" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Farm Card" } });
    fireEvent.change(screen.getByLabelText("Opening balance"), { target: { value: "-240.19" } });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));

    await waitFor(() => expect(createAccount).toHaveBeenCalledTimes(1));
    expect(createAccount.mock.calls[0][0]).toMatchObject({
      businessId: 5,
      draft: { name: "Farm Card", openingBalance: "-240.19" },
    });
  });

  it("refuses a name another business already has", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New account" }));
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Landmark CU - Realtor" } });

    expect(screen.getByText(/unique across every business/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add account" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says a rename takes the entries with it", async () => {
    await mount();
    // By row rather than by index — accountBalances decides the order, and
    // this test is about the account with entries specifically.
    const rows = [...document.querySelectorAll(".grid-row--body")];
    const withEntries = rows.find((r) => r.textContent?.includes("Landmark CU - Farm"))!;
    fireEvent.click([...withEntries.querySelectorAll("button")].find((b) => b.textContent === "edit")!);
    fireEvent.change(screen.getByLabelText("Rename Landmark CU - Farm"), { target: { value: "Farm Checking" } });

    // One transaction is posted to it.
    expect(screen.getByText(/Renaming moves 1 entry with it/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAccount).toHaveBeenCalledTimes(1));
    expect(saveAccount.mock.calls[0][0]).toMatchObject({
      id: 3,
      currentName: "Landmark CU - Farm",
      draft: { name: "Farm Checking" },
    });
  });

  it("won't remove an account with entries until they have somewhere to go", async () => {
    await mount();
    const rows = [...document.querySelectorAll(".grid-row--body")];
    const withEntries = rows.find((r) => r.textContent?.includes("Landmark CU - Farm"))!;
    fireEvent.click([...withEntries.querySelectorAll("button")].find((b) => b.textContent === "remove")!);

    const confirm = screen.getByRole("button", { name: "Remove account" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const picker = screen.getByLabelText("Move entries from Landmark CU - Farm to") as HTMLSelectElement;
    // Its own name isn't a destination, and neither is another business's.
    const options = [...picker.options].map((o) => o.value);
    expect(options).toEqual(["", "Farm Savings"]);

    fireEvent.change(picker, { target: { value: "Farm Savings" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith(3, "Farm Savings"));
  });

  it("removes an empty account without asking where anything goes", async () => {
    await mount();
    const rows = [...document.querySelectorAll(".grid-row--body")];
    const empty = rows.find((r) => r.textContent?.includes("Farm Savings"))!;
    fireEvent.click([...empty.querySelectorAll("button")].find((b) => b.textContent === "remove")!);

    expect(screen.getByText(/changes no figure/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove account" }));
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith(6, null));
  });

  it("offers to give an unlisted account a row, pre-filled with its name", async () => {
    await mount();
    // "Cash" is named by a transaction but has no ledger_accounts row.
    fireEvent.click(screen.getByRole("button", { name: "add as an account" }));
    expect((screen.getByLabelText("Account name") as HTMLInputElement).value).toBe("Cash");
  });
});
