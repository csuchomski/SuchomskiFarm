import { describe, expect, it } from "vitest";
import { directionOf, summarise, typeMap, type RealTransaction, type TransactionType } from "./books-data";

const TYPES: TransactionType[] = [
  { code: "income", label: "Income", direction: "income", active: true, sort_order: 10 },
  { code: "expense", label: "Expense", direction: "expense", active: true, sort_order: 20 },
  { code: "transfer", label: "Transfer", direction: "neutral", active: true, sort_order: 30 },
];
const types = typeMap(TYPES);

const txn = (type: string, amount: number): RealTransaction => ({
  id: Math.random(),
  business_id: 1,
  date: "2026-08-05",
  type,
  category: "Feed",
  amount,
  note: null,
  payer: "S. Mattson",
  account: "Chase",
});

describe("directionOf", () => {
  it("reads the direction from the lookup table, not the name", () => {
    expect(directionOf(txn("income", 10), types)).toBe("income");
    expect(directionOf(txn("expense", 10), types)).toBe("expense");
    expect(directionOf(txn("transfer", 10), types)).toBe("neutral");
  });

  it("tolerates surrounding whitespace in stored values", () => {
    expect(directionOf(txn("  income  ", 10), types)).toBe("income");
  });

  it("reports a type that isn't in the table as unknown", () => {
    expect(directionOf(txn("adjustment", 10), types)).toBe("unknown");
    expect(directionOf(txn("", 10), types)).toBe("unknown");
  });

  it("takes a custom type's direction from the table, however it's named", () => {
    // The point of the lookup table: a type nothing could infer from its name
    // still classifies correctly.
    const custom = typeMap([
      ...TYPES,
      { code: "grant", label: "Grant", direction: "income", active: true, sort_order: 40 },
    ]);
    expect(directionOf(txn("grant", 10), custom)).toBe("income");
  });
});

describe("summarise", () => {
  it("totals income and expenses and nets them", () => {
    const t = summarise([txn("income", 100), txn("income", 50), txn("expense", 30)], types);
    expect(t.income).toBe(150);
    expect(t.expenses).toBe(30);
    expect(t.net).toBe(120);
    expect(t.unknown).toBe(0);
    expect(t.unknownTypes).toEqual([]);
  });

  it("keeps neutral types out of Net — a transfer isn't income or expense", () => {
    const t = summarise([txn("income", 100), txn("transfer", 5000), txn("expense", 40)], types);
    expect(t.net).toBe(60);
    expect(t.neutral).toBe(5000);
    expect(t.unknownTypes).toEqual([]);
  });

  it("quarantines unrecognised types instead of folding them into a total", () => {
    const t = summarise([txn("income", 100), txn("adjustment", 500)], types);
    expect(t.income).toBe(100);
    expect(t.net).toBe(100);
    expect(t.unknown).toBe(500);
    expect(t.unknownTypes).toEqual(["adjustment"]);
  });

  it("reports a blank type legibly rather than as an empty string", () => {
    expect(summarise([txn("   ", 25)], types).unknownTypes).toEqual(["(blank)"]);
  });

  it("treats amounts as magnitudes, so a negative expense doesn't flip the sign", () => {
    const t = summarise([txn("expense", -60)], types);
    expect(t.expenses).toBe(60);
    expect(t.net).toBe(-60);
  });

  it("lists each unknown type once, however many rows use it", () => {
    const t = summarise([txn("adjustment", 10), txn("adjustment", 20), txn("misc", 5)], types);
    expect(t.unknownTypes).toHaveLength(2);
    expect(t.unknown).toBe(35);
  });

  it("returns zeroes for an empty ledger", () => {
    expect(summarise([], types)).toEqual({
      income: 0,
      expenses: 0,
      net: 0,
      neutral: 0,
      unknown: 0,
      unknownTypes: [],
    });
  });

  it("treats everything as unknown when the type table is empty", () => {
    const t = summarise([txn("income", 100)], typeMap([]));
    expect(t.unknown).toBe(100);
    expect(t.net).toBe(0);
  });
});
