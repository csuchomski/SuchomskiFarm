import { describe, expect, it } from "vitest";
import {
  amountDue,
  byCustomer,
  customerName,
  customerShort,
  daysWaiting,
  expectedValue,
  isOpen,
  totalsOf,
  validateCollection,
  validatePickup,
  validateReserve,
  type Customer,
  type RealOrder,
} from "./orders";

const TODAY = "2026-08-07";

const order = (over: Partial<RealOrder> = {}): RealOrder => ({
  id: over.id ?? 1,
  customer_id: over.customer_id ?? "cust-1",
  product_id: over.product_id ?? 1,
  quantity: over.quantity ?? 2,
  status: over.status ?? "reserved",
  reserved_date: "reserved_date" in over ? over.reserved_date! : "2026-08-05T12:00:00Z",
  picked_up_date: over.picked_up_date ?? null,
  cancelled_date: over.cancelled_date ?? null,
  unit_price: "unit_price" in over ? over.unit_price! : null,
  total_cost: "total_cost" in over ? over.total_cost! : null,
  amount_paid: "amount_paid" in over ? over.amount_paid! : null,
  payment_method: over.payment_method ?? null,
  business_id: over.business_id ?? 5,
});

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: over.id ?? "cust-1",
  first_name: "first_name" in over ? over.first_name! : "Meghan",
  last_name: "last_name" in over ? over.last_name! : "Suchomski",
  email: "email" in over ? over.email! : "meghan@example.com",
  phone: null,
  role: over.role ?? "buyer",
  archived_at: "archived_at" in over ? over.archived_at! : null,
  created_at: over.created_at ?? "2026-05-01T00:00:00Z",
  has_login: over.has_login ?? true,
});

describe("customerName", () => {
  it("uses the full name when there is one", () => {
    expect(customerName(customer())).toBe("Meghan Suchomski");
  });

  it("falls back to the email, which actually identifies someone", () => {
    // Three profiles on this farm have a blank first_name. "Customer
    // 3f7f42e9" would be useless on a pickup list.
    expect(customerName(customer({ first_name: "", last_name: "" }))).toBe("meghan@example.com");
  });

  it("handles a profile with neither", () => {
    expect(customerName(customer({ first_name: "", last_name: "", email: "" }))).toBe("Unnamed customer");
  });

  it("says so when the profile is missing entirely", () => {
    expect(customerName(undefined)).toBe("Unknown customer");
  });

  it("copes with a first name and no last name", () => {
    expect(customerName(customer({ last_name: "" }))).toBe("Meghan");
  });
});

describe("customerShort", () => {
  it("prefers the first name", () => {
    expect(customerShort(customer())).toBe("Meghan");
  });

  it("uses the local part of the email otherwise", () => {
    expect(customerShort(customer({ first_name: "" }))).toBe("meghan");
  });
});

describe("daysWaiting", () => {
  it("counts days since the reservation", () => {
    expect(daysWaiting(order({ reserved_date: "2026-08-05T12:00:00Z" }), TODAY)).toBe(2);
  });

  it("is zero on the day it was reserved", () => {
    expect(daysWaiting(order({ reserved_date: "2026-08-07T09:00:00Z" }), TODAY)).toBe(0);
  });

  it("is null for an order that's already been collected", () => {
    expect(daysWaiting(order({ status: "completed" }), TODAY)).toBeNull();
  });

  it("is null when there's no reserved date to count from", () => {
    expect(daysWaiting(order({ reserved_date: null }), TODAY)).toBeNull();
  });

  it("never goes negative on a clock skew", () => {
    expect(daysWaiting(order({ reserved_date: "2026-08-09T00:00:00Z" }), TODAY)).toBe(0);
  });
});

describe("expectedValue", () => {
  it("prices an open order from the product's current price", () => {
    expect(expectedValue(order({ quantity: 2 }), 10)).toBe(20);
  });

  it("is null when the product has no price, rather than zero", () => {
    // Zero would quietly report a $0 order as fully accounted for.
    expect(expectedValue(order(), null)).toBeNull();
  });

  it("rounds to cents", () => {
    expect(expectedValue(order({ quantity: 1.5 }), 6.99)).toBe(10.49);
  });
});

