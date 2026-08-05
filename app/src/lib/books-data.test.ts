import { describe, expect, it } from "vitest";
import { directionOf, summarise, type RealTransaction } from "./books-data";

const txn = (type: string, amount: number): RealTransaction => ({
  id: Math.random(),
  business_id: 1,
  date: "2026-08-05",
  type,
  category: "Feed",
  amount,
  note: null,
  payer: "",
  account: "Chase",
});

describe("directionOf", () => {
  it("recognises the common spellings either way", () => {
    for (const t of ["income", "Income", " revenue ", "SALE", "sales", "deposit", "credit"]) {
      expect(directionOf(txn(t, 10))).toBe("income");
    }
    for (const t of ["expense", "Expenses", "cost", "purchase", "debit", "bill"]) {
      expect(directionOf(txn(t, 10))).toBe("expense");
    }
  });

  it("reports anything else as unknown rather than guessing", () => {
    for (const t of ["", "transfer", "adjustment", "refund", "xfer", "misc"]) {
      expect(directionOf(txn(t, 10))).toBe("unknown");
    }
  });

  it("does not match on a prefix — 'incoming transfer' is not income", () => {
    expect(directionOf(txn("incoming transfer", 10))).toBe("unknown");
    expect(directionOf(txn("expense reimbursement", 10))).toBe("unknown");
  });
});

describe("summarise", () => {
  it("totals income and expenses and nets them", () => {
    const t = summarise([txn("income", 100), txn("income", 50), txn("expense", 30)]);
    expect(t.income).toBe(150);
    expect(t.expenses).toBe(30);
    expect(t.net).toBe(120);
    expect(t.unknown).toBe(0);
    expect(t.unknownTypes).toEqual([]);
  });

  it("quarantines unrecognised types instead of folding them into a total", () => {
    const t = summarise([txn("income", 100), txn("transfer", 500), txn("expense", 40)]);
    expect(t.income).toBe(100);
    expect(t.expenses).toBe(40);
    expect(t.net).toBe(60); // the 500 must not move Net
    expect(t.unknown).toBe(500);
    expect(t.unknownTypes).toEqual(["transfer"]);
  });

  it("reports a blank type legibly rather than as an empty string", () => {
    expect(summarise([txn("   ", 25)]).unknownTypes).toEqual(["(blank)"]);
  });

  it("treats amounts as magnitudes, so a negative expense doesn't flip the sign", () => {
    const t = summarise([txn("expense", -60)]);
    expect(t.expenses).toBe(60);
    expect(t.net).toBe(-60);
  });

  it("lists each unknown type once, however many rows use it", () => {
    const t = summarise([txn("transfer", 10), txn("transfer", 20), txn("adjustment", 5)]);
    expect(t.unknownTypes).toHaveLength(2);
    expect(t.unknown).toBe(35);
  });

  it("returns zeroes for an empty ledger", () => {
    expect(summarise([])).toEqual({ income: 0, expenses: 0, net: 0, unknown: 0, unknownTypes: [] });
  });
});
