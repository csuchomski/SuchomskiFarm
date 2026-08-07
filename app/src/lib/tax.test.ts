import { describe, expect, it } from "vitest";
import { typeMap, type RealTransaction, type TransactionType } from "./books-data";
import {
  buildBalanceSheet,
  buildSchedule,
  categoriesFor,
  compareLines,
  csvCell,
  detailCsv,
  scheduleCsv,
  validateAsset,
  yearsWithActivity,
  type BusinessTypeSchedule,
  type LedgerAsset,
  type TaxCategory,
} from "./tax";

const TYPES: TransactionType[] = [
  { code: "income", label: "Income", direction: "income", active: true, sort_order: 10 },
  { code: "expense", label: "Expense", direction: "expense", active: true, sort_order: 20 },
  { code: "transfer", label: "Transfer", direction: "neutral", active: true, sort_order: 30 },
];
const types = typeMap(TYPES);

const FARM: BusinessTypeSchedule = {
  code: "farm",
  label: "Farm",
  schedule_code: "F",
  schedule_label: "Schedule F — Profit or Loss From Farming",
};

let nextId = 1;
const cat = (
  direction: "income" | "expense",
  label: string,
  line: string,
  sort = 100,
  businessType = "farm",
): TaxCategory => ({
  id: nextId++,
  business_type: businessType,
  direction,
  label,
  schedule_line: line,
  sort_order: sort,
});

const CATEGORIES: TaxCategory[] = [
  cat("income", "Sales of raised livestock & produce", "2", 20),
  cat("income", "Other farm income", "8", 70),
  cat("expense", "Feed", "16", 70),
  cat("expense", "Veterinary, breeding & medicine", "31", 240),
  cat("expense", "Mortgage interest", "21a", 120),
  cat("expense", "Other interest", "21b", 130),
  cat("expense", "Repairs & maintenance", "25", 180),
  // Another business type's category, which must never leak in.
  cat("expense", "Management fees", "11", 70, "rental"),
];

const tx = (over: Partial<RealTransaction> = {}): RealTransaction => ({
  id: over.id ?? 1,
  business_id: over.business_id ?? 5,
  date: over.date ?? "2026-07-16",
  type: over.type ?? "income",
  category: "category" in over ? over.category! : "Other farm income",
  amount: over.amount ?? 20,
  note: over.note ?? null,
  payer: over.payer ?? "Thomas",
  account: over.account ?? "Cash",
});

const build = (transactions: RealTransaction[], year = "2026") =>
  buildSchedule({ businessType: FARM, categories: CATEGORIES, transactions, types, year });

describe("categoriesFor", () => {
  it("returns only this business type's categories, in schedule order", () => {
    const rows = categoriesFor(CATEGORIES, "farm", "expense");
    expect(rows.map((r) => r.schedule_line)).toEqual(["16", "21a", "21b", "25", "31"]);
  });

  it("never leaks another business type's categories", () => {
    // "Management fees" is Schedule E. Offering it on a farm would put money
    // on a line that does not exist on the form being filed.
    expect(categoriesFor(CATEGORIES, "farm", "expense").map((c) => c.label)).not.toContain("Management fees");
  });

  it("keeps income and expense apart", () => {
    expect(categoriesFor(CATEGORIES, "farm", "income").map((c) => c.label)).toEqual([
      "Sales of raised livestock & produce",
      "Other farm income",
    ]);
  });
});

