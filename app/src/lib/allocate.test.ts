import { describe, expect, it } from "vitest";
import { allocateCents, dollarsToCents } from "./allocate";

const evenTargets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, weight: 1 }));
const sum = (rows: { amountCents: number }[]) => rows.reduce((s, r) => s + r.amountCents, 0);

describe("allocateCents", () => {
  it("never loses a cent on the case that motivated this: $612 across 41 head", () => {
    const total = dollarsToCents(612);
    const rows = allocateCents(total, evenTargets(41));
    expect(sum(rows)).toBe(total);
    // 61200 / 41 = 1492.68…, so most get 1492 and the remainder is handed out.
    expect(rows.filter((r) => r.amountCents === 1493)).toHaveLength(28);
    expect(rows.filter((r) => r.amountCents === 1492)).toHaveLength(13);
  });

  it("sums to the total for any herd size and any amount", () => {
    for (let head = 1; head <= 60; head++) {
      for (const dollars of [0.01, 1, 9.99, 612, 1234.56, 99999.99]) {
        const total = dollarsToCents(dollars);
        expect(sum(allocateCents(total, evenTargets(head)))).toBe(total);
      }
    }
  });

  it("weights by production when weights differ", () => {
    const rows = allocateCents(1000, [
      { id: "high", weight: 3 },
      { id: "low", weight: 1 },
    ]);
    expect(rows).toEqual([
      { id: "high", amountCents: 750 },
      { id: "low", amountCents: 250 },
    ]);
  });

  it("gives leftover cents to the largest fractional remainders", () => {
    // 100 / 3 = 33.33 each; the two extra cents go to the first two by order.
    const rows = allocateCents(100, evenTargets(3));
    expect(rows.map((r) => r.amountCents)).toEqual([34, 33, 33]);
    expect(sum(rows)).toBe(100);
  });

  it("is deterministic — same input, same split", () => {
    const a = allocateCents(61200, evenTargets(41));
    const b = allocateCents(61200, evenTargets(41));
    expect(a).toEqual(b);
  });

  it("falls back to an even split when every weight is zero (a dry herd)", () => {
    const rows = allocateCents(300, [
      { id: "a", weight: 0 },
      { id: "b", weight: 0 },
      { id: "c", weight: 0 },
    ]);
    expect(rows.map((r) => r.amountCents)).toEqual([100, 100, 100]);
  });

  it("handles negative totals (a refund) without losing a cent", () => {
    const rows = allocateCents(-100, evenTargets(3));
    expect(sum(rows)).toBe(-100);
    expect(rows.map((r) => r.amountCents)).toEqual([-34, -33, -33]);
  });

  it("returns nothing for an empty herd rather than throwing", () => {
    expect(allocateCents(500, [])).toEqual([]);
  });

  it("rejects fractional cents rather than rounding silently", () => {
    expect(() => allocateCents(10.5, evenTargets(2))).toThrow(/whole cents/);
  });
});

describe("dollarsToCents", () => {
  it("handles the float cases that bite naive multiplication", () => {
    expect(dollarsToCents(1.15)).toBe(115);
    expect(dollarsToCents(612)).toBe(61200);
    expect(dollarsToCents(0.07)).toBe(7);
    expect(dollarsToCents(1234.56)).toBe(123456);
  });
});
