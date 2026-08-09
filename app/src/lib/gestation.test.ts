import { describe, expect, it } from "vitest";
import { daysForBreed, gestationFor, validateGestation, type Breed, type GestationInputs } from "./gestation";

// Real figures from the seeded herd.breeds rows.
const jersey: Breed = { id: "je", code: "JE", name: "Jersey", species_type: "dairy", default_gestation_days: 279, active: true };
const brownSwiss: Breed = { id: "bs", code: "BS", name: "Brown Swiss", species_type: "dairy", default_gestation_days: 290, active: true };
const charolais: Breed = { id: "ch", code: "CH", name: "Charolais", species_type: "beef", default_gestation_days: 287, active: true };
const galloway: Breed = { id: "bg", code: "BG", name: "Belted Galloway", species_type: "beef", default_gestation_days: 283, active: true };

const inputs = (over: Partial<GestationInputs> = {}): GestationInputs => ({
  breeds: [jersey, brownSwiss, charolais, galloway],
  composition: [],
  overrides: [],
  bySpecies: { beef: 283, dairy: 279 },
  ...over,
});

describe("daysForBreed", () => {
  it("uses the breed's own default", () => {
    expect(daysForBreed(jersey, [])).toEqual({ days: 279, overridden: false });
  });

  it("prefers the farm's figure when there is one", () => {
    expect(daysForBreed(jersey, [{ id: "o1", breed_id: "je", gestation_days: 281 }])).toEqual({
      days: 281,
      overridden: true,
    });
  });

  it("ignores an override for a different breed", () => {
    expect(daysForBreed(jersey, [{ id: "o1", breed_id: "bs", gestation_days: 295 }]).days).toBe(279);
  });
});

describe("gestationFor", () => {
  const cow = { id: "cow-1", purpose: "dairy" };

  it("gives a purebred her breed's figure exactly", () => {
    const g = gestationFor(cow, inputs({ composition: [{ animal_id: "cow-1", breed_id: "je", percent: 100 }] }));
    expect(g).toEqual({ days: 279, basis: "Jersey", fromBreed: true });
  });

  it("separates two breeds that the species average conflated", () => {
    // This is the whole point: both are dairy, and they are eleven days apart.
    const shares = (breed: string) => inputs({ composition: [{ animal_id: "cow-1", breed_id: breed, percent: 100 }] });
    expect(gestationFor(cow, shares("je"))?.days).toBe(279);
    expect(gestationFor(cow, shares("bs"))?.days).toBe(290);
  });

  it("weights a cross between its breeds", () => {
    // Half Jersey (279), half Charolais (287) → 283.
    const g = gestationFor(
      cow,
      inputs({
        composition: [
          { animal_id: "cow-1", breed_id: "je", percent: 50 },
          { animal_id: "cow-1", breed_id: "ch", percent: 50 },
        ],
      }),
    );
    expect(g?.days).toBe(283);
    expect(g?.basis).toBe("50% Jersey, 50% Charolais");
  });

  it("weights an uneven cross towards the bigger share", () => {
    // ¾ Galloway (283), ¼ Charolais (287) → 284.
    const g = gestationFor(
      cow,
      inputs({
        composition: [
          { animal_id: "cow-1", breed_id: "bg", percent: 75 },
          { animal_id: "cow-1", breed_id: "ch", percent: 25 },
        ],
      }),
    );
    expect(g?.days).toBe(284);
  });

  it("copes with shares that don't add to 100", () => {
    // Percentages are only constrained to 0 < p <= 100 each, so they can
    // total anything. Weighting by the total keeps the answer between the
    // two breeds instead of collapsing.
    const g = gestationFor(
      cow,
      inputs({
        composition: [
          { animal_id: "cow-1", breed_id: "je", percent: 30 },
          { animal_id: "cow-1", breed_id: "ch", percent: 30 },
        ],
      }),
    );
    expect(g?.days).toBe(283);
  });

  it("marks a farm figure in the basis so a due date can be explained", () => {
    const g = gestationFor(
      cow,
      inputs({
        composition: [{ animal_id: "cow-1", breed_id: "je", percent: 100 }],
        overrides: [{ id: "o1", breed_id: "je", gestation_days: 281 }],
      }),
    );
    expect(g).toEqual({ days: 281, basis: "Jersey (farm figure)", fromBreed: true });
  });

  it("falls back to the species average when she has no breeds on file", () => {
    const g = gestationFor(cow, inputs());
    expect(g).toEqual({ days: 279, basis: "dairy average", fromBreed: false });
  });

  it("is null when even the fallback has no figure", () => {
    expect(gestationFor({ id: "cow-1", purpose: "dual" }, inputs())).toBeNull();
  });

  it("ignores another animal's composition", () => {
    const g = gestationFor(cow, inputs({ composition: [{ animal_id: "cow-2", breed_id: "bs", percent: 100 }] }));
    expect(g?.days).toBe(279);
    expect(g?.fromBreed).toBe(false);
  });

  it("ignores a composition row naming a breed that isn't on file", () => {
    const g = gestationFor(cow, inputs({ composition: [{ animal_id: "cow-1", breed_id: "gone", percent: 100 }] }));
    expect(g?.fromBreed).toBe(false);
  });
});

describe("validateGestation", () => {
  it("accepts a plausible figure", () => {
    expect(validateGestation("281")).toBeNull();
  });

  it("accepts blank, which is how you go back to the default", () => {
    expect(validateGestation("  ")).toBeNull();
  });

  it("wants whole days", () => {
    expect(validateGestation("280.5")).toMatch(/whole number/);
    expect(validateGestation("about 280")).toMatch(/whole number/);
  });

  it("catches a typo rather than judging anyone's cattle", () => {
    expect(validateGestation("28")).toMatch(/not a plausible gestation/);
    expect(validateGestation("2800")).toMatch(/not a plausible gestation/);
    // Wide enough to allow anything real.
    expect(validateGestation("240")).toBeNull();
    expect(validateGestation("320")).toBeNull();
  });
});