describe("buildSchedule", () => {
  it("puts each category on its line", () => {
    const s = build([
      tx({ id: 1, type: "income", category: "Other farm income", amount: 20 }),
      tx({ id: 2, type: "expense", category: "Feed", amount: 30 }),
    ]);
    expect(s.income.find((l) => l.line === "8")).toMatchObject({ total: 20, entries: 1 });
    expect(s.expenses.find((l) => l.line === "16")).toMatchObject({ total: 30, entries: 1 });
  });

  it("keeps every line of the form, including the empty ones", () => {
    // A filing schedule is a form: line 25 exists whether or not anything
    // was spent on repairs, and it has to be findable against the paper.
    const s = build([tx({ type: "expense", category: "Feed", amount: 30 })]);
    expect(s.expenses.find((l) => l.line === "25")).toMatchObject({ total: 0, entries: 0 });
  });

  it("totals income, expenses and net", () => {
    const s = build([
      tx({ id: 1, type: "income", category: "Other farm income", amount: 100 }),
      tx({ id: 2, type: "expense", category: "Feed", amount: 30 }),
    ]);
    expect(s).toMatchObject({ incomeTotal: 100, expenseTotal: 30, net: 70 });
  });

  it("reports a loss as a negative net", () => {
    const s = build([tx({ type: "expense", category: "Feed", amount: 500 })]);
    expect(s.net).toBe(-500);
  });

  it("matches a category case-insensitively", () => {
    const s = build([tx({ type: "expense", category: "feed", amount: 10 })]);
    expect(s.expenses.find((l) => l.line === "16")?.total).toBe(10);
    expect(s.unmapped).toEqual([]);
  });

  it("counts unmapped money in the totals but flags it", () => {
    // Dropping it would make the schedule quietly understate the year. This
    // has to be visible and still add up.
    const s = build([
      tx({ id: 1, type: "expense", category: "Mystery spend", amount: 40 }),
      tx({ id: 2, type: "expense", category: "Feed", amount: 10 }),
    ]);
    expect(s.expenseTotal).toBe(50);
    expect(s.unmapped).toEqual([{ category: "Mystery spend", direction: "expense", total: 40, entries: 1 }]);
  });

  it("labels a blank category rather than losing it", () => {
    const s = build([tx({ type: "expense", category: "", amount: 12 })]);
    expect(s.unmapped[0]).toMatchObject({ category: "(blank)", total: 12 });
  });

  it("leaves transfers off the schedule entirely", () => {
    const s = build([tx({ type: "transfer", category: "Moving money", amount: 500 })]);
    expect(s).toMatchObject({ incomeTotal: 0, expenseTotal: 0, net: 0 });
    expect(s.unmapped).toEqual([]);
  });

  it("orders lines by the form, not alphabetically", () => {
    const s = build([]);
    expect(s.expenses.map((l) => l.line)).toEqual(["16", "21a", "21b", "25", "31"]);
  });

  it("pools several entries onto one line", () => {
    const s = build([
      tx({ id: 1, type: "expense", category: "Feed", amount: 10 }),
      tx({ id: 2, type: "expense", category: "Feed", amount: 15 }),
    ]);
    expect(s.expenses.find((l) => l.line === "16")).toMatchObject({ total: 25, entries: 2 });
  });

  it("carries the schedule's identity", () => {
    expect(build([])).toMatchObject({ scheduleCode: "F", year: "2026" });
  });

  it("says so rather than guessing when the business type is unknown", () => {
    const s = buildSchedule({ businessType: undefined, categories: CATEGORIES, transactions: [], types, year: "2026" });
    expect(s.scheduleCode).toBe("—");
    expect(s.income).toEqual([]);
  });
});

describe("compareLines", () => {
  it("sorts numerically, not as text", () => {
    expect(["10", "2", "21"].sort(compareLines)).toEqual(["2", "10", "21"]);
  });

  it("puts a lettered line after its bare number", () => {
    expect(["21b", "21a", "21", "22"].sort(compareLines)).toEqual(["21", "21a", "21b", "22"]);
  });
});

describe("yearsWithActivity", () => {
  it("lists years with entries, newest first", () => {
    const years = yearsWithActivity([tx({ date: "2025-03-01" }), tx({ date: "2026-07-16" })], "2026-08-07");
    expect(years).toEqual(["2026", "2025"]);
  });

  it("always includes the current year, even with nothing posted", () => {
    expect(yearsWithActivity([], "2026-08-07")).toEqual(["2026"]);
  });

  it("doesn't repeat the current year", () => {
    expect(yearsWithActivity([tx({ date: "2026-01-01" })], "2026-08-07")).toEqual(["2026"]);
  });
});

describe("validateAsset", () => {
  it("accepts a normal entry", () => {
    expect(validateAsset({ name: "Tractor", value: "18000" })).toBeNull();
  });

  it("needs a name and a value", () => {
    expect(validateAsset({ name: "", value: "100" })).toMatch(/name/);
    expect(validateAsset({ name: "Tractor", value: "" })).toMatch(/worth/);
  });

  it("explains that a liability goes in positive", () => {
    // The column is `check (value >= 0)`, so a negative fails at the database
    // with a constraint error nobody can act on.
    expect(validateAsset({ name: "Equipment loan", value: "-5000" })).toMatch(/positive amount/);
  });

  it("rejects nonsense", () => {
    expect(validateAsset({ name: "Tractor", value: "lots" })).toMatch(/has to be a number/);
  });

  it("allows zero", () => {
    expect(validateAsset({ name: "Fully depreciated trailer", value: "0" })).toBeNull();
  });
});

