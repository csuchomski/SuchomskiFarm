import { describe, expect, it } from "vitest";
import { outstanding, type CustomerOrder } from "./customer";

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
