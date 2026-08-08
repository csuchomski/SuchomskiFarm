import { describe, expect, it } from "vitest";
import { isArchived, validateCustomer } from "./customers";
import type { Customer } from "./orders";

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: "cust-1",
  first_name: "Meghan",
  last_name: "Suchomski",
  email: "meghan@example.com",
  phone: null,
  role: "buyer",
  archived_at: null,
  created_at: "2026-05-01T00:00:00Z",
  ...over,
});

describe("isArchived", () => {
  it("is false for an active customer", () => {
    expect(isArchived(customer())).toBe(false);
  });

  it("is true once archived_at is set", () => {
    expect(isArchived(customer({ archived_at: "2026-07-01T00:00:00Z" }))).toBe(true);
  });

  it("treats a missing column as active, not archived", () => {
    // The regression this exists for: `archived_at !== null` is true for
    // undefined, so a row from a schema cache predating migration 024 would
    // mark every customer archived and empty the list — silently, because
    // nothing errors. Hiding one customer wrongly is a nuisance; hiding all
    // of them is a broken page.
    const stale = { ...customer() } as Partial<Customer> as Customer;
    delete (stale as { archived_at?: unknown }).archived_at;
    expect(isArchived(stale)).toBe(false);
  });
});

describe("validateCustomer", () => {
  const base = { first_name: "Meghan", last_name: "Suchomski", email: "meghan@example.com", phone: "555-0100" };

  it("accepts a filled-in customer", () => {
    expect(validateCustomer(base)).toBeNull();
  });

  it("accepts one with no name, because the email identifies them", () => {
    // Two profiles on this farm have exactly this shape.
    expect(validateCustomer({ ...base, first_name: "", last_name: "" })).toBeNull();
  });

  it("accepts a blank phone", () => {
    expect(validateCustomer({ ...base, phone: "" })).toBeNull();
  });

  it("refuses a blank email", () => {
    expect(validateCustomer({ ...base, email: "  " })).toMatch(/can't be blank/);
  });

  it("refuses something that isn't an address", () => {
    expect(validateCustomer({ ...base, email: "meghan" })).toMatch(/doesn't look like/);
    expect(validateCustomer({ ...base, email: "meghan@example" })).toMatch(/doesn't look like/);
  });
});
