// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Books → Cash flow: the thirteen-week rolling forecast.
 *
 * What is under test is the one thing the page exists to say — which week
 * the money runs out — and, just as much, the things it refuses to count
 * towards not running out.
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

type Tx = {
  id: number; business_id: number; date: string; type: string; category: string;
  amount: number; note: string | null; payer: string; account: string;
};

/** Spread last, so every field is actually overridable. Writing the
 * defaults as `over.x ?? default` field by field is how `account` ended up
 * pinned to one value and a test silently asserted against the wrong row. */
const tx = (over: Partial<Tx> = {}): Tx => ({
  id: 1,
  business_id: 5,
  date: "2026-08-05",
  type: "expense",
  category: "Feed",
  amount: 100,
  note: null,
  payer: "Co-op",
  account: "Landmark CU - Farm",
  ...over,
});

type Order = {
  id: number; customer_id: string; product_id: number; quantity: number; status: string;
  reserved_date: string | null; picked_up_date: string | null; cancelled_date: string | null;
  unit_price: number | null; total_cost: number | null; amount_paid: number | null;
  payment_method: string | null; business_id: number | null;
};

const order = (over: Partial<Order> = {}): Order => ({
  id: 1,
  customer_id: "c1",
  product_id: 1,
  quantity: 2,
  status: "reserved",
  reserved_date: "2026-08-27",
  picked_up_date: null,
  cancelled_date: null,
  unit_price: 10,
  total_cost: 20,
  amount_paid: null,
  payment_method: null,
  business_id: 5,
  ...over,
});

let accounts = [{ id: 3, name: "Landmark CU - Farm", opening_balance: 1000, business_id: 5 }];
let transactions: Tx[] = [];
let orders: Order[] = [];
let schedules: unknown[] = [];
let products: unknown[] = [];

vi.mock("../lib/books-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/books-data")>()),
  fetchBooksData: vi.fn(async () => ({
    businesses: [business],
    accounts,
    transactions,
    types: [
      { code: "income", label: "Income", direction: "income" as const, active: true, sort_order: 10 },
      { code: "expense", label: "Expense", direction: "expense" as const, active: true, sort_order: 20 },
      { code: "transfer", label: "Transfer", direction: "neutral" as const, active: true, sort_order: 30 },
    ],
    typesTableExists: true,
  })),
}));

vi.mock("../lib/store-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/store-data")>()),
  fetchStoreData: vi.fn(async () => ({ products, discards: [], production: [] })),
}));

vi.mock("../lib/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orders")>()),
  fetchOrders: vi.fn(async () => orders),
}));

vi.mock("../lib/schedules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/schedules")>()),
  fetchSchedules: vi.fn(async () => schedules),
}));

/** Milk, $10 a gallon, nothing on hand and nothing produced unless said. */
const milk = (over: Record<string, unknown> = {}) => ({
  id: 1, name: "Milk", unit: "gallon", price: 10, forecast_override: null,
  icon: null, type_code: "milk", business_id: 5, created_at: null,
  onHand: 0, claimed: 0, openToShop: 0, batches: [],
  ...over,
});

/** A Thursday standing order. 2026-08-26 is a Wednesday. */
const standing = (over: Record<string, unknown> = {}) => ({
  id: 1, customer_id: "c1", product_id: 1, quantity: 2, day: "Thursday",
  start_date: null, skipped_dates: [], fulfilled_dates: [], cancelled_at: null,
  business_id: 5, note: "",
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  accounts = [{ id: 3, name: "Landmark CU - Farm", opening_balance: 1000, business_id: 5 }];
  transactions = [];
  orders = [];
  schedules = [];
  products = [];
});

