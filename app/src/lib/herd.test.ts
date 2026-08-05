import { describe, expect, it } from "vitest";
import { describeBreeding, formatAge, type BreedShare } from "./herd";

const share = (name: string, percent: number): BreedShare => ({ breedId: name, name, code: name.slice(0, 2), percent });

describe("describeBreeding", () => {
  it("names a purebred without a percentage", () => {
    expect(describeBreeding([share("Jersey", 100)])).toBe("Jersey");
  });

  it("writes an even cross as A × B, without repeating 50% twice", () => {
    expect(describeBreeding([share("Jersey", 50), share("Holstein", 50)])).toBe("Jersey × Holstein");
  });

  it("shows percentages when the cross isn't even", () => {
    expect(describeBreeding([share("Jersey", 75), share("Holstein", 25)])).toBe("75% Jersey · 25% Holstein");
  });

  it("handles a three-way even cross", () => {
    const thirds = [share("Jersey", 33.33), share("Holstein", 33.33), share("Guernsey", 33.34)];
    expect(describeBreeding(thirds)).toBe("Jersey × Holstein × Guernsey");
  });

  it("keeps a decimal when the percentage isn't whole", () => {
    expect(describeBreeding([share("Jersey", 62.5), share("Holstein", 37.5)])).toBe("62.5% Jersey · 37.5% Holstein");
  });

  it("shows the percentage for a lone breed that doesn't add up to 100", () => {
    // A single 50% row means the rest is unrecorded, which is worth seeing
    // rather than rounding up to "Jersey".
    expect(describeBreeding([share("Jersey", 50)])).toBe("50% Jersey");
  });

  it("returns null for an animal with no composition recorded", () => {
    expect(describeBreeding(undefined)).toBeNull();
    expect(describeBreeding([])).toBeNull();
  });
});

describe("formatAge", () => {
  it("counts a newborn in weeks", () => {
    expect(formatAge("2026-07-24", "2026-08-05")).toBe("1 week");
    expect(formatAge("2026-06-24", "2026-08-05")).toBe("6 weeks");
  });

  it("counts a yearling in months", () => {
    expect(formatAge("2025-08-05", "2026-08-05")).toBe("11 months");
  });

  it("counts a grown animal in years", () => {
    expect(formatAge("2023-05-01", "2026-08-05")).toBe("3 years");
    expect(formatAge("2020-07-04", "2026-08-05")).toBe("6 years");
  });

  it("doesn't go negative for a birth date in the future", () => {
    expect(formatAge("2027-01-01", "2026-08-05")).toBe("1 week");
  });
});
