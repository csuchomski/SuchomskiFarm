import { describe, expect, it } from "vitest";
import { typeMap, type RealLedgerAccount, type RealTransaction, type TransactionType } from "./books-data";
import {
  accountBalances,
  byCategory,
  byMonth,
  inRange,
  monthLabel,
  monthRange,
  monthsBack,
  signedAmount,
} from "./books-report";

const TYPES: TransactionType[] = [
  { code: "income", label: "Income", direction: "income", active: true, sort_order: 10 },
  { code: "expense", label: "Expense", direction: "expense", active: true, sort_order: 20 },
  { code: "transfer", label: "Transfer", direction: "neutral", active: true, sort_order: 30 },
];
const types = typeMap(TYPES);

const tx = (over: Partial<RealTransaction> = {}): RealTransaction => ({
  id: over.id ?? 1,
  business_id: over.business_id ?? 5,
  date: over.date ?? "2026-07-16",
  type: over.type ?? "income",
  category: "category" in over ? over.category! : "Other farm income",
  amount: over.amount ?? 20,
  note: null,
  payer: over.payer ?? "Thomas Suchomski",
  account: "account" in over ? over.account! : "Cash",
});

const account = (name: string, opening = 0, businessId: number | null = 5): RealLedgerAccount => ({
  id: Math.floor(Math.random() * 100000),
  name,
  opening_balance: opening,
  business_id: businessId,
});

describe("signedAmount", () => {
  it("adds income and subtracts expense", () => {
    expect(signedAmount(tx({ type: "income", amount: 20 }), types)).toBe(20);
    expect(signedAmount(tx({ type: "expense", amount: 20 }), types)).toBe(-20);
  });

  it("treats a transfer as moving nothing", () => {
    // The ledger stores one row for a movement between accounts, not a
    // matched pair — counting it would double the money.
    expect(signedAmount(tx({ type: "transfer", amount: 500 }), types)).toBe(0);
  });

  it("ignores the sign already on the amount", () => {
    // An expense entered as -20 is still a $20 expense, not a $20 credit.
    expect(signedAmount(tx({ type: "expense", amount: -20 }), types)).toBe(-20);
  });

  it("contributes nothing for a type that isn't in the lookup", () => {
    expect(signedAmount(tx({ type: "mystery", amount: 99 }), types)).toBe(0);
  });
});

describe("accountBalances", () => {
  it("adds movement to the opening balance", () => {
    const rows = accountBalances(
      [account("Landmark CU - Farm", 454.54)],
      [tx({ account: "Landmark CU - Farm", type: "income", amount: 20 })],
      types,
    );
    expect(rows[0]).toMatchObject({ opening: 454.54, movement: 20, balance: 474.54, entries: 1 });
  });

  it("still shows an account only a transaction names", () => {
    // The live "Venmo" row carries business_id null, so it's in no
    // business's account list — but transactions post to it by name. Walking
    // only the accounts table would make that money vanish.
    const rows = accountBalances([account("Cash", 0)], [tx({ account: "Venmo", type: "income", amount: 800 })], types);
    const venmo = rows.find((r) => r.account === "Venmo");
    expect(venmo).toMatchObject({ opening: 0, balance: 800, unlisted: true });
  });

  it("doesn't flag a listed account as unlisted", () => {
    const rows = accountBalances([account("Cash", 10)], [tx({ account: "Cash" })], types);
    expect(rows[0].unlisted).toBe(false);
  });

  it("keeps an account with an opening balance and no activity", () => {
    const rows = accountBalances([account("Landmark CU - Realtor", 2076.59)], [], types);
    expect(rows[0]).toMatchObject({ balance: 2076.59, entries: 0 });
  });

  it("ignores a transaction with a blank account rather than inventing one", () => {
    const rows = accountBalances([], [tx({ account: "  " })], types);
    expect(rows).toEqual([]);
  });

  it("leaves a transfer out of the balance", () => {
    const rows = accountBalances([account("Cash", 100)], [tx({ account: "Cash", type: "transfer", amount: 50 })], types);
    expect(rows[0]).toMatchObject({ balance: 100, entries: 1 });
  });

  it("sorts richest account first", () => {
    const rows = accountBalances([account("Small", 5), account("Big", 500)], [], types);
    expect(rows.map((r) => r.account)).toEqual(["Big", "Small"]);
  });
});

