// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Render smoke tests for the four new Store and Books pages.
 *
 * The arithmetic lives in lib/orders.ts and lib/books-report.ts and is unit
 * tested there. These exist to catch what those can't: a page that throws on
 * mount, or one whose numbers never reach the screen.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

const otherBusiness = { id: 4, name: "5553 N Lydell Ave", type: "rental" };

const workspace = {
  loading: false,
  error: null,
  businesses: [business, otherBusiness],
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

const customers = [
  { id: "cust-1", first_name: "Meghan", last_name: "Suchomski", email: "meghan@example.com", phone: null, role: "buyer",
    archived_at: null, created_at: "2026-05-01T00:00:00Z", has_login: true },
  { id: "cust-2", first_name: "", last_name: "", email: "quiet@example.com", phone: null, role: "buyer",
    archived_at: null, created_at: "2026-05-02T00:00:00Z", has_login: true },
  // Archived: off the list until the toggle is pressed.
  { id: "cust-3", first_name: "Gone", last_name: "Away", email: "gone@example.com", phone: null, role: "buyer",
    archived_at: "2026-07-01T00:00:00Z", created_at: "2026-04-01T00:00:00Z", has_login: true },
  // Added at the farm: no auth.users row behind them.
  { id: "cust-4", first_name: "Gate", last_name: "Buyer", email: "", phone: "555-0123", role: "buyer",
    archived_at: null, created_at: "2026-08-08T00:00:00Z", has_login: false },
];

type AddPatch = Parameters<typeof import("../lib/customers").addCustomer>[1];
const addCustomer = vi.fn(async (_businessId: number, _p: AddPatch) => "new-id");

vi.mock("../lib/customers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/customers")>()),
  addCustomer: (businessId: number, p: AddPatch) => addCustomer(businessId, p),
}));

const orders = [
  // Open: 2 gallons of Milk at $10 = $20 expected.
  {
    id: 12,
    customer_id: "cust-1",
    product_id: 1,
    quantity: 2,
    status: "reserved",
    reserved_date: "2026-08-05T12:00:00Z",
    picked_up_date: null,
    cancelled_date: null,
    unit_price: null,
    total_cost: null,
    amount_paid: null,
    payment_method: null,
    business_id: 5,
  },
  // Finished and paid.
  {
    id: 9,
    customer_id: "cust-1",
    product_id: 1,
    quantity: 1.5,
    status: "completed",
    reserved_date: "2026-06-10T00:00:00Z",
    picked_up_date: "2026-06-24T00:00:00Z",
    cancelled_date: null,
    unit_price: 10,
    total_cost: 15,
    amount_paid: 15,
    payment_method: "Cash",
    business_id: 5,
  },
];

vi.mock("../lib/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orders")>()),
  fetchOrders: vi.fn(async () => orders),
  fetchCustomers: vi.fn(async () => customers),
}));

// Since migration 022 the payment list is a table read, not a constant.
vi.mock("../lib/payment-methods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/payment-methods")>()),
  fetchPaymentMethods: vi.fn(async () => [
    { code: "Cash", label: "Cash", active: true, sort_order: 10 },
    { code: "Venmo", label: "Venmo", active: true, sort_order: 20 },
    { code: "Check", label: "Check", active: true, sort_order: 30 },
  ]),
}));

vi.mock("../lib/store-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/store-data")>()),
  fetchStoreData: vi.fn(async () => ({
    products: [
      { id: 1, name: "Milk", unit: "gallon", price: 10, onHand: 6, claimed: 2, openToShop: 4, batches: [] },
    ],
    discards: [],
    production: [],
  })),
}));

