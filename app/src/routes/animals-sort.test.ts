import { describe, expect, it } from "vitest";
import { compareTags } from "./Animals";

describe("compareTags", () => {
  it("sorts numeric tags numerically, not as text", () => {
    // The bug this exists to prevent: "10" sorting before "9".
    expect(["9", "10", "2"].sort(compareTags)).toEqual(["2", "9", "10"]);
  });

  it("handles leading zeros", () => {
    expect(["007", "10", "2"].sort(compareTags)).toEqual(["2", "007", "10"]);
  });

  it("falls back to natural text order for non-numeric tags", () => {
    expect(["B12", "A3", "A10"].sort(compareTags)).toEqual(["A3", "A10", "B12"]);
  });

  it("doesn't treat an empty tag as zero", () => {
    // Number("") is 0, which would sort a blank tag ahead of tag "1".
    const sorted = ["", "1"].sort(compareTags);
    expect(sorted[0]).toBe("");
    expect(sorted).toHaveLength(2);
  });

  it("mixes numeric and text tags without throwing", () => {
    expect(() => ["1", "A", "22", ""].sort(compareTags)).not.toThrow();
  });
});