describe("byCategory", () => {
  it("totals each category", () => {
    const rows = byCategory(
      [
        tx({ id: 1, type: "expense", category: "Feed", amount: 30 }),
        tx({ id: 2, type: "expense", category: "Feed", amount: 20 }),
      ],
      types,
    );
    expect(rows).toEqual([{ category: "Feed", direction: "expense", total: 50, entries: 2 }]);
  });

  it("groups case-insensitively but keeps the first spelling", () => {
    const rows = byCategory(
      [
        tx({ id: 1, type: "expense", category: "Feed", amount: 10 }),
        tx({ id: 2, type: "expense", category: "feed", amount: 10 }),
      ],
      types,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Feed");
  });

  it("keeps income and expense apart even under the same name", () => {
    const rows = byCategory(
      [
        tx({ id: 1, type: "income", category: "Hay", amount: 100 }),
        tx({ id: 2, type: "expense", category: "Hay", amount: 40 }),
      ],
      types,
    );
    expect(rows).toHaveLength(2);
    // Income first, then expense.
    expect(rows.map((r) => r.direction)).toEqual(["income", "expense"]);
  });

  it("labels a blank category rather than dropping the money", () => {
    const rows = byCategory([tx({ type: "expense", category: "", amount: 12 })], types);
    expect(rows[0].category).toBe("Uncategorised");
  });

  it("leaves transfers out entirely", () => {
    expect(byCategory([tx({ type: "transfer", amount: 500 })], types)).toEqual([]);
  });

  it("puts the biggest expense first", () => {
    const rows = byCategory(
      [
        tx({ id: 1, type: "expense", category: "Small", amount: 5 }),
        tx({ id: 2, type: "expense", category: "Big", amount: 500 }),
      ],
      types,
    );
    expect(rows.map((r) => r.category)).toEqual(["Big", "Small"]);
  });
});

describe("byMonth", () => {
  it("splits income and expense per month", () => {
    const rows = byMonth(
      [
        tx({ id: 1, date: "2026-07-05", type: "income", amount: 800 }),
        tx({ id: 2, date: "2026-07-20", type: "expense", amount: 300 }),
      ],
      types,
    );
    expect(rows).toEqual([{ month: "2026-07", income: 800, expenses: 300, net: 500, entries: 2 }]);
  });

  it("fills in a month with no entries rather than skipping it", () => {
    // Skipping compresses a quiet summer into nothing and makes the shape of
    // the year a lie.
    const rows = byMonth(
      [tx({ id: 1, date: "2026-06-01", amount: 10 }), tx({ id: 2, date: "2026-09-01", amount: 10 })],
      types,
    );
    expect(rows.map((r) => r.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(rows[1]).toMatchObject({ income: 0, expenses: 0, net: 0, entries: 0 });
  });

  it("crosses a year boundary", () => {
    const rows = byMonth(
      [tx({ id: 1, date: "2025-11-01", amount: 10 }), tx({ id: 2, date: "2026-02-01", amount: 10 })],
      types,
    );
    expect(rows.map((r) => r.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("is empty with no transactions", () => {
    expect(byMonth([], types)).toEqual([]);
  });

  it("counts a transfer as an entry but not as money", () => {
    const rows = byMonth([tx({ date: "2026-07-01", type: "transfer", amount: 500 })], types);
    expect(rows[0]).toMatchObject({ income: 0, expenses: 0, net: 0, entries: 1 });
  });
});

describe("monthRange", () => {
  it("is inclusive at both ends", () => {
    expect(monthRange("2026-01", "2026-03")).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("is a single month when both ends match", () => {
    expect(monthRange("2026-05", "2026-05")).toEqual(["2026-05"]);
  });

  it("is empty when the range runs backwards", () => {
    expect(monthRange("2026-05", "2026-01")).toEqual([]);
  });
});

describe("monthLabel", () => {
  it("reads as a month and a year", () => {
    expect(monthLabel("2026-07")).toBe("Jul 2026");
  });

  it("passes through anything it can't parse", () => {
    expect(monthLabel("nonsense")).toBe("nonsense");
    expect(monthLabel("2026-13")).toBe("2026-13");
  });
});

describe("inRange", () => {
  it("includes both ends", () => {
    const rows = inRange(
      [tx({ id: 1, date: "2026-07-01" }), tx({ id: 2, date: "2026-07-31" }), tx({ id: 3, date: "2026-08-01" })],
      "2026-07-01",
      "2026-07-31",
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("monthsBack", () => {
  it("is the first of this month at zero", () => {
    expect(monthsBack("2026-08-07", 0)).toBe("2026-08-01");
  });

  it("walks back within a year", () => {
    expect(monthsBack("2026-08-07", 3)).toBe("2026-05-01");
  });

  it("crosses the year boundary", () => {
    expect(monthsBack("2026-02-15", 3)).toBe("2025-11-01");
  });

  it("handles more than a full year", () => {
    expect(monthsBack("2026-08-07", 12)).toBe("2025-08-01");
  });
});
