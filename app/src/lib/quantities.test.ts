import { describe, expect, it } from "vitest";
import { maxOffer, quantityLabel, quantityOptions, stepFor } from "./quantities";

describe("stepFor", () => {
  it("steps milk by the half gallon", () => {
    expect(stepFor({ type_code: "milk", unit: "gallon" })).toBe(0.5);
  });

  it("steps eggs by the dozen and meat by the pound", () => {
    expect(stepFor({ type_code: "eggs", unit: "dozen" })).toBe(1);
    expect(stepFor({ type_code: "meat", unit: "pound" })).toBe(1);
  });

  it("falls back to the unit for a product with no type", () => {
    // Cheese is real and untyped: migration 008's backfill was deliberately
    // conservative and left it null.
    expect(stepFor({ type_code: null, unit: "pound" })).toBe(1);
    expect(stepFor({ type_code: null, unit: "Gallon" })).toBe(0.5);
  });

  it("falls back to 1 for a unit it doesn't know", () => {
    expect(stepFor({ type_code: null, unit: "bushel" })).toBe(1);
    expect(stepFor({ type_code: null, unit: null })).toBe(1);
  });

  it("prefers the type over the unit when they disagree", () => {
    // A gallon of honey is still honey.
    expect(stepFor({ type_code: "eggs", unit: "gallon" })).toBe(1);
  });
});

describe("quantityOptions", () => {
  it("counts up in steps and stops at the cap", () => {
    expect(quantityOptions(0.5, 2)).toEqual([0.5, 1, 1.5, 2]);
  });

  it("stops below a cap the step can't reach exactly", () => {
    expect(quantityOptions(0.5, 2.3)).toEqual([0.5, 1, 1.5, 2]);
    expect(quantityOptions(1, 3.9)).toEqual([1, 2, 3]);
  });

  it("includes a cap that lands exactly on a step", () => {
    // Floating point: 14 / 0.5 must not come out as 27.999…
    expect(quantityOptions(0.5, 14).length).toBe(28);
    expect(quantityOptions(0.5, 14).at(-1)).toBe(14);
    expect(quantityOptions(0.5, 3.143).at(-1)).toBe(3);
  });

  it("offers nothing when the forecast can't cover one step", () => {
    // Not [0] — there is no honest quantity to put in the dropdown.
    expect(quantityOptions(0.5, 0.4)).toEqual([]);
    expect(quantityOptions(1, 0)).toEqual([]);
  });

  it("guards against a forecast override that would render a thousand rows", () => {
    expect(quantityOptions(0.5, 500).length).toBe(100);
  });

  it("refuses a nonsense step rather than looping", () => {
    expect(quantityOptions(0, 10)).toEqual([]);
    expect(quantityOptions(-1, 10)).toEqual([]);
  });
});

describe("quantityLabel", () => {
  it("matches how the rest of the shop writes a quantity", () => {
    // "4 gallon left" is what the product card says; this doesn't invent a
    // pluralisation rule the rest of the page doesn't have.
    expect(quantityLabel(1.5, "gallon")).toBe("1.5 gallon");
    expect(quantityLabel(2, "dozen")).toBe("2 dozen");
  });
});

describe("maxOffer", () => {
  it("is the last option the dropdown would show", () => {
    expect(maxOffer(0.5, 3.2)).toBe(3);
    expect(maxOffer(1, 3.1)).toBe(3);
  });

  it("is zero when a day can't cover one step, matching the empty dropdown", () => {
    expect(maxOffer(0.5, 0.3)).toBe(0);
  });
});
