import { describe, expect, it } from "vitest";
import { groupByDate, historyDate, outstanding, type CustomerOrder } from "./customer";

const collected = (over: Partial<CustomerOrder> = {}): CustomerOrder => ({
  id: 1,
  product_id: 1,
  quantity: 2,
  status: "completed",
  reserved_date: "2026-06-01T00:00:00Z",
  picked_up_date: "2026-06-03T00:00:00Z",
  cancelled_date: null,
  unit_price: 10,
  total_cost: 20,
  amount_paid: 20,
  payment_method: "Cash",
  ...over,
});

describe("outstanding", () => {
  it("is zero when the order was paid in full", () => {
    expect(outstanding(collected())).toBe(0);
  });

  it("is what's left when only part was handed over", () => {
    expect(outstanding(collected({ amount_paid: 12 }))).toBe(8);
  });

  it("goes negative on an overpayment rather than clamping", () => {
    // Worth showing on the customer's own history — $20 handed over for a
    // $15 pickup is a thing they'd want to see, not something to round away.
    expect(outstanding(collected({ total_cost: 15, amount_paid: 20 }))).toBe(-5);
  });

  it("ignores a sub-cent difference, the same way totalsOf does", () => {
    expect(outstanding(collected({ total_cost: 20.001, amount_paid: 20 }))).toBe(0);
  });

  it("is null for an unpriced order rather than calling the whole thing a debt", () => {
    // Four completed orders on this farm have neither figure — the farmer
    // collected their own milk before the store priced anything.
    expect(outstanding(collected({ total_cost: null, amount_paid: null }))).toBeNull();
  });

  it("is null when only one of the two figures exists", () => {
    expect(outstanding(collected({ amount_paid: null }))).toBeNull();
    expect(outstanding(collected({ total_cost: null }))).toBeNull();
  });

  it("is null for an order that was never collected", () => {
    // A cancellation cost nothing, and an open reservation isn't owed yet.
    expect(outstanding(collected({ picked_up_date: null, cancelled_date: "2026-06-02T00:00:00Z" }))).toBeNull();
    expect(outstanding(collected({ picked_up_date: null, status: "reserved" }))).toBeNull();
  });

  it("rounds the gap to the cent", () => {
    expect(outstanding(collected({ total_cost: 9.99, amount_paid: 3.33 }))).toBe(6.66);
  });
});

describe("historyDate", () => {
  it("uses the day it was collected", () => {
    expect(historyDate(collected({ picked_up_date: "2026-06-24T17:00:00Z" }))).toBe("2026-06-24");
  });

  it("falls back to the day it was cancelled", () => {
    expect(
      historyDate(collected({ picked_up_date: null, cancelled_date: "2026-05-21T17:00:00Z" })),
    ).toBe("2026-05-21");
  });

  it("prefers the pickup when an order somehow has both", () => {
    expect(
      historyDate(collected({ picked_up_date: "2026-06-24T17:00:00Z", cancelled_date: "2026-06-01T17:00:00Z" })),
    ).toBe("2026-06-24");
  });

  it("is null for an order that hasn't finished", () => {
    expect(historyDate(collected({ picked_up_date: null }))).toBeNull();
  });

  it("is null rather than 'NaN-NaN-NaN' on a date it can't read", () => {
    expect(historyDate(collected({ picked_up_date: "not a date" }))).toBeNull();
  });
});

describe("groupByDate", () => {
  const on = (id: number, day: string, over: Partial<CustomerOrder> = {}) =>
    collected({ id, picked_up_date: `${day}T17:00:00Z`, ...over });

  it("puts a day's orders under one entry", () => {
    const days = groupByDate([on(1, "2026-06-24"), on(2, "2026-06-24", { total_cost: 7, amount_paid: 7 })]);
    expect(days.length).toBe(1);
    expect(days[0].date).toBe("2026-06-24");
    expect(days[0].orders.map((o) => o.id)).toEqual([1, 2]);
  });

  it("totals what the day's pickups cost", () => {
    const days = groupByDate([on(1, "2026-06-24"), on(2, "2026-06-24", { total_cost: 7, amount_paid: 7 })]);
    // $20 + $7 — the total, not what was handed over.
    expect(days[0].total).toBe(27);
  });

  it("puts the newest day first, whatever order they arrive in", () => {
    const days = groupByDate([on(1, "2026-05-02"), on(2, "2026-06-24"), on(3, "2026-06-03")]);
    expect(days.map((d) => d.date)).toEqual(["2026-06-24", "2026-06-03", "2026-05-02"]);
  });

  it("groups on when an order finished, not when it was reserved", () => {
    // A reservation made in May and collected in July belongs under July.
    const days = groupByDate([
      on(1, "2026-07-02", { reserved_date: "2026-05-01T00:00:00Z" }),
      on(2, "2026-07-02", { reserved_date: "2026-06-28T00:00:00Z" }),
    ]);
    expect(days.length).toBe(1);
    expect(days[0].date).toBe("2026-07-02");
  });

  it("has no total for a day of unpriced pickups, rather than $0", () => {
    const days = groupByDate([on(1, "2026-05-02", { total_cost: null, amount_paid: null })]);
    expect(days[0].total).toBeNull();
  });

  it("totals only the priced ones when a day has both", () => {
    const days = groupByDate([on(1, "2026-05-02"), on(2, "2026-05-02", { total_cost: null, amount_paid: null })]);
    expect(days[0].total).toBe(20);
  });

  it("leaves a cancelled order out of the day's total but keeps its row", () => {
    const days = groupByDate([
      on(1, "2026-05-21"),
      collected({ id: 2, picked_up_date: null, cancelled_date: "2026-05-21T17:00:00Z", status: "cancelled" }),
    ]);
    expect(days[0].orders.length).toBe(2);
    expect(days[0].total).toBe(20);
  });

  it("drops an order with no date at all rather than inventing a group", () => {
    const days = groupByDate([collected({ picked_up_date: null })]);
    expect(days).toEqual([]);
  });

  it("is empty for no orders", () => {
    expect(groupByDate([])).toEqual([]);
  });
});