const mount = async () => {
  const { default: Page } = await import("./BooksCashFlow");
  render(<MemoryRouter><Page /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

/**
 * One week's row, as the text of its figures.
 *
 * `.grid-row` exactly. A selector that widened to the parent on a miss
 * would scrape the table and make every assertion below pass on any number
 * anywhere — the first test checks that it really isolates a row.
 */
const weekRow = (label: string) => {
  const row = screen.getByText(label).closest(".grid-row");
  if (row === null) throw new Error(`No .grid-row around "${label}" — the row markup changed.`);
  return [...row.querySelectorAll(".mono")].map((s) => s.textContent);
};

describe("the run of weeks", () => {
  it("opens on the cash in the accounts and runs it forward", async () => {
    // The product has to be here as well as the schedule: a standing order
    // is a quantity, and the price lives on the product.
    products = [milk()];
    schedules = [standing()];
    await mount();

    // $1,000 in the bank, $20 a week of standing orders, nothing going out.
    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,020.00");
    // Keeps `weekRow` honest: week two's balance is not in week one's row.
    expect(weekRow("Aug 26 – Sep 1")).not.toContain("$1,040.00");
    expect(weekRow("Sep 2 – 8")).toContain("$1,040.00");
  });

  it("counts what is still owed on a reserved order", async () => {
    orders = [order({ total_cost: 20, amount_paid: null })];
    await mount();
    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,020.00");
  });

  it("prices nothing when the product has no price", async () => {
    // A standing order for a product with no price must contribute nothing
    // rather than a zero that reads as a decision somebody made.
    products = [milk({ price: null })];
    schedules = [standing()];
    await mount();
    expect(screen.getByText(/Nothing is committed/)).toBeTruthy();
  });

  it("leaves a cancelled order's money alone", async () => {
    // The live ledger has exactly this: a cancelled order still carrying a
    // $20 total with nothing paid against it.
    products = [milk()];
    schedules = [standing()];
    orders = [order({ id: 1, status: "cancelled", total_cost: 20 })];
    await mount();
    // $20 of standing order and nothing from the cancelled one. $1,040
    // would mean it had been counted.
    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,020.00");
  });

  it("names the week it runs short, in a sentence, before any column", async () => {
    // $1,000 in hand, $2,600 spent over 13 weeks — $200 a week going out.
    products = [milk()];
    schedules = [standing()];
    transactions = [tx({ id: 1, date: "2026-08-05", amount: 2600 })];
    await mount();
    expect(screen.getByText(/Runs short in the week of/)).toBeTruthy();
    expect(screen.getByText(/at the worst/)).toBeTruthy();
  });

  it("says it is covered when it is", async () => {
    products = [milk()];
    schedules = [standing()];
    await mount();
    expect(screen.getByText(/Covered for the next 13 weeks on what is already committed/)).toBeTruthy();
  });

  it("changes horizon without changing the opening balance", async () => {
    products = [milk()];
    schedules = [standing()];
    await mount();
    fireEvent.click(screen.getByText("4 weeks"));
    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,020.00");
    expect(screen.queryByText("Sep 30 – Oct 6")).toBeNull();
  });
});

describe("what it refuses to count", () => {
  it("keeps unsold production out of the balance and shows it beside", async () => {
    // 7 gallons a day, nothing promised. That is real product and not a
    // sale, so the balance must not move on it.
    products = [milk({ batches: [{ produced_date: "2026-08-25", quantity: 98 }] })];
    await mount();

    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,000.00");
    expect(screen.getAllByText(/spare could add/).length).toBeGreaterThan(0);
    expect(screen.getByText(/It is never in the balance/)).toBeTruthy();
  });

  it("says when a reserved order has no price on it", async () => {
    // Several live orders carry quantity and no total_cost. Guessing from
    // today's price would invent a figure nobody agreed to.
    products = [milk()];
    schedules = [standing()];
    orders = [order({ total_cost: null })];
    await mount();
    expect(screen.getByText(/carries no price/)).toBeTruthy();
    // The standing order only. The unpriced one adds nothing.
    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,020.00");
  });

  it("calls the outgoings an average rather than a schedule of bills", async () => {
    products = [milk()];
    schedules = [standing()];
    transactions = [tx({ id: 1, date: "2026-08-05", amount: 260 })];
    await mount();
    expect(screen.getByText(/an average of what has actually been spent/)).toBeTruthy();
  });

  it("warns that the balance is a ceiling when nothing has been spent", async () => {
    // No history means no outgoings, which makes every balance flattering.
    products = [milk()];
    schedules = [standing()];
    await mount();
    expect(screen.getByText(/treat the balance as a ceiling/)).toBeTruthy();
  });

  it("says nothing is coming rather than drawing an empty grid", async () => {
    await mount();
    expect(screen.getByText(/Nothing is committed and nothing is forecast to be produced/)).toBeTruthy();
    expect(screen.queryByText("Aug 26 – Sep 1")).toBeNull();
  });
});

describe("agreeing with the rest of Books", () => {
  it("opens on the same cash the account list totals to", async () => {
    // The opening balance and the account list are computed by different
    // paths. If they disagree one is wrong and the forecast is worthless.
    products = [milk()];
    schedules = [standing()];
    transactions = [tx({ id: 1, date: "2026-08-05", type: "income", amount: 175 })];
    await mount();
    // The tile, the account row and the total under it.
    expect(screen.getAllByText("$1,175.00").length).toBeGreaterThanOrEqual(3);
    // And the first week opens on it, plus the standing order.
    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,195.00");
  });

  it("counts an account named only by an entry", async () => {
    products = [milk()];
    schedules = [standing()];
    transactions = [tx({ id: 1, date: "2026-08-05", type: "income", amount: 40, account: "Venmo" })];
    await mount();
    expect(screen.getByText("Venmo")).toBeTruthy();
    expect(weekRow("Aug 26 – Sep 1")).toContain("$1,060.00");
  });
});
