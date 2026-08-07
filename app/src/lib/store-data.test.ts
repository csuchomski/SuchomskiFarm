import { describe, expect, it } from "vitest";
import { DISCARD_REASONS, formatUnitPrice, validateDiscard, validateProduct, type ProductDraft } from "./store-data";

const draft = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  name: over.name ?? "Milk",
  unit: over.unit ?? "gallon",
  price: over.price ?? "10",
  forecastOverride: over.forecastOverride ?? "",
  typeCode: over.typeCode ?? "milk",
});

describe("validateProduct", () => {
  it("accepts a normal product", () => {
    expect(validateProduct(draft())).toBeNull();
  });

  it("needs a name and a unit", () => {
    expect(validateProduct(draft({ name: "  " }))).toMatch(/name/);
    expect(validateProduct(draft({ unit: "" }))).toMatch(/sold by/);
  });

  it("allows a product with no price yet", () => {
    // A product can exist before it's priced; the order screens already
    // show "—" for one.
    expect(validateProduct(draft({ price: "" }))).toBeNull();
  });

  it("rejects a negative or non-numeric price", () => {
    expect(validateProduct(draft({ price: "-1" }))).toMatch(/negative/);
    expect(validateProduct(draft({ price: "free" }))).toMatch(/has to be a number/);
  });

  it("allows a blank weekly figure, which means work it out from history", () => {
    expect(validateProduct(draft({ forecastOverride: "" }))).toBeNull();
  });

  it("rejects a negative weekly figure", () => {
    expect(validateProduct(draft({ forecastOverride: "-5" }))).toMatch(/can't be negative/);
  });

  it("accepts a price of zero, which is a real answer", () => {
    expect(validateProduct(draft({ price: "0" }))).toBeNull();
  });
});

describe("validateDiscard", () => {
  const base = { quantity: "2", reason: "Poured out", available: 5 };

  it("accepts a normal discard", () => {
    expect(validateDiscard(base)).toBeNull();
  });

  it("won't discard stock promised to an order", () => {
    // discard_inventory raises 'Not enough unreserved inventory' rather than
    // breaking a promise; this says so first, with the number.
    expect(validateDiscard({ ...base, quantity: "9" })).toMatch(/Only 5 unreserved/);
  });

  it("allows discarding everything unreserved", () => {
    expect(validateDiscard({ ...base, quantity: "5" })).toBeNull();
  });

  it("rejects zero and nonsense", () => {
    expect(validateDiscard({ ...base, quantity: "0" })).toMatch(/at least some/);
    expect(validateDiscard({ ...base, quantity: "lots" })).toMatch(/has to be a number/);
    expect(validateDiscard({ ...base, quantity: "" })).toMatch(/How much/);
  });

  it("rejects a reason the database would refuse", () => {
    // The function's check is exactly these two strings.
    expect(validateDiscard({ ...base, reason: "Spilled" })).toMatch(/Fed to Pigs or Poured out/);
    expect(validateDiscard({ ...base, reason: "" })).toMatch(/Pick a reason/);
  });

  it("accepts both reasons the database allows", () => {
    for (const reason of DISCARD_REASONS) {
      expect(validateDiscard({ ...base, reason })).toBeNull();
    }
  });
});

describe("formatUnitPrice", () => {
  it("reads as a price per unit", () => {
    expect(formatUnitPrice({ id: 1, name: "Milk", unit: "gallon", price: 8, forecast_override: null })).toBe(
      "$8.00 / gallon",
    );
  });

  it("says so when there's no price rather than showing $0.00", () => {
    expect(formatUnitPrice({ id: 1, name: "Milk", unit: "gallon", price: null, forecast_override: null })).toBe(
      "— / gallon",
    );
  });
});
