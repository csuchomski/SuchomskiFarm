import { describe, expect, it } from "vitest";
import { animalPath, describeBreeding, formatAge, isMilked, milkingHerd, type BreedShare, type RealAnimal } from "./herd";

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

describe("isMilked", () => {
  it("goes by purpose, not by breed", () => {
    // A Jersey run as a beef cow is a beef cow. Composition says what she is;
    // purpose says what she's for, and only one of them decides whether she
    // has a lactation.
    expect(isMilked({ purpose: "dairy" })).toBe(true);
    expect(isMilked({ purpose: "beef" })).toBe(false);
  });

  it("counts dual as milked, matching herd.record_calving", () => {
    // The database opens a lactation for purpose in ('dairy', 'dual'). If
    // this disagreed, the app would show a cow as missing a lactation the
    // database was never going to create.
    expect(isMilked({ purpose: "dual" })).toBe(true);
  });

  it("won't guess at a purpose it doesn't know", () => {
    expect(isMilked({ purpose: "" })).toBe(false);
    expect(isMilked({ purpose: "draft" })).toBe(false);
  });
});

describe("milkingHerd", () => {
  const animal = (over: Partial<RealAnimal> & { id: string }): RealAnimal => ({
    ear_tag: over.id,
    barn_name: null,
    sex: "female",
    class: "cow",
    status: "active",
    birth_date: "2021-01-01",
    sire_id: null,
    dam_id: null,
    notes: null,
    purpose: "dairy",
    origin: "purchased",
    record_type: "herd",
    ...over,
  });

  it("is the dairy females old enough to have calved", () => {
    const herd = [
      animal({ id: "dairy-cow" }),
      animal({ id: "beef-cow", purpose: "beef" }),
      animal({ id: "dairy-heifer", class: "heifer" }),
      animal({ id: "dairy-calf", class: "calf" }),
      animal({ id: "bull", sex: "male", class: "bull", purpose: "dairy" }),
      animal({ id: "ai-bull", sex: "male", class: "bull", record_type: "reference" }),
    ];
    expect(milkingHerd(herd).map((a) => a.id)).toEqual(["dairy-cow", "dairy-heifer"]);
  });

  it("is empty on a herd with no dairy in it", () => {
    expect(milkingHerd([animal({ id: "a", purpose: "beef" }), animal({ id: "b", purpose: "beef" })])).toEqual([]);
  });
});

describe("animalPath", () => {
  it("links by tag, because a URL should say which animal it is", () => {
    expect(animalPath({ id: "2e2d30bd-f266-44b4-a915-ecaae8a43201", ear_tag: "12" })).toBe("/animals/12");
  });

  it("falls back to the id when the tag is blank, so the row is still reachable", () => {
    // Victor, on file from a calving that never asked for a tag. Before this
    // his link came out as /animals/, which is the list, and there was no way
    // to open him and give him one. Migration 059 stops new ones.
    expect(animalPath({ id: "2e2d30bd-f266-44b4-a915-ecaae8a43201", ear_tag: "" })).toBe(
      "/animals/2e2d30bd-f266-44b4-a915-ecaae8a43201",
    );
    expect(animalPath({ id: "abc", ear_tag: "   " })).toBe("/animals/abc");
  });

  it("escapes a tag that would otherwise break the path", () => {
    expect(animalPath({ id: "abc", ear_tag: "33432/B" })).toBe("/animals/33432%2FB");
  });
});
