import { describe, expect, it } from "vitest";
import {
  formatMoney,
  inventoryValueCents,
  lotStatus,
  siresIn,
  sireName,
  stockBySire,
  tankLocation,
  validateDraw,
  validateLot,
  validateSire,
  type LotDraft,
  type SemenLot,
} from "./sires";
import type { RealAnimal } from "./herd";

const TODAY = "2026-08-07";

const lot = (over: Partial<SemenLot> = {}): SemenLot => ({
  id: over.id ?? "l1",
  sire_id: over.sire_id ?? "s1",
  naab_code: over.naab_code ?? "7JE1234",
  unit_type: over.unit_type ?? "conventional",
  lot_code: "",
  tank: over.tank ?? "",
  canister: over.canister ?? "",
  cane: over.cane ?? "",
  straws_initial: over.straws_initial ?? 10,
  straws_remaining: over.straws_remaining ?? 10,
  cost_per_straw_cents: over.cost_per_straw_cents ?? 2500,
  purchase_date: null,
  supplier: "",
  reorder_threshold: over.reorder_threshold ?? 0,
  active: over.active ?? true,
  notes: "",
});

const draft = (over: Partial<LotDraft> = {}): LotDraft => ({
  sireId: over.sireId ?? "s1",
  naabCode: "7JE1234",
  unitType: "conventional",
  lotCode: "",
  tank: "",
  canister: "",
  cane: "",
  straws: over.straws ?? "10",
  costPerStraw: over.costPerStraw ?? "25",
  purchaseDate: over.purchaseDate ?? "",
  supplier: "",
  reorderThreshold: over.reorderThreshold ?? "",
});

const animal = (over: Partial<RealAnimal> = {}): RealAnimal => ({
  id: over.id ?? "a1",
  ear_tag: over.ear_tag ?? "1",
  barn_name: "barn_name" in over ? over.barn_name! : "Bull",
  sex: over.sex ?? "male",
  class: over.class ?? "bull",
  status: "active",
  birth_date: "2020-01-01",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "dairy",
  origin: "purchased",
  record_type: over.record_type ?? "herd",
});

describe("lotStatus", () => {
  it("is empty at zero", () => {
    expect(lotStatus(lot({ straws_remaining: 0 }))).toBe("empty");
  });

  it("is low at or below the reorder point", () => {
    expect(lotStatus({ straws_remaining: 3, reorder_threshold: 3 })).toBe("low");
    expect(lotStatus({ straws_remaining: 2, reorder_threshold: 3 })).toBe("low");
  });

  it("is ok above the reorder point", () => {
    expect(lotStatus({ straws_remaining: 4, reorder_threshold: 3 })).toBe("ok");
  });

  it("never says low when no reorder point was set", () => {
    // The default threshold is 0. Treating that as a real threshold would
    // mark every untouched lot "low" for its whole life.
    expect(lotStatus({ straws_remaining: 1, reorder_threshold: 0 })).toBe("ok");
  });
});

describe("tankLocation", () => {
  it("reads as directions to the cane", () => {
    expect(tankLocation({ tank: "A", canister: "3", cane: "7" })).toBe("Tank A · can 3 · cane 7");
  });

  it("skips the parts nobody recorded", () => {
    expect(tankLocation({ tank: "A", canister: "", cane: "" })).toBe("Tank A");
  });

  it("is null when the location is unknown, rather than an empty string", () => {
    expect(tankLocation({ tank: "", canister: "", cane: "" })).toBeNull();
  });
});

describe("inventoryValueCents", () => {
  it("values what's left, not what was bought", () => {
    // 3 of 10 straws left at $25 is $75 of inventory. The 7 already used are
    // a sunk cost, not stock.
    expect(inventoryValueCents([lot({ straws_initial: 10, straws_remaining: 3, cost_per_straw_cents: 2500 })])).toBe(
      7500,
    );
  });

  it("sums across lots", () => {
    const value = inventoryValueCents([
      lot({ straws_remaining: 2, cost_per_straw_cents: 1000 }),
      lot({ straws_remaining: 4, cost_per_straw_cents: 500 }),
    ]);
    expect(value).toBe(4000);
  });

  it("is zero for an empty tank", () => {
    expect(inventoryValueCents([])).toBe(0);
  });
});

describe("formatMoney", () => {
  it("always shows cents", () => {
    expect(formatMoney(7500)).toBe("$75.00");
    expect(formatMoney(2599)).toBe("$25.99");
  });
});

describe("stockBySire", () => {
  it("pools a sire's lots into one line", () => {
    const rows = stockBySire([
      lot({ id: "a", sire_id: "s1", straws_remaining: 4, cost_per_straw_cents: 1000 }),
      lot({ id: "b", sire_id: "s1", straws_remaining: 2, cost_per_straw_cents: 1000 }),
    ]);
    expect(rows).toEqual([{ sireId: "s1", straws: 6, lots: 2, valueCents: 6000 }]);
  });

  it("puts the best-stocked sire first", () => {
    const rows = stockBySire([
      lot({ id: "a", sire_id: "few", straws_remaining: 1 }),
      lot({ id: "b", sire_id: "many", straws_remaining: 9 }),
    ]);
    expect(rows.map((r) => r.sireId)).toEqual(["many", "few"]);
  });

  it("still lists a sire whose lots are all empty", () => {
    // He's out of stock, which is exactly what you need to see before
    // planning a breeding around him.
    expect(stockBySire([lot({ sire_id: "s1", straws_remaining: 0 })])).toEqual([
      { sireId: "s1", straws: 0, lots: 1, valueCents: 0 },
    ]);
  });
});

