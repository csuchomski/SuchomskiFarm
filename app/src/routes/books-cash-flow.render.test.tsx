// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Books → Cash flow.
 *
 * What is under test is the thing the page exists to say: how much is in the
 * bank at the end of each month, and that the figure is real rather than a
 * running total from zero.
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

type Row = {
  id: number; business_id: number; date: string; type: string; category: string;
  amount: number; note: string | null; payer: string; account: string;
};

const entry = (over: Partial<Row> = {}): Row => ({
  id: over.id ?? 1,
  business_id: over.business_id ?? 5,
  date: over.date ?? "2026-08-05",
  type: over.type ?? "income",
  category: over.category ?? "Other farm income",
  amount: over.amount ?? 100,
  note: null,
  payer: "Someone",
  account: over.account ?? "Landmark CU - Farm",
});

let accounts = [{ id: 3, name: "Landmark CU - Farm", opening_balance: 1000, business_id: 5 }];
let transactions: Row[] = [];

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  accounts = [{ id: 3, name: "Landmark CU - Farm", opening_balance: 1000, business_id: 5 }];
  transactions = [];
});

const mount = async () => {
  const { default: Page } = await import("./BooksCashFlow");
  render(<MemoryRouter><Page /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

/**
 * One month's row, as the text of its figures.
 *
 * `.grid-row` exactly, not a fallback chain: a selector that quietly widens
 * to the parent when it misses would scrape the whole table and make every
 * `toContain` below pass regardless of which row the number is in. The
 * assertions in the first test check that this really isolates a row.
 */
const monthRow = (label: string) => {
  const row = screen.getByText(label).closest(".grid-row");
  if (row === null) throw new Error(`No .grid-row around "${label}" — the row markup changed.`);
  return [...row.querySelectorAll(".mono")].map((s) => s.textContent);
};

describe("the run of months", () => {
  it("closes each month where the next one opens", async () => {
    // $1,000 opening. May +1,000 → 2,000. June −500 → 1,500. July +20 → 1,520.
    transactions = [
      entry({ id: 1, date: "2026-05-10", type: "income", amount: 1000 }),
      entry({ id: 2, date: "2026-06-04", type: "expense", amount: 500 }),
      entry({ id: 3, date: "2026-07-16", type: "income", amount: 20 }),
    ];
    await mount();

    expect(monthRow("May 2026")).toContain("$2,000.00");
    // These two keep `monthRow` honest. If it ever widened to the table,
    // every toContain in this file would pass on any number on the page.
    expect(monthRow("May 2026")).not.toContain("$1,520.00");
    expect(monthRow("May 2026")).not.toContain("$1,500.00");
    expect(monthRow("Jun 2026")).toContain("$1,500.00");
    expect(monthRow("Jul 2026")).toContain("$1,520.00");
  });

  it("shows what the period was brought forward with", async () => {
    // The number that makes the column checkable. Without it a reader has no
    // way to tell a real balance from a running total that started at zero.
    transactions = [entry({ id: 1, date: "2026-08-05", type: "income", amount: 100 })];
    await mount();
    expect(screen.getByText(/Brought forward/).textContent).toContain("$1,000.00");
  });

  it("carries earlier months into a short window rather than starting over", async () => {
    // The bug worth a test: ask for 3 months and August must not open on the
    // account's original $1,000 when $5,000 came in back in January.
    transactions = [
      entry({ id: 1, date: "2026-01-10", type: "income", amount: 5000 }),
      entry({ id: 2, date: "2026-08-05", type: "expense", amount: 200 }),
    ];
    await mount();
    fireEvent.click(screen.getByText("3 months"));

    expect(screen.getByText(/Brought forward/).textContent).toContain("$6,000.00");
    expect(monthRow("Aug 2026")).toContain("$5,800.00");
  });

  it("keeps a quiet month on the page, holding its balance", async () => {
    transactions = [
      entry({ id: 1, date: "2026-06-10", type: "income", amount: 100 }),
      entry({ id: 2, date: "2026-08-10", type: "expense", amount: 30 }),
    ];
    await mount();
    // July had nothing, and is exactly the month worth seeing.
    expect(monthRow("Jul 2026")).toContain("$1,100.00");
  });

  it("marks a month that ended overdrawn, and says so once in words", async () => {
    transactions = [entry({ id: 1, date: "2026-08-05", type: "expense", amount: 1500 })];
    await mount();
    expect(monthRow("Aug 2026")).toContain("−$500.00");
    expect(screen.getByText(/Cash went below zero in Aug 2026/)).toBeTruthy();
  });
});

describe("what it refuses to invent", () => {
  it("leaves a transfer out of in and out, and says why", async () => {
    transactions = [
      entry({ id: 1, date: "2026-08-01", type: "income", amount: 100 }),
      entry({ id: 2, date: "2026-08-02", type: "transfer", amount: 60 }),
    ];
    await mount();
    // Cash is 1,100, not 1,040: the money moved, it did not leave.
    expect(monthRow("Aug 2026")).toContain("$1,100.00");
    expect(screen.getByText(/transfers are left out of every figure here/)).toBeTruthy();
  });

  it("says the business holds its opening balance when nothing is recorded", async () => {
    // An empty page here would read as "no money" rather than "no entries".
    await mount();
    expect(screen.getByText(/holds \$1,000\.00 in opening balances/)).toBeTruthy();
  });

  it("says there is nothing to follow when there is no money either", async () => {
    accounts = [{ id: 3, name: "Landmark CU - Farm", opening_balance: 0, business_id: 5 }];
    await mount();
    expect(screen.getByText(/no cash to follow yet/)).toBeTruthy();
  });

  it("counts an account named only by an entry, rather than losing its money", async () => {
    // The live "Venmo" row carries no business_id, and entries post to it by
    // name. Walking only the accounts table would drop it.
    transactions = [entry({ id: 1, date: "2026-08-05", type: "income", amount: 40, account: "Venmo" })];
    await mount();
    expect(screen.getByText("Venmo")).toBeTruthy();
    expect(screen.getByText(/named by entries, not on the account list/)).toBeTruthy();
    expect(monthRow("Aug 2026")).toContain("$1,040.00");
  });
});

describe("agreeing with the rest of Books", () => {
  it("totals the accounts to the same cash the last month closes on", async () => {
    // The closing balance and the account list are computed by different
    // paths. If they disagree, one of them is wrong and the page is useless.
    transactions = [
      entry({ id: 1, date: "2026-07-10", type: "income", amount: 250 }),
      entry({ id: 2, date: "2026-08-02", type: "expense", amount: 75 }),
    ];
    await mount();

    const onHand = screen.getAllByText("$1,175.00");
    // Once in the "Cash on hand" tile, once in the account row, once in the
    // total under it, and once as August's closing balance.
    expect(onHand.length).toBeGreaterThanOrEqual(3);
    expect(monthRow("Aug 2026")).toContain("$1,175.00");
  });
});