describe("totalsOf", () => {
  it("counts open orders and what they hold", () => {
    const totals = totalsOf([order({ id: 1, quantity: 2 }), order({ id: 2, quantity: 3 })]);
    expect(totals).toMatchObject({ open: 2, openQuantity: 5, collected: 0 });
  });

  it("takes money from amount_paid, not total_cost", () => {
    const totals = totalsOf([
      order({ id: 1, status: "completed", total_cost: 50, amount_paid: 50 }),
      order({ id: 2, status: "completed", total_cost: 15, amount_paid: 15 }),
    ]);
    expect(totals.takings).toBe(65);
    expect(totals.collected).toBe(2);
  });

  it("counts a part payment as owed", () => {
    const totals = totalsOf([order({ status: "completed", total_cost: 50, amount_paid: 30 })]);
    expect(totals.takings).toBe(30);
    expect(totals.owed).toBe(20);
  });

  it("leaves an unpriced collection out of owed rather than calling it a debt", () => {
    // Four completed orders on this farm have no price at all — the farmer
    // collected their own milk. Treating null as a $0 total would be fine;
    // treating it as an unpaid balance would invent a debt.
    const totals = totalsOf([order({ status: "completed", total_cost: null, amount_paid: null })]);
    expect(totals.owed).toBe(0);
    expect(totals.collected).toBe(1);
  });

  it("ignores cancelled orders entirely", () => {
    const totals = totalsOf([order({ status: "cancelled", total_cost: 20, amount_paid: 0 })]);
    expect(totals).toMatchObject({ open: 0, collected: 0, takings: 0, owed: 0 });
  });

  it("doesn't report a rounding sliver as money owed", () => {
    const totals = totalsOf([order({ status: "completed", total_cost: 10.001, amount_paid: 10 })]);
    expect(totals.owed).toBe(0);
  });

  it("is all zeros for no orders", () => {
    expect(totalsOf([])).toEqual({ open: 0, openQuantity: 0, collected: 0, takings: 0, owed: 0 });
  });
});

describe("byCustomer", () => {
  it("pools a customer's orders into one row", () => {
    const rows = byCustomer([
      order({ id: 1, customer_id: "a", status: "completed", amount_paid: 20, picked_up_date: "2026-06-10T00:00:00Z" }),
      order({ id: 2, customer_id: "a", status: "completed", amount_paid: 15, picked_up_date: "2026-06-24T00:00:00Z" }),
    ]);
    expect(rows).toEqual([{ customerId: "a", orders: 2, openOrders: 0, spent: 35, lastOrder: "2026-06-24" }]);
  });

  it("puts the biggest spender first", () => {
    const rows = byCustomer([
      order({ id: 1, customer_id: "small", status: "completed", amount_paid: 5 }),
      order({ id: 2, customer_id: "big", status: "completed", amount_paid: 50 }),
    ]);
    expect(rows.map((r) => r.customerId)).toEqual(["big", "small"]);
  });

  it("counts open orders separately from spend", () => {
    const rows = byCustomer([order({ customer_id: "a", status: "reserved", quantity: 2 })]);
    expect(rows[0]).toMatchObject({ orders: 1, openOrders: 1, spent: 0 });
  });

  it("dates a still-open order by when it was reserved", () => {
    const rows = byCustomer([order({ customer_id: "a", reserved_date: "2026-08-05T12:00:00Z" })]);
    expect(rows[0].lastOrder).toBe("2026-08-05");
  });

  it("is empty with no orders", () => {
    expect(byCustomer([])).toEqual([]);
  });
});

