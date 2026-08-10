import { describe, expect, it } from "vitest";
import { summariseMoney, type MoneyEntry } from "./animal-money";

/**
 * The arithmetic, which is where the one real decision lives: basis is
 * reported, never netted. See lib/animal-money.ts.
 */

const entry = (over: Partial<MoneyEntry> & { kind: MoneyEntry["kind"]; amountCents: number }): MoneyEntry => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-01-01",
  label: "Breeding and semen",
  note: "",
  source: "manual",
  isBasis: false,
  isInternalTransfer: false,
  ledgerTransactionId: null,
  ...over,
});

describe("summariseMoney", () => {
  it("is all zeroes for an animal with nothing against her", () => {
    expect(summariseMoney([])).toEqual({
      revenueCents: 0,
      operatingCents: 0,
      basisCents: 0,
      netCents: 0,
      entries: 0,
    });
  });

  it("nets revenue against the cost of running her", () => {
    const sum = summariseMoney([
      entry({ kind: "revenue", amountCents: 40000 }),
      entry({ kind: "cost", amountCents: 9500 }),
      entry({ kind: "cost", amountCents: 500 }),
    ]);
    expect(sum.revenueCents).toBe(40000);
    expect(sum.operatingCents).toBe(10000);
    expect(sum.netCents).toBe(30000);
  });

  it("keeps what she cost to buy out of the net", () => {
    // Martha, as she actually stands: $700 to buy, $190 of AI, no revenue.
    const sum = summariseMoney([
      entry({ kind: "cost", amountCents: 70000, isBasis: true, label: "Purchase price / acquisition" }),
      entry({ kind: "cost", amountCents: 9500 }),
      entry({ kind: "cost", amountCents: 9500 }),
    ]);
    expect(sum.basisCents).toBe(70000);
    expect(sum.operatingCents).toBe(19000);
    // Not −$890. What she cost to buy is capital, and rolling it in would say
    // she had a terrible year in the year she was bought and a fine one after.
    expect(sum.netCents).toBe(-19000);
  });

  it("goes negative when she has cost more than she has returned", () => {
    const sum = summariseMoney([
      entry({ kind: "revenue", amountCents: 5000 }),
      entry({ kind: "cost", amountCents: 12000 }),
    ]);
    expect(sum.netCents).toBe(-7000);
  });

  it("leaves internal transfers out of every total", () => {
    const sum = summariseMoney([
      entry({ kind: "cost", amountCents: 9500 }),
      entry({ kind: "cost", amountCents: 30000, isInternalTransfer: true, source: "dam_carryforward" }),
      entry({ kind: "revenue", amountCents: 30000, isInternalTransfer: true }),
      entry({ kind: "cost", amountCents: 70000, isBasis: true, isInternalTransfer: true }),
    ]);
    expect(sum.operatingCents).toBe(9500);
    expect(sum.revenueCents).toBe(0);
    expect(sum.basisCents).toBe(0);
    // Still counted as rows on her page — excluded from the totals is not the
    // same as hidden.
    expect(sum.entries).toBe(4);
  });
});