const booksData = {
  businesses: [business, otherBusiness],
  accounts: [
    // First in the list on purpose, mirroring the live data: sorted by name
    // this is what `accounts[0]` used to resolve to, which is exactly how a
    // farm entry ended up pre-filled with the rental's chequing account.
    { id: 4, name: "5553 N Lyd Check", opening_balance: 852.64, business_id: 4 },
    { id: 3, name: "Landmark CU - Farm", opening_balance: 454.54, business_id: 5 },
    // Another business's account: it must not appear either.
    { id: 2, name: "Landmark CU - Realtor", opening_balance: 2076.59, business_id: 3 },
  ],
  transactions: [
    { id: 2, business_id: 5, date: "2026-07-16", type: "income", category: "Other farm income", amount: 20, note: null, payer: "Thomas", account: "Landmark CU - Farm" },
    { id: 5, business_id: 5, date: "2026-07-20", type: "expense", category: "Feed", amount: 30, note: null, payer: "Co-op", account: "Landmark CU - Farm" },
    // Posted to an account with no ledger_accounts row for this business.
    { id: 6, business_id: 5, date: "2026-07-22", type: "income", category: "Other farm income", amount: 5, note: null, payer: "Stand", account: "Venmo" },
    // Another business's entry: must be excluded.
    { id: 1, business_id: 4, date: "2026-07-06", type: "income", category: "Rents received", amount: 2000, note: null, payer: "Whitney", account: "Venmo" },
  ],
  types: [
    { code: "income", label: "Income", direction: "income" as const, active: true, sort_order: 10 },
    { code: "expense", label: "Expense", direction: "expense" as const, active: true, sort_order: 20 },
    { code: "transfer", label: "Transfer", direction: "neutral" as const, active: true, sort_order: 30 },
  ],
  typesTableExists: true,
};

vi.mock("../lib/books-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/books-data")>()),
  fetchBooksData: vi.fn(async () => booksData),
}));

afterEach(() => {
  cleanup();
  addCustomer.mockClear();
});

const mount = async (Component: React.ComponentType, settled: string | RegExp) => {
  render(
    <MemoryRouter>
      <Component />
    </MemoryRouter>,
  );
  // findAllByText, not findByText: several of these strings legitimately
  // appear twice — once in the nav rail, once on the page.
  await screen.findAllByText(settled);
};

describe("Orders page", () => {
  it("shows the open order with its customer, product and expected value", async () => {
    const { default: StoreOrders } = await import("./StoreOrders");
    await mount(StoreOrders, "Waiting for pickup");

    expect(screen.getAllByText("Meghan Suchomski").length).toBeGreaterThan(0);
    expect(screen.getByText(/Milk · order 12/)).toBeTruthy();
    // 2 gallons at $10 — priced from the product, since an open order has no
    // total_cost of its own.
    expect(screen.getAllByText("$20.00").length).toBeGreaterThan(0);
  });

  it("counts takings from what was actually paid", async () => {
    const { default: StoreOrders } = await import("./StoreOrders");
    await mount(StoreOrders, "Waiting for pickup");
    // Only the completed order contributes: $15.
    expect(screen.getAllByText("$15.00").length).toBeGreaterThan(0);
  });

  it("keeps finished orders collapsed so the open list stays the page", async () => {
    const { default: StoreOrders } = await import("./StoreOrders");
    await mount(StoreOrders, "Waiting for pickup");
    expect(screen.getByText("Finished")).toBeTruthy();
    // The completed order's date is only rendered once it's expanded.
    expect(screen.queryByText("2026-06-24")).toBeNull();
  });
});

describe("Customers page", () => {
  it("lists customers and falls back to email for a blank name", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");

    expect(screen.getAllByText("Meghan Suchomski").length).toBeGreaterThan(0);
    // cust-2 has no name at all.
    expect(screen.getByText("quiet@example.com")).toBeTruthy();
  });

  it("shows someone who has never ordered rather than hiding them", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");
    expect(screen.getAllByText("never").length).toBeGreaterThan(0);
  });
});

