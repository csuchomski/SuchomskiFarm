import { describe, expect, it } from "vitest";
import { commonest, merge } from "./AnimalForm";
import type { RealAnimal } from "../../lib/herd";

const animal = (over: Partial<RealAnimal>): RealAnimal => ({
  id: Math.random().toString(),
  ear_tag: "1",
  barn_name: "X",
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2023-01-01",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "dairy",
  origin: "born_on_farm",
  record_type: "herd",
  ...over,
});

describe("commonest", () => {
  it("picks the value the herd uses most", () => {
    const herd = [
      animal({ purpose: "dairy" }),
      animal({ purpose: "dairy" }),
      animal({ purpose: "beef" }),
    ];
    expect(commonest(herd, "purpose")).toBe("dairy");
  });

  it("ignores blanks rather than defaulting to them", () => {
    // purpose is NOT NULL with no default, so defaulting a new animal to ""
    // would just fail the insert.
    const herd = [animal({ purpose: "" }), animal({ purpose: "" }), animal({ purpose: "beef" })];
    expect(commonest(herd, "purpose")).toBe("beef");
  });

  it("trims before comparing, so ' dairy' and 'dairy' are one value", () => {
    const herd = [animal({ origin: " purchased " }), animal({ origin: "purchased" })];
    expect(commonest(herd, "origin")).toBe("purchased");
  });

  it("returns empty for an empty herd rather than throwing", () => {
    expect(commonest([], "purpose")).toBe("");
  });
});

describe("merge", () => {
  it("keeps suggestions first, then adds what the herd actually uses", () => {
    expect(merge(["female", "male"], ["female", "steer"])).toEqual(["female", "male", "steer"]);
  });

  it("doesn't duplicate a value that's in both", () => {
    expect(merge(["cow"], ["cow", "cow"])).toEqual(["cow"]);
  });

  it("drops blanks and whitespace-only values", () => {
    expect(merge(["cow"], ["", "   ", "bull"])).toEqual(["cow", "bull"]);
  });

  it("surfaces an unrecognised value already in use, so it isn't lost", () => {
    // The point: a class nobody anticipated stays selectable.
    expect(merge(["cow"], ["ox"])).toContain("ox");
  });
});
