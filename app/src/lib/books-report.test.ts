import { describe, expect, it } from "vitest";
import { typeMap, type RealLedgerAccount, type RealTransaction, type TransactionType } from "./books-data";
import {
  accountBalances,
  accountsForBusiness,
  defaultAccountFor,
  byCategory,
  byMonth,
  cashFlow,
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

describe("accountsForBusiness", () => {
  const accounts = [
    account("Landmark CU - Farm", 454.54, 5),
    account("5553 N Lyd Check", 852.64, 4),
    account("Landmark CU - Realtor", 2076.59, 3),
    // The live "Venmo" row: no business at all.
    account("Venmo", 0, null),
  ];

  it("offers only this business's accounts", () => {
    expect(accountsForBusiness(accounts, [], 5)).toEqual(["Landmark CU - Farm"]);
  });

  it("never offers another business's account", () => {
    // The bug: sorted by name across every business, "5553 N Lyd Check"
    // came first and was pre-filled on a farm entry.
    expect(accountsForBusiness(accounts, [], 5)).not.toContain("5553 N Lyd Check");
  });

  it("includes an account its own transactions already use", () => {
    // "Venmo" has no business_id, so it is in nobody's account list — but
    // farm entries are posted to it, and you have to be able to pick it.
    const rows = accountsForBusiness(accounts, [tx({ business_id: 5, account: "Venmo" })], 5);
    expect(rows).toEqual(["Landmark CU - Farm", "Venmo"]);
  });

  it("doesn't pull in an account only another business posts to", () => {
    const rows = accountsForBusiness(accounts, [tx({ business_id: 4, account: "Venmo" })], 5);
    expect(rows).toEqual(["Landmark CU - Farm"]);
  });

  it("doesn't list the same account twice", () => {
    const rows = accountsForBusiness(accounts, [tx({ business_id: 5, account: "Landmark CU - Farm" })], 5);
    expect(rows).toEqual(["Landmark CU - Farm"]);
  });

  it("matches case-insensitively when de-duplicating", () => {
    const rows = accountsForBusiness(accounts, [tx({ business_id: 5, account: "landmark cu - farm" })], 5);
    expect(rows).toHaveLength(1);
  });

  it("ignores a blank account on a transaction", () => {
    expect(accountsForBusiness(accounts, [tx({ business_id: 5, account: "  " })], 5)).toEqual([
      "Landmark CU - Farm",
    ]);
  });

  it("is empty with no business chosen", () => {
    expect(accountsForBusiness(accounts, [], null)).toEqual([]);
  });
});

describe("defaultAccountFor", () => {
  const accounts = [account("Landmark CU - Farm", 454.54, 5), account("5553 N Lyd Check", 852.64, 4)];

  it("starts on this business's account", () => {
    expect(defaultAccountFor(accounts, [], 5)).toBe("Landmark CU - Farm");
  });

  it("starts on nothing rather than another business's account", () => {
    expect(defaultAccountFor(accounts, [], 99)).toBe("");
  });
});

describe("cashFlow", () => {
  /**
   * Cash in hand, month by month. The figure Reports never shows: a good
   * month can still leave you short because the three before it were not.
   */
  const ledger = [
    tx({ id: 1, date: "2026-05-10", type: "income", amount: 1000 }),
    tx({ id: 2, date: "2026-06-04", type: "expense", amount: 400 }),
    tx({ id: 3, date: "2026-06-20", type: "expense", amount: 100 }),
    tx({ id: 4, date: "2026-07-16", type: "income", amount: 20 }),
  ];

  it("runs the balance forward from one month into the next", () => {
    const { rows } = cashFlow({ transactions: ledger, types, openingCash: 500 });
    expect(rows.map((r) => [r.month, r.opening, r.received, r.spent, r.closing])).toEqual([
      ["2026-05", 500, 1000, 0, 1500],
      ["2026-06", 1500, 0, 500, 1000],
      ["2026-07", 1000, 20, 0, 1020],
    ]);
    // Each month opens exactly where the last one closed. Anything else and
    // the column is decoration rather than a balance.
    for (let i = 1; i < rows.length; i++) expect(rows[i].opening).toBe(rows[i - 1].closing);
  });

  it("carries everything before the window into what the window opens with", () => {
    // The bug this is here to stop: asking for July alone and being told it
    // opened on the account's original $500, when four months of trading
    // happened first. Every closing figure after it would inherit that.
    const { rows, broughtForward } = cashFlow({
      transactions: ledger, types, openingCash: 500, from: "2026-07",
    });
    expect(broughtForward).toBe(1000);
    expect(rows).toHaveLength(1);
    expect(rows[0].opening).toBe(1000);
    expect(rows[0].closing).toBe(1020);
  });

  it("ends a window where it is asked to, not where the ledger ends", () => {
    const { rows } = cashFlow({
      transactions: ledger, types, openingCash: 500, from: "2026-05", to: "2026-06",
    });
    expect(rows.map((r) => r.month)).toEqual(["2026-05", "2026-06"]);
    expect(rows[1].closing).toBe(1000);
  });

  it("shows a quiet month rather than skipping it", () => {
    // A gap in the sequence would make the balance appear to jump, and a
    // month with no entries is exactly the month worth seeing.
    const { rows } = cashFlow({
      transactions: [
        tx({ id: 1, date: "2026-05-10", type: "income", amount: 100 }),
        tx({ id: 2, date: "2026-08-10", type: "expense", amount: 30 }),
      ],
      types,
      openingCash: 0,
    });
    expect(rows.map((r) => r.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    const june = rows[1];
    expect([june.received, june.spent, june.entries]).toEqual([0, 0, 0]);
    // Quiet, not empty: the cash it holds is still the cash it holds.
    expect(june.opening).toBe(100);
    expect(june.closing).toBe(100);
  });

  it("leaves a transfer out, because it does not change what is held", () => {
    // The ledger records one row for a movement between two accounts rather
    // than a matched pair. Counting it would spend money that never left.
    const { rows } = cashFlow({
      transactions: [
        tx({ id: 1, date: "2026-07-01", type: "income", amount: 100 }),
        tx({ id: 2, date: "2026-07-02", type: "transfer", amount: 60 }),
      ],
      types,
      openingCash: 0,
    });
    expect(rows[0].closing).toBe(100);
    expect(rows[0].received).toBe(100);
    expect(rows[0].spent).toBe(0);
    // Still counted as something that happened, so the row is not silently
    // identical to a month in which nothing was recorded at all.
    expect(rows[0].entries).toBe(2);
  });

  it("says what is held when nothing has been posted yet", () => {
    // A new business holds its opening balance. Returning nothing would read
    // as no money rather than no entries.
    const { rows, broughtForward } = cashFlow({ transactions: [], types, openingCash: 852.64 });
    expect(rows).toEqual([]);
    expect(broughtForward).toBe(852.64);
  });

  it("does not accumulate a floating-point tail down the column", () => {
    // Thirty entries of 0.1 is where a running total starts reading
    // 3.0000000000000004, and this column is money.
    const { rows } = cashFlow({
      transactions: Array.from({ length: 30 }, (_, i) =>
        tx({ id: i, date: `2026-0${(i % 3) + 1}-05`, type: "income", amount: 0.1 }),
      ),
      types,
      openingCash: 0,
    });
    expect(rows[rows.length - 1].closing).toBe(3);
    for (const r of rows) expect(r.closing).toBe(Math.round(r.closing * 100) / 100);
  });

  it("does not lead with months from before the ledger existed", () => {
    // Twelve months against a ledger that opens in May would otherwise put
    // six identical rows on top, each holding the opening balance and saying
    // nothing, pushing the real months off the screen.
    const { rows, broughtForward } = cashFlow({
      transactions: ledger, types, openingCash: 500, from: "2025-09", to: "2026-07",
    });
    expect(rows[0].month).toBe("2026-05");
    expect(broughtForward).toBe(500);
  });

  it("returns nothing for a window that runs backwards", () => {
    const { rows } = cashFlow({
      transactions: ledger, types, openingCash: 0, from: "2026-08", to: "2026-05",
    });
    expect(rows).toEqual([]);
  });
});