describe("Books accounts page", () => {
  it("adds movement to the opening balance", async () => {
    const { default: BooksAccounts } = await import("./BooksAccounts");
    await mount(BooksAccounts, "Accounts");

    // 454.54 opening + 20 income − 30 expense = 444.54.
    expect(screen.getByText("$444.54")).toBeTruthy();
  });

  it("surfaces an account only a transaction names", async () => {
    const { default: BooksAccounts } = await import("./BooksAccounts");
    await mount(BooksAccounts, "Accounts");
    expect(screen.getAllByText("Venmo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("unlisted").length).toBeGreaterThan(0);
  });

  it("excludes another business's account", async () => {
    const { default: BooksAccounts } = await import("./BooksAccounts");
    await mount(BooksAccounts, "Accounts");
    expect(screen.queryByText("Landmark CU - Realtor")).toBeNull();
  });
});

describe("Books reports page", () => {
  it("breaks the period down by month and by category", async () => {
    const { default: BooksReports } = await import("./BooksReports");
    await mount(BooksReports, "By month");

    expect(screen.getByText("Jul 2026")).toBeTruthy();
    expect(screen.getByText("Feed")).toBeTruthy();
    expect(screen.getAllByText("Other farm income").length).toBeGreaterThan(0);
  });

  it("leaves another business's income out of the totals", async () => {
    const { default: BooksReports } = await import("./BooksReports");
    await mount(BooksReports, "By month");
    // Business 4's $2,000 rent must not appear anywhere.
    expect(screen.queryByText("$2,000.00")).toBeNull();
    expect(screen.queryByText("Rents received")).toBeNull();
  });
});

// ─── the tax pages ─────────────────────────────────────────────────────

vi.mock("../lib/tax", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/tax")>()),
  fetchTaxCategories: vi.fn(async () => [
    { id: 1, business_type: "farm", direction: "income", label: "Other farm income", schedule_line: "8", sort_order: 70 },
    { id: 2, business_type: "farm", direction: "expense", label: "Feed", schedule_line: "16", sort_order: 70 },
    { id: 3, business_type: "farm", direction: "expense", label: "Repairs & maintenance", schedule_line: "25", sort_order: 180 },
  ]),
  fetchBusinessTypes: vi.fn(async () => [
    { code: "farm", label: "Farm", schedule_code: "F", schedule_label: "Schedule F — Profit or Loss From Farming" },
  ]),
  fetchAssets: vi.fn(async () => [
    { id: 1, business_id: 5, kind: "asset", name: "Tractor", value: 18000 },
    { id: 2, business_id: 5, kind: "liability", name: "Equipment loan", value: 6000 },
  ]),
}));

describe("Books taxes page", () => {
  it("puts each category on its schedule line", async () => {
    const { default: BooksTaxes } = await import("./BooksTaxes");
    await mount(BooksTaxes, "Part II — Expenses");

    expect(screen.getAllByText(/Schedule F — Profit or Loss From Farming/).length).toBeGreaterThan(0);
    // $20 income on line 8, $30 of feed on line 16.
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("16")).toBeTruthy();
    expect(screen.getAllByText("$30.00").length).toBeGreaterThan(0);
  });

  it("keeps a line with nothing on it, because the form has one", async () => {
    const { default: BooksTaxes } = await import("./BooksTaxes");
    await mount(BooksTaxes, "Part II — Expenses");
    // Line 25 — no repairs this year, but it's on the paper form.
    expect(screen.getByText("25")).toBeTruthy();
    expect(screen.getByText("Repairs & maintenance")).toBeTruthy();
  });

  it("flags money that lands on no line", async () => {
    // The "Venmo" $5 entry is categorised "Other farm income", which does
    // map — so nothing should be unmapped here.
    const { default: BooksTaxes } = await import("./BooksTaxes");
    await mount(BooksTaxes, "Part II — Expenses");
    expect(screen.queryByText(/don't match a line/)).toBeNull();
  });

  it("shows the net for the schedule", async () => {
    const { default: BooksTaxes } = await import("./BooksTaxes");
    await mount(BooksTaxes, "Part II — Expenses");
    // Income 20 + 5 = 25, expenses 30, net −5.
    expect(screen.getByText("Net profit or loss — Schedule F")).toBeTruthy();
    expect(screen.getAllByText("−$5.00").length).toBeGreaterThan(0);
  });
});

describe("Balance sheet page", () => {
  it("adds cash to assets and subtracts liabilities", async () => {
    const { default: BooksBalanceSheet } = await import("./BooksBalanceSheet");
    await mount(BooksBalanceSheet, "Liabilities");

    // Cash is both accounts: Landmark 444.54 plus the unlisted Venmo 5.00
    // = 449.54. Add the 18,000 tractor, subtract the 6,000 loan.
    expect(screen.getAllByText("$18,449.54").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$6,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$12,449.54").length).toBeGreaterThan(0);
  });

  it("shows the liability that had no UI before", async () => {
    const { default: BooksBalanceSheet } = await import("./BooksBalanceSheet");
    await mount(BooksBalanceSheet, "Liabilities");
    expect(screen.getByText("Equipment loan")).toBeTruthy();
  });
});

describe("Books transactions — the entry form", () => {
  /**
   * The bug this covers, reported from a phone: the Account field on a farm
   * entry was pre-filled with "5553 N Lyd Check", the rental business's
   * chequing account. The default came from `data.accounts[0]` across every
   * business, and sorted by name that is the rental account.
   */
  it("defaults the account to one belonging to the business you're on", async () => {
    const { default: BooksTransactions } = await import("./BooksTransactions");
    render(
      <MemoryRouter>
        <BooksTransactions />
      </MemoryRouter>,
    );
    await screen.findAllByText("Transactions");

    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));

    const accountField = screen.getByPlaceholderText("Account") as HTMLInputElement;
    expect(accountField.value).toBe("Landmark CU - Farm");
    expect(accountField.value).not.toBe("5553 N Lyd Check");
  });

  it("offers only this business's accounts, plus ones it already posts to", async () => {
    const { default: BooksTransactions } = await import("./BooksTransactions");
    const { container } = render(
      <MemoryRouter>
        <BooksTransactions />
      </MemoryRouter>,
    );
    await screen.findAllByText("Transactions");
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));

    const offered = [...container.querySelectorAll("#ledger-accounts option")].map((o) =>
      o.getAttribute("value"),
    );
    // The farm's own account, and Venmo because farm entries post to it.
    expect(offered).toEqual(["Landmark CU - Farm", "Venmo"]);
    expect(offered).not.toContain("Landmark CU - Realtor");
  });

  it("lets an entry be logged against another business", async () => {
    const { default: BooksTransactions } = await import("./BooksTransactions");
    render(
      <MemoryRouter>
        <BooksTransactions />
      </MemoryRouter>,
    );
    await screen.findAllByText("Transactions");
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));

    const picker = screen.getByRole("combobox", { name: "Business for this entry" }) as HTMLSelectElement;
    expect(picker.value).toBe("5");
    expect(picker.textContent).toContain("Suchomski Family Farm");
  });
});