describe("validateLot", () => {
  it("accepts a normal lot", () => {
    expect(validateLot(draft(), TODAY)).toBeNull();
  });

  it("insists on a sire", () => {
    expect(validateLot(draft({ sireId: "" }), TODAY)).toMatch(/which sire/);
  });

  it("rejects fractional straws", () => {
    expect(validateLot(draft({ straws: "2.5" }), TODAY)).toMatch(/whole/);
  });

  it("rejects an empty or zero lot", () => {
    expect(validateLot(draft({ straws: "" }), TODAY)).toMatch(/How many straws/);
    expect(validateLot(draft({ straws: "0" }), TODAY)).toMatch(/at least one straw/);
  });

  it("rejects a negative cost", () => {
    expect(validateLot(draft({ costPerStraw: "-5" }), TODAY)).toMatch(/negative/);
  });

  it("allows a lot with no cost recorded", () => {
    expect(validateLot(draft({ costPerStraw: "" }), TODAY)).toBeNull();
  });

  it("rejects a reorder point above the lot itself", () => {
    // It would be "low" from the moment it was entered, which tells you
    // nothing.
    expect(validateLot(draft({ straws: "5", reorderThreshold: "8" }), TODAY)).toMatch(/higher than the lot/);
  });

  it("rejects a future purchase date", () => {
    expect(validateLot(draft({ purchaseDate: "2026-12-01" }), TODAY)).toMatch(/future/);
  });

  it("accepts a purchase dated today", () => {
    expect(validateLot(draft({ purchaseDate: TODAY }), TODAY)).toBeNull();
  });
});

describe("validateDraw", () => {
  it("accepts taking one straw", () => {
    expect(validateDraw({ straws_remaining: 5 }, 1)).toBeNull();
  });

  it("won't let you take more than is there", () => {
    expect(validateDraw({ straws_remaining: 2 }, 3)).toMatch(/Only 2 straws left/);
  });

  it("gets the singular right on the last straw", () => {
    expect(validateDraw({ straws_remaining: 1 }, 2)).toMatch(/Only 1 straw left/);
  });

  it("rejects zero, negatives and fractions", () => {
    expect(validateDraw({ straws_remaining: 5 }, 0)).toMatch(/how many/);
    expect(validateDraw({ straws_remaining: 5 }, -1)).toMatch(/how many/);
    expect(validateDraw({ straws_remaining: 5 }, 1.5)).toMatch(/whole/);
  });

  it("allows taking the whole lot", () => {
    expect(validateDraw({ straws_remaining: 3 }, 3)).toBeNull();
  });
});

describe("validateSire", () => {
  const sire = { barnName: "Chief", earTag: "", naabCode: "", registrationNumber: "", birthDate: "2019-04-01", notes: "" };

  it("accepts a named bull", () => {
    expect(validateSire(sire, TODAY)).toBeNull();
  });

  it("accepts a bull identified only by tag", () => {
    expect(validateSire({ ...sire, barnName: "", earTag: "7JE1234" }, TODAY)).toBeNull();
  });

  it("insists on some way to identify him", () => {
    expect(validateSire({ ...sire, barnName: "", earTag: "" }, TODAY)).toMatch(/name or a tag/);
  });

  it("insists on a birth date, which the schema requires", () => {
    expect(validateSire({ ...sire, birthDate: "" }, TODAY)).toMatch(/birth date is required/);
  });

  it("rejects a future birth date", () => {
    expect(validateSire({ ...sire, birthDate: "2027-01-01" }, TODAY)).toMatch(/future/);
  });
});

describe("siresIn", () => {
  it("finds males whether they live here or are only a reference", () => {
    const herd = [
      animal({ id: "cow", sex: "female", barn_name: "Patience" }),
      animal({ id: "bull", sex: "male", barn_name: "Chief" }),
      animal({ id: "ai", sex: "male", barn_name: "Ammo", record_type: "reference" }),
    ];
    expect(siresIn(herd).map((a) => a.id)).toEqual(["ai", "bull"]);
  });

  it("is empty when the herd is all cows", () => {
    expect(siresIn([animal({ sex: "female" })])).toEqual([]);
  });
});

describe("sireName", () => {
  it("prefers the barn name", () => {
    expect(sireName(animal({ barn_name: "Chief", ear_tag: "9" }))).toBe("Chief");
  });

  it("falls back to the tag", () => {
    expect(sireName(animal({ barn_name: null, ear_tag: "7JE1234" }))).toBe("Tag 7JE1234");
  });

  it("has something to say for a bull with neither", () => {
    expect(sireName(animal({ barn_name: null, ear_tag: "" }))).toBe("Unnamed bull");
  });
});