describe("buildBalanceSheet", () => {
  const asset = (over: Partial<LedgerAsset>): LedgerAsset => ({
    id: over.id ?? 1,
    business_id: 5,
    kind: over.kind ?? "asset",
    name: over.name ?? "Tractor",
    value: over.value ?? 18000,
  });

  it("adds cash to recorded assets and subtracts liabilities", () => {
    const sheet = buildBalanceSheet(
      [{ account: "Landmark CU - Farm", balance: 454.54 }],
      [asset({ id: 1, name: "Tractor", value: 18000 }), asset({ id: 2, kind: "liability", name: "Equipment loan", value: 6000 })],
    );
    expect(sheet).toMatchObject({ cashTotal: 454.54, assetTotal: 18454.54, liabilityTotal: 6000, equity: 12454.54 });
  });

  it("won't count an account twice because it was also entered by hand", () => {
    // Recording "Landmark CU - Farm" as an asset as well as reading its
    // balance would double that money on the balance sheet.
    const sheet = buildBalanceSheet(
      [{ account: "Landmark CU - Farm", balance: 500 }],
      [asset({ name: "Landmark CU - Farm", value: 500 })],
    );
    expect(sheet.assetTotal).toBe(500);
    expect(sheet.otherAssets).toEqual([]);
  });

  it("ignores case and padding when matching an account name", () => {
    const sheet = buildBalanceSheet([{ account: "Cash", balance: 100 }], [asset({ name: "  cash  ", value: 100 })]);
    expect(sheet.assetTotal).toBe(100);
  });

  it("goes negative on equity when liabilities exceed assets", () => {
    const sheet = buildBalanceSheet([], [asset({ kind: "liability", name: "Mortgage", value: 200000 })]);
    expect(sheet.equity).toBe(-200000);
  });

  it("is all zeros with nothing recorded", () => {
    expect(buildBalanceSheet([], [])).toMatchObject({ cashTotal: 0, assetTotal: 0, liabilityTotal: 0, equity: 0 });
  });

  it("includes an overdrawn account as negative cash", () => {
    const sheet = buildBalanceSheet([{ account: "Cash", balance: -50 }], []);
    expect(sheet.assetTotal).toBe(-50);
  });
});

describe("csvCell", () => {
  it("quotes every field, so a comma in a category can't split the row", () => {
    expect(csvCell("Rent/lease — machinery, equipment")).toBe('"Rent/lease — machinery, equipment"');
  });

  it("doubles an embedded quote", () => {
    expect(csvCell('He said "hay"')).toBe('"He said ""hay"""');
  });

  it("renders null and undefined as empty, not as the word", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("keeps a number as written", () => {
    expect(csvCell(20.5)).toBe('"20.5"');
  });
});

describe("scheduleCsv", () => {
  it("carries the business, schedule, year and every line", () => {
    const s = build([
      tx({ id: 1, type: "income", category: "Other farm income", amount: 20 }),
      tx({ id: 2, type: "expense", category: "Feed", amount: 30 }),
    ]);
    const csv = scheduleCsv(s, "Suchomski Family Farm");
    expect(csv).toContain('"Suchomski Family Farm"');
    expect(csv).toContain('"Schedule F — Profit or Loss From Farming"');
    expect(csv).toContain('"Income","8","Other farm income","20.00"');
    expect(csv).toContain('"Expense","16","Feed","30.00"');
    expect(csv).toContain('"Net profit or loss (Schedule F)","-10.00"');
  });

  it("lists unmapped money so it can't be filed by accident", () => {
    const s = build([tx({ type: "expense", category: "Mystery", amount: 40 })]);
    expect(scheduleCsv(s, "Farm")).toContain('"Mystery (expense)","40.00"');
  });
});

describe("detailCsv", () => {
  it("gives every transaction the line it landed on", () => {
    const csv = detailCsv({
      transactions: [tx({ id: 1, type: "expense", category: "Feed", amount: 30, payer: "Co-op" })],
      categories: CATEGORIES,
      types,
      businessType: "farm",
      businessName: "Suchomski Family Farm",
    });
    expect(csv).toContain('"2026-07-16","expense","16","Feed","30.00","Co-op"');
  });

  it("marks a transaction that maps to no line", () => {
    const csv = detailCsv({
      transactions: [tx({ type: "expense", category: "Mystery", amount: 5 })],
      categories: CATEGORIES,
      types,
      businessType: "farm",
      businessName: "Farm",
    });
    expect(csv).toContain('"UNMAPPED"');
  });

  it("sorts oldest first, the way a ledger reads", () => {
    const csv = detailCsv({
      transactions: [tx({ id: 1, date: "2026-08-01" }), tx({ id: 2, date: "2026-01-05" })],
      categories: CATEGORIES,
      types,
      businessType: "farm",
      businessName: "Farm",
    });
    expect(csv.indexOf("2026-01-05")).toBeLessThan(csv.indexOf("2026-08-01"));
  });
});
