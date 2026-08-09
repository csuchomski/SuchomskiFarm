import { describe, expect, it } from "vitest";
import { countServices, isActive, sireLabel, validateBreeding, type Breeding, type BreedingDraft } from "./breedings";

const draft = (over: Partial<BreedingDraft> = {}): BreedingDraft => ({
  animalId: "cow-1",
  date: "2026-08-08",
  method: "ai",
  sireId: "",
  semenLotId: "lot-1",
  technician: "",
  notes: "",
  cost: "",
  ...over,
});

const breeding = (over: Partial<Breeding> = {}): Breeding => ({
  id: "b1",
  animal_id: "cow-1",
  date: "2026-08-08",
  service_number: 1,
  method: "ai",
  technician: "",
  sire_id: "bull-1",
  semen_lot_id: "lot-1",
  semen_type: "conventional",
  naab_code_snapshot: "7HO12345",
  voided: false,
  void_reason: "",
  cost_entry_id: "cost-1",
  notes: "",
  ...over,
});

describe("validateBreeding", () => {
  it("accepts an AI service", () => {
    expect(validateBreeding(draft(), 5)).toBeNull();
  });

  it("accepts a natural service with a bull", () => {
    expect(validateBreeding(draft({ method: "natural", semenLotId: "", sireId: "bull-1" }))).toBeNull();
  });

  it("wants a female", () => {
    expect(validateBreeding(draft({ animalId: "" }))).toMatch(/Which cow or heifer/);
  });

  it("wants a date", () => {
    expect(validateBreeding(draft({ date: "" }))).toMatch(/When was she bred/);
  });

  it("wants a straw for AI and a bull for natural, and not the other way round", () => {
    expect(validateBreeding(draft({ semenLotId: "" }))).toMatch(/Which straw/);
    expect(validateBreeding(draft({ method: "natural", sireId: "" }))).toMatch(/Which bull/);
    // A natural service needs no straw…
    expect(validateBreeding(draft({ method: "natural", sireId: "bull-1", semenLotId: "" }))).toBeNull();
    // …and an AI one needs no separately chosen bull, because the straw
    // decides which bull it was.
    expect(validateBreeding(draft({ sireId: "" }), 1)).toBeNull();
  });

  it("refuses a lot with nothing left", () => {
    expect(validateBreeding(draft(), 0)).toMatch(/no straws left/);
  });

  it("leaves the straw count to the database when it doesn't know it", () => {
    // Two people at one tank is a race the form can't settle; record_breeding
    // takes a row lock for it.
    expect(validateBreeding(draft(), undefined)).toBeNull();
  });

  it("accepts a blank cost, which means the straw's own price", () => {
    expect(validateBreeding(draft({ cost: "" }), 5)).toBeNull();
  });

  it("accepts an explicit zero, which is a different claim", () => {
    expect(validateBreeding(draft({ cost: "0" }), 5)).toBeNull();
  });

  it("refuses a negative or non-numeric cost", () => {
    expect(validateBreeding(draft({ cost: "-5" }), 5)).toMatch(/can't be negative/);
    expect(validateBreeding(draft({ cost: "free" }), 5)).toMatch(/has to be a number/);
  });
});

describe("sireLabel", () => {
  it("names the NAAB code for an AI service", () => {
    expect(sireLabel(breeding(), "Dutton")).toBe("AI · 7HO12345");
  });

  it("falls back to the bull's name when the lot has no NAAB code", () => {
    // The live lot on this farm has none, and "AI · " reads like a bug.
    expect(sireLabel(breeding({ naab_code_snapshot: "" }), "Dutton")).toBe("AI · Dutton");
  });

  it("says so when there's nothing to name it by", () => {
    expect(sireLabel(breeding({ naab_code_snapshot: "" }), undefined)).toBe("AI · unknown bull");
  });

  it("names the bull for a natural service", () => {
    expect(sireLabel(breeding({ method: "natural", semen_lot_id: null, naab_code_snapshot: "" }), "Dutton")).toBe(
      "Bull · Dutton",
    );
  });
});

describe("countServices", () => {
  it("counts a cow's breedings", () => {
    const rows = [breeding({ id: "a" }), breeding({ id: "b" }), breeding({ id: "c", animal_id: "cow-2" })];
    expect(countServices(rows, "cow-1")).toBe(2);
  });

  it("leaves out the voided ones", () => {
    const rows = [breeding({ id: "a" }), breeding({ id: "b", voided: true })];
    expect(countServices(rows, "cow-1")).toBe(1);
    expect(isActive(rows[1])).toBe(false);
  });

  it("is zero for a cow with none", () => {
    expect(countServices([breeding()], "cow-9")).toBe(0);
  });
});
