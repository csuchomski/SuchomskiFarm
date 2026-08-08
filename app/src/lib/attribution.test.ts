import { describe, expect, it } from "vitest";
import {
  byTransaction,
  splitEvenly,
  unattributed,
  validateAttribution,
  type Attribution,
} from "./attribution";

describe("splitEvenly", () => {
  it("splits a clean amount cleanly", () => {
    expect(splitEvenly(30, 3)).toEqual([10, 10, 10]);
  });

  it("hands out the remainder rather than losing it", () => {
    // Three of $3.33 is $9.99 — the missing penny has to land somewhere.
    expect(splitEvenly(10, 3)).toEqual([3.34, 3.33, 3.33]);
    expect(splitEvenly(10, 3).reduce((s, n) => s + n, 0)).toBeCloseTo(10, 10);
  });

  it("adds back up for awkward amounts too", () => {
    for (const [total, parts] of [
      [33.33, 2],
      [0.05, 3],
      [100, 7],
      [19.99, 4],
    ] as const) {
      const cents = splitEvenly(total, parts).reduce((s, n) => s + Math.round(n * 100), 0);
      expect(cents).toBe(Math.round(total * 100));
    }
  });

  it("gives one part the whole thing", () => {
    expect(splitEvenly(16.67, 1)).toEqual([16.67]);
  });

  it("is empty for no parts, rather than dividing by zero", () => {
    expect(splitEvenly(10, 0)).toEqual([]);
  });
});

describe("validateAttribution", () => {
  const base = {
    total: 30,
    direction: "expense" as const,
    rows: [{ animalId: "a", amount: "20" }],
    categoryId: "cat-1",
    revenueCategory: "other",
  };

  it("accepts a straightforward attribution", () => {
    expect(validateAttribution(base)).toBeNull();
  });

  it("accepts a partial one, because a bill can be part household", () => {
    // $20 of a $30 feed bill. The rest simply isn't attributed.
    expect(validateAttribution({ ...base, rows: [{ animalId: "a", amount: "20" }] })).toBeNull();
  });

  it("refuses more than the transaction, and says both numbers", () => {
    const problem = validateAttribution({ ...base, rows: [{ animalId: "a", amount: "40" }] });
    expect(problem).toMatch(/\$40\.00/);
    expect(problem).toMatch(/\$30\.00/);
  });

  it("accepts a split that exactly fills it", () => {
    expect(
      validateAttribution({
        ...base,
        rows: [
          { animalId: "a", amount: "10" },
          { animalId: "b", amount: "20" },
        ],
      }),
    ).toBeNull();
  });

  it("refuses the same animal twice", () => {
    expect(
      validateAttribution({
        ...base,
        rows: [
          { animalId: "a", amount: "10" },
          { animalId: "a", amount: "10" },
        ],
      }),
    ).toMatch(/twice/);
  });

  it("wants at least one animal", () => {
    expect(validateAttribution({ ...base, rows: [] })).toMatch(/at least one animal/);
    expect(validateAttribution({ ...base, rows: [{ animalId: "", amount: "10" }] })).toMatch(/at least one animal/);
  });

  it("refuses a zero or missing amount", () => {
    expect(validateAttribution({ ...base, rows: [{ animalId: "a", amount: "0" }] })).toMatch(/isn't an attribution/);
    expect(validateAttribution({ ...base, rows: [{ animalId: "a", amount: "" }] })).toMatch(/needs an amount/);
    expect(validateAttribution({ ...base, rows: [{ animalId: "a", amount: "x" }] })).toMatch(/have to be numbers/);
  });

  it("needs an expense category for an expense", () => {
    expect(validateAttribution({ ...base, categoryId: "" })).toMatch(/expense category/);
  });

  it("needs an income category for income, and doesn't ask for the other one", () => {
    const income = { ...base, direction: "income" as const, categoryId: "" };
    expect(validateAttribution(income)).toBeNull();
    expect(validateAttribution({ ...income, revenueCategory: "" })).toMatch(/kind of income/);
  });
});

describe("unattributed", () => {
  it("is what's left of the transaction", () => {
    expect(unattributed(30, [{ amount: "20" }])).toBe(10);
  });

  it("is zero when it all adds up", () => {
    expect(unattributed(10, [{ amount: "3.34" }, { amount: "3.33" }, { amount: "3.33" }])).toBe(0);
  });

  it("never goes negative", () => {
    expect(unattributed(10, [{ amount: "40" }])).toBe(0);
  });

  it("ignores rows with nothing typed in them yet", () => {
    expect(unattributed(30, [{ amount: "20" }, { amount: "" }])).toBe(10);
  });
});

describe("byTransaction", () => {
  const row = (over: Partial<Attribution>): Attribution => ({
    id: "e1",
    kind: "cost",
    transactionId: 1,
    animalId: "a",
    amount: 10,
    ...over,
  });

  it("groups entries under the transaction they belong to", () => {
    const by = byTransaction([
      row({ id: "e1", transactionId: 1 }),
      row({ id: "e2", transactionId: 1, animalId: "b" }),
      row({ id: "e3", transactionId: 2 }),
    ]);
    expect(by.get(1)?.map((r) => r.id)).toEqual(["e1", "e2"]);
    expect(by.get(2)?.map((r) => r.id)).toEqual(["e3"]);
  });

  it("is empty for nothing", () => {
    expect(byTransaction([]).size).toBe(0);
  });
});