describe("Customers page: archiving", () => {
  it("keeps archived customers off the list until asked", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");

    expect(screen.queryByText("Gone Away")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /show 1 archived/ }));
    expect(screen.getByText("Gone Away")).toBeTruthy();
    expect(screen.getByText("archived")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /hide archived/ }));
    expect(screen.queryByText("Gone Away")).toBeNull();
  });

  it("links each customer to their own page", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");

    const link = screen.getByText("Meghan Suchomski").closest("a");
    expect(link?.getAttribute("href")).toBe("/store/customers/cust-1");
  });
});

describe("Customers page: adding one", () => {
  it("adds someone with a name and no email", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");

    fireEvent.click(screen.getByRole("button", { name: "New customer" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Gate" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "555-0123" } });

    // A name is enough. profiles.email is NOT NULL but takes '' — someone
    // buying eggs at the gate may not have an address to give you.
    const submit = screen.getByRole("button", { name: "Add customer" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(addCustomer).toHaveBeenCalledTimes(1));
    // The business goes with them. Without it the walk-in lands on a profile
    // no farm owns, which is how every profile ended up on every farm's list.
    expect(addCustomer.mock.calls[0][0]).toBe(5);
    expect(addCustomer.mock.calls[0][1]).toMatchObject({ first_name: "Gate", email: "", phone: "555-0123" });
  });

  it("won't add someone with neither a name nor an email", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");

    fireEvent.click(screen.getByRole("button", { name: "New customer" }));
    expect(screen.getByText(/name or an email/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add customer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("marks a customer who can't sign in", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");

    const row = [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes("Gate Buyer"))!;
    expect(row.textContent).toContain("no login");

    // Everyone else is left alone.
    const meghan = [...document.querySelectorAll(".grid-row--body")].find((r) =>
      r.textContent?.includes("Meghan Suchomski"),
    )!;
    expect(meghan.textContent).not.toContain("no login");
  });

  it("says plainly that this isn't an account", async () => {
    const { default: StoreCustomers } = await import("./StoreCustomers");
    await mount(StoreCustomers, "Customers");
    fireEvent.click(screen.getByRole("button", { name: "New customer" }));
    expect(screen.getByText(/won't be able to sign in/)).toBeTruthy();
  });
});