describe("validatePickup", () => {
  const base = { order: { quantity: 3, status: "reserved" }, finalQuantity: "3", paymentMethod: "Cash", amountPaid: "30" };

  it("accepts a normal collection", () => {
    expect(validatePickup(base)).toBeNull();
  });

  it("accepts a short pickup, which releases the rest", () => {
    expect(validatePickup({ ...base, finalQuantity: "2" })).toBeNull();
  });

  it("accepts collecting nothing", () => {
    expect(validatePickup({ ...base, finalQuantity: "0", amountPaid: "0" })).toBeNull();
  });

  it("refuses to collect more than was reserved, and says how much that was", () => {
    // complete_pickup raises 'Invalid final quantity' here; this catches it
    // first with the number in the message.
    expect(validatePickup({ ...base, finalQuantity: "5" })).toMatch(/reserved 3/);
  });

  it("rejects a negative or non-numeric quantity", () => {
    expect(validatePickup({ ...base, finalQuantity: "-1" })).toMatch(/negative/);
    expect(validatePickup({ ...base, finalQuantity: "abc" })).toMatch(/has to be a number/);
  });

  it("asks for the quantity rather than assuming the full order", () => {
    expect(validatePickup({ ...base, finalQuantity: "" })).toMatch(/How much/);
  });

  it("allows no payment method, which is a real case here", () => {
    expect(validatePickup({ ...base, paymentMethod: "", amountPaid: "" })).toBeNull();
  });

  it("rejects a payment method the database would refuse", () => {
    expect(validatePickup({ ...base, paymentMethod: "Cheque" })).toMatch(/Cash or Venmo/);
  });

  it("takes the list of methods from the caller, who read it from the table", () => {
    // Without `allowed` it falls back to what the functions accepted before
    // migration 022, so Check is refused…
    expect(validatePickup({ ...base, paymentMethod: "Check" })).toMatch(/Cash or Venmo/);
    // …and accepted once the page has actually fetched the list.
    expect(validatePickup({ ...base, paymentMethod: "Check", allowed: ["Cash", "Venmo", "Check"] })).toBeNull();
  });

  it("rejects a negative payment", () => {
    expect(validatePickup({ ...base, amountPaid: "-5" })).toMatch(/can't be negative/);
  });

  it("refuses an order that isn't open", () => {
    expect(validatePickup({ ...base, order: { quantity: 3, status: "completed" } })).toMatch(/isn't open/);
  });
});

describe("validateReserve", () => {
  const base = { productId: "1", quantity: "2", customerId: "cust-1", available: 5 };

  it("accepts a normal reservation", () => {
    expect(validateReserve(base)).toBeNull();
  });

  it("needs a customer and a product", () => {
    expect(validateReserve({ ...base, customerId: "" })).toMatch(/Who is this order for/);
    expect(validateReserve({ ...base, productId: "" })).toMatch(/Pick a product/);
  });

  it("won't oversell what's on the shelf", () => {
    expect(validateReserve({ ...base, quantity: "9" })).toMatch(/Only 5 available/);
  });

  it("allows reserving everything that's left", () => {
    expect(validateReserve({ ...base, quantity: "5" })).toBeNull();
  });

  it("rejects zero and nonsense", () => {
    expect(validateReserve({ ...base, quantity: "0" })).toMatch(/at least some/);
    expect(validateReserve({ ...base, quantity: "abc" })).toMatch(/has to be a number/);
  });
});

describe("isOpen", () => {
  it("is true only for a reserved order", () => {
    expect(isOpen(order({ status: "reserved" }))).toBe(true);
    expect(isOpen(order({ status: "completed" }))).toBe(false);
    expect(isOpen(order({ status: "cancelled" }))).toBe(false);
  });
});

describe("validateCollection", () => {
  const base = { ordered: 4, quantity: "4", paymentMethod: "Check", allowed: ["Cash", "Venmo", "Check"] };

  it("accepts the whole thing, paid for", () => {
    expect(validateCollection(base)).toBeNull();
  });

  it("accepts taking less than was reserved", () => {
    expect(validateCollection({ ...base, quantity: "2.5" })).toBeNull();
  });

  it("refuses more than was reserved, and says what it was for", () => {
    // Since migration 022 the database refuses this too, for a customer.
    expect(validateCollection({ ...base, quantity: "40" })).toMatch(/This is for 4\./);
  });

  it("refuses nothing at all, which is a cancellation rather than a pickup", () => {
    expect(validateCollection({ ...base, quantity: "0" })).toMatch(/cancel it instead/);
  });

  it("requires a payment method, unlike the farmer's form", () => {
    // complete_pickup accepts a null method — "collected, not paid" is a real
    // state the farmer records. A customer ticking their own order off
    // without saying how is just a hole in the books.
    expect(validateCollection({ ...base, paymentMethod: "" })).toMatch(/How did you pay/);
  });

  it("refuses a method that isn't on the list", () => {
    expect(validateCollection({ ...base, paymentMethod: "Barter" })).toMatch(/Cash or Venmo or Check/);
  });

  it("wants a number", () => {
    expect(validateCollection({ ...base, quantity: "" })).toMatch(/How much/);
    expect(validateCollection({ ...base, quantity: "some" })).toMatch(/has to be a number/);
  });
});

describe("amountDue", () => {
  it("prices a collection from the product's price", () => {
    expect(amountDue(10, 2)).toBe(20);
    expect(amountDue(6.5, 1.5)).toBe(9.75);
  });

  it("rounds to the cent", () => {
    expect(amountDue(3.33, 3)).toBe(9.99);
    // 0.1 * 3 is 0.30000000000000004 in floating point.
    expect(amountDue(0.1, 3)).toBe(0.3);
  });

  it("is null for an unpriced product, which is not the same as free", () => {
    expect(amountDue(null, 2)).toBeNull();
    expect(amountDue(undefined, 2)).toBeNull();
  });
});
