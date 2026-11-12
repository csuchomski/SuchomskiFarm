import { describe, expect, it } from "vitest";
import { jarRule, jarsFor, jarWords, validateJarCount, validateJarReturn } from "./jars";

/**
 * The farm's jars. The count itself is the database's — these are the parts
 * the app works out for itself: how many jars a quantity goes home in, said
 * before the pickup is confirmed, and what a form will and won't send.
 */

describe("how many jars a quantity goes home in", () => {
  it("is one jar for every half gallon", () => {
    expect(jarsFor(0.5, 2)).toBe(1);
    expect(jarsFor(1, 2)).toBe(2);
    expect(jarsFor(2.5, 2)).toBe(5);
  });

  it("rounds a part-jar up — the milk still needs something to go home in", () => {
    expect(jarsFor(0.75, 2)).toBe(2);
    expect(jarsFor(0.1, 2)).toBe(1);
  });

  it("doesn't round up on arithmetic noise", () => {
    // 0.07 × 100 is 7.000000000000001 in floating point, which a bare
    // round-up would make eight.
    expect(jarsFor(0.07, 100)).toBe(7);
  });

  it("is nothing for something not sold in jars, or for no quantity", () => {
    expect(jarsFor(2, null)).toBeNull();
    expect(jarsFor(2, undefined)).toBeNull();
    expect(jarsFor(0, 2)).toBe(0);
    expect(jarsFor(Number.NaN, 2)).toBe(0);
  });
});

describe("saying it", () => {
  it("counts jars in the singular and the plural", () => {
    expect(jarWords(1)).toBe("1 jar");
    expect(jarWords(0)).toBe("0 jars");
    expect(jarWords(4)).toBe("4 jars");
  });

  it("states the rule in the product's own unit", () => {
    expect(jarRule(2, "gallon")).toBe("1 jar for every half gallon");
    expect(jarRule(1, "quart")).toBe("1 jar for every quart");
    expect(jarRule(4, "gallon")).toBe("1 jar for every quarter gallon");
  });
});

describe("a number of jars coming back", () => {
  it("has to be a whole number, at least one", () => {
    expect(validateJarReturn("", 4)).toMatch(/How many/);
    expect(validateJarReturn("0", 4)).toMatch(/whole number/);
    expect(validateJarReturn("1.5", 4)).toMatch(/whole number/);
    expect(validateJarReturn("-2", 4)).toMatch(/whole number/);
    expect(validateJarReturn("abc", 4)).toMatch(/whole number/);
  });

  it("can't be more than they have", () => {
    expect(validateJarReturn("5", 4)).toBe("That's more than the 4 jars on record.");
    expect(validateJarReturn("1", 0)).toBe("That's more than the 0 jars on record.");
    expect(validateJarReturn("4", 4)).toBeNull();
    expect(validateJarReturn(" 2 ", 4)).toBeNull();
  });
});

describe("a count the farmer sets", () => {
  it("is a whole number, zero or more", () => {
    expect(validateJarCount("0")).toBeNull();
    expect(validateJarCount("12")).toBeNull();
    expect(validateJarCount("")).toMatch(/What should/);
    expect(validateJarCount("-1")).toMatch(/zero or more/);
    expect(validateJarCount("2.5")).toMatch(/zero or more/);
    expect(validateJarCount("1000")).toMatch(/more jars/);
  });
});
