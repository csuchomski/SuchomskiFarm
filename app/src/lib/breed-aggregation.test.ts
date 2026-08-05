import { describe, expect, it } from "vitest";
import { describeBreeding, type BreedShare } from "./herd";

/** Mirrors what fetchBreedComposition now does to raw rows: sum per breed,
 * heaviest first. Kept alongside describeBreeding because the duplicate-breed
 * bug lived in the seam between them. */
function aggregate(rows: { breed_id: string; name: string; percent: number }[]): BreedShare[] {
  const sums = new Map<string, number>();
  const names = new Map<string, string>();
  for (const r of rows) {
    sums.set(r.breed_id, (sums.get(r.breed_id) ?? 0) + r.percent);
    names.set(r.breed_id, r.name);
  }
  return [...sums.entries()]
    .map(([breedId, percent]) => ({
      breedId,
      name: names.get(breedId)!,
      code: breedId,
      percent: Math.round(percent * 100) / 100,
    }))
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
}

describe("breed aggregation", () => {
  it("sums a breed inherited down both sides instead of listing it twice", () => {
    // The reported bug: "Jersey · Jersey" where 75% Jersey was meant.
    const shares = aggregate([
      { breed_id: "j", name: "Jersey", percent: 50 },
      { breed_id: "j", name: "Jersey", percent: 25 },
      { breed_id: "h", name: "Holstein", percent: 25 },
    ]);
    expect(shares).toHaveLength(2);
    expect(shares[0]).toMatchObject({ name: "Jersey", percent: 75 });
    expect(describeBreeding(shares)).toBe("75% Jersey · 25% Holstein");
  });

  it("collapses three rows of one breed into a purebred", () => {
    const shares = aggregate([
      { breed_id: "j", name: "Jersey", percent: 50 },
      { breed_id: "j", name: "Jersey", percent: 25 },
      { breed_id: "j", name: "Jersey", percent: 25 },
    ]);
    expect(shares).toHaveLength(1);
    expect(describeBreeding(shares)).toBe("Jersey");
  });

  it("leaves a genuine even cross alone, ordered by name", () => {
    // Equal percentages tie-break alphabetically rather than by row order:
    // the query has no ORDER BY, so Postgres row order isn't guaranteed and
    // an even cross would otherwise render differently on different loads.
    const shares = aggregate([
      { breed_id: "j", name: "Jersey", percent: 50 },
      { breed_id: "h", name: "Holstein", percent: 50 },
    ]);
    expect(describeBreeding(shares)).toBe("Holstein × Jersey");
  });

  it("orders an even cross the same way whatever order the rows arrive in", () => {
    const forward = aggregate([
      { breed_id: "j", name: "Jersey", percent: 50 },
      { breed_id: "h", name: "Holstein", percent: 50 },
    ]);
    const reversed = aggregate([
      { breed_id: "h", name: "Holstein", percent: 50 },
      { breed_id: "j", name: "Jersey", percent: 50 },
    ]);
    expect(describeBreeding(forward)).toBe(describeBreeding(reversed));
  });

  it("rounds away floating-point noise from summing", () => {
    const shares = aggregate([
      { breed_id: "j", name: "Jersey", percent: 33.33 },
      { breed_id: "j", name: "Jersey", percent: 33.33 },
    ]);
    expect(shares[0].percent).toBe(66.66);
  });

  it("orders heaviest first regardless of row order", () => {
    const shares = aggregate([
      { breed_id: "h", name: "Holstein", percent: 25 },
      { breed_id: "j", name: "Jersey", percent: 75 },
    ]);
    expect(shares.map((s) => s.name)).toEqual(["Jersey", "Holstein"]);
  });
});
