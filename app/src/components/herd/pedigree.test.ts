import { describe, expect, it } from "vitest";
import { buildPedigree, type RealAnimal } from "../../lib/herd";
import { isAncestorOf } from "./OffspringEditor";

const a = (id: string, over: Partial<RealAnimal> = {}): RealAnimal => ({
  id,
  ear_tag: id,
  barn_name: id.toUpperCase(),
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2020-01-01",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "dairy",
  origin: "born_on_farm",
  record_type: "herd",
  ...over,
});

describe("buildPedigree", () => {
  it("keeps 2^n slots per generation so the grid stays aligned", () => {
    const child = a("c", { dam_id: "m" });
    const herd = [child, a("m")];
    const levels = buildPedigree(child, herd, 3);
    expect(levels[0]).toHaveLength(2); // dam, sire
    expect(levels[1]).toHaveLength(4); // both grandparents of each
  });

  it("marks a parent whose id is on file but isn't in the herd", () => {
    // An outside sire is different from not knowing who the sire was.
    const child = a("c", { sire_id: "outside" });
    const [parents] = buildPedigree(child, [child], 2);
    const sire = parents.find((n) => n.role === "sire")!;
    expect(sire.animal).toBeNull();
    expect(sire.offHerd).toBe(true);
  });

  it("distinguishes an unrecorded parent from an off-herd one", () => {
    const child = a("c");
    const [parents] = buildPedigree(child, [child], 2);
    expect(parents.every((n) => n.offHerd === false)).toBe(true);
  });

  it("stops early when a generation is entirely unknown", () => {
    const child = a("c");
    expect(buildPedigree(child, [child], 5)).toHaveLength(1);
  });

  it("resolves grandparents through a known dam", () => {
    const gran = a("g");
    const dam = a("m", { dam_id: "g" });
    const child = a("c", { dam_id: "m" });
    const levels = buildPedigree(child, [child, dam, gran], 3);
    expect(levels[1][0].animal?.id).toBe("g");
  });
});

describe("isAncestorOf", () => {
  it("catches making an animal its own parent", () => {
    const x = a("x");
    expect(isAncestorOf(x, x, [x])).toBe(true);
  });

  it("catches making a grandmother into a granddaughter", () => {
    // The loop that would otherwise render as a plausible-looking chart.
    const gran = a("g");
    const dam = a("m", { dam_id: "g" });
    const child = a("c", { dam_id: "m" });
    const herd = [gran, dam, child];
    expect(isAncestorOf(child, gran, herd)).toBe(true);
  });

  it("allows a genuine unrelated animal", () => {
    const cow = a("cow");
    const calf = a("calf");
    expect(isAncestorOf(cow, calf, [cow, calf])).toBe(false);
  });

  it("terminates on data that already contains a cycle", () => {
    const x = a("x", { dam_id: "y" });
    const y = a("y", { dam_id: "x" });
    expect(() => isAncestorOf(x, a("z"), [x, y])).not.toThrow();
  });
});
