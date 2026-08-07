import { describe, expect, it } from "vitest";
import {
  genotypeLabel,
  liveConditions,
  markerSpread,
  pairingRisks,
  validateComposition,
  worstRisk,
  type ConditionStatus,
  type ConditionStatusCode,
  type GeneticCondition,
  type Inheritance,
  type MarkerGenotype,
} from "./genetics";

const cond = (id: string, code: string, inheritance: Inheritance = "recessive"): GeneticCondition => ({
  id,
  code,
  name: code,
  inheritance,
  species_scope: "dairy",
});

const status = (animalId: string, conditionId: string, s: ConditionStatusCode): ConditionStatus => ({
  id: `${animalId}-${conditionId}`,
  animal_id: animalId,
  condition_id: conditionId,
  status: s,
  source: "test",
  recorded_on: "2026-08-01",
});

const marker = (animalId: string, code: string, genotype: string): MarkerGenotype => ({
  id: `${animalId}-${code}`,
  animal_id: animalId,
  marker_code: code,
  genotype,
  tested_on: null,
  source: "test",
});

describe("validateComposition", () => {
  it("accepts a purebred", () => {
    expect(validateComposition([{ breedId: "jersey", percent: 100 }])).toBeNull();
  });

  it("accepts an even cross", () => {
    expect(
      validateComposition([
        { breedId: "jersey", percent: 50 },
        { breedId: "holstein", percent: 50 },
      ]),
    ).toBeNull();
  });

  it("rejects shares that don't reach 100", () => {
    // 60% Jersey and nothing else isn't 60% of a cow — the rest is a breed
    // that hasn't been named.
    expect(validateComposition([{ breedId: "jersey", percent: 60 }])).toMatch(/60%.*add the rest/);
  });

  it("rejects shares over 100", () => {
    expect(
      validateComposition([
        { breedId: "jersey", percent: 80 },
        { breedId: "holstein", percent: 40 },
      ]),
    ).toMatch(/trim it back/);
  });

  it("rejects the same breed twice rather than silently summing it", () => {
    expect(
      validateComposition([
        { breedId: "jersey", percent: 50 },
        { breedId: "jersey", percent: 50 },
      ]),
    ).toMatch(/twice/);
  });

  it("rejects a zero or negative share", () => {
    expect(
      validateComposition([
        { breedId: "jersey", percent: 100 },
        { breedId: "holstein", percent: 0 },
      ]),
    ).toMatch(/above zero/);
  });

  it("allows clearing composition entirely", () => {
    expect(validateComposition([])).toBeNull();
  });

  it("tolerates thirds, which can't sum exactly", () => {
    expect(
      validateComposition([
        { breedId: "a", percent: 33.33 },
        { breedId: "b", percent: 33.33 },
        { breedId: "c", percent: 33.34 },
      ]),
    ).toBeNull();
  });
});

describe("pairingRisks — recessive", () => {
  const CVM = cond("c1", "CVM");

  it("flags carrier × carrier at 25%", () => {
    const risks = pairingRisks("sire", "dam", [CVM], [status("sire", "c1", "carrier"), status("dam", "c1", "carrier")]);
    expect(risks[0]).toMatchObject({ level: "risk", affectedPercent: 25, carrierPercent: 50 });
  });

  it("stays quiet when one parent is free, even against an untested mate", () => {
    // The rule that keeps this page readable. Without it every untested
    // animal lights up against every condition and a real warning is lost
    // in the noise.
    const risks = pairingRisks("sire", "dam", [CVM], [status("sire", "c1", "free")]);
    expect(risks[0]).toMatchObject({ level: "clear", affectedPercent: 0 });
  });

  it("warns about carriers when a free parent meets a carrier", () => {
    const risks = pairingRisks("sire", "dam", [CVM], [status("sire", "c1", "free"), status("dam", "c1", "carrier")]);
    expect(risks[0]).toMatchObject({ level: "watch", affectedPercent: 0, carrierPercent: 50 });
  });

  it("is unknown when neither side is tested", () => {
    expect(pairingRisks("sire", "dam", [CVM], [])[0]).toMatchObject({ level: "unknown", affectedPercent: null });
  });

  it("puts every calf at risk from an affected × carrier mating", () => {
    const risks = pairingRisks("sire", "dam", [CVM], [status("sire", "c1", "affected"), status("dam", "c1", "carrier")]);
    expect(risks[0]).toMatchObject({ level: "risk", affectedPercent: 50 });
  });

  it("is 100% when both parents are affected", () => {
    const risks = pairingRisks(
      "sire",
      "dam",
      [CVM],
      [status("sire", "c1", "affected"), status("dam", "c1", "affected")],
    );
    expect(risks[0].affectedPercent).toBe(100);
  });

  it("is clear with both parents free", () => {
    const risks = pairingRisks("sire", "dam", [CVM], [status("sire", "c1", "free"), status("dam", "c1", "free")]);
    expect(risks[0]).toMatchObject({ level: "clear", carrierPercent: 0 });
  });
});

describe("pairingRisks — haplotype and dominant", () => {
  it("describes a haplotype as lost conceptions, not affected calves", () => {
    const HH1 = cond("h1", "HH1", "haplotype");
    const risks = pairingRisks("sire", "dam", [HH1], [status("sire", "h1", "carrier"), status("dam", "h1", "carrier")]);
    expect(risks[0].affectedPercent).toBe(25);
    expect(risks[0].note).toMatch(/conceptions would fail/);
  });

  it("won't clear a dominant on one free parent, because one copy shows", () => {
    const D = cond("d1", "POLL", "dominant");
    const risks = pairingRisks("sire", "dam", [D], [status("sire", "d1", "free"), status("dam", "d1", "carrier")]);
    expect(risks[0]).toMatchObject({ level: "risk", affectedPercent: 50 });
  });

  it("treats an untested dominant as unknown rather than safe", () => {
    const D = cond("d1", "POLL", "dominant");
    expect(pairingRisks("sire", "dam", [D], [status("sire", "d1", "free")])[0].level).toBe("unknown");
  });
});

describe("pairingRisks — ordering", () => {
  it("puts real risk above watch, unknown and clear", () => {
    const conditions = [cond("c1", "AAA"), cond("c2", "BBB"), cond("c3", "CCC")];
    const risks = pairingRisks(
      "sire",
      "dam",
      conditions,
      [
        // AAA: clear on both sides
        status("sire", "c1", "free"),
        status("dam", "c1", "free"),
        // CCC: both carriers — the one that matters
        status("sire", "c3", "carrier"),
        status("dam", "c3", "carrier"),
      ],
    );
    expect(risks.map((r) => r.code)).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("treats a missing parent as untested rather than throwing", () => {
    expect(pairingRisks(null, "dam", [cond("c1", "CVM")], [])[0].level).toBe("unknown");
  });
});

describe("worstRisk", () => {
  it("prefers a risk over a watch", () => {
    const risks = pairingRisks(
      "sire",
      "dam",
      [cond("c1", "AAA"), cond("c2", "BBB")],
      [
        status("sire", "c1", "free"),
        status("dam", "c1", "carrier"),
        status("sire", "c2", "carrier"),
        status("dam", "c2", "carrier"),
      ],
    );
    expect(worstRisk(risks)?.code).toBe("BBB");
  });

  it("is null when everything is clear", () => {
    const risks = pairingRisks("sire", "dam", [cond("c1", "AAA")], [status("sire", "c1", "free"), status("dam", "c1", "free")]);
    expect(worstRisk(risks)).toBeNull();
  });
});

describe("markerSpread", () => {
  it("counts genotypes, commonest first", () => {
    const markers = [
      marker("a1", "BETA_CASEIN", "A2A2"),
      marker("a2", "BETA_CASEIN", "A2A2"),
      marker("a3", "BETA_CASEIN", "A1A2"),
      marker("a4", "KAPPA_CASEIN", "AB"),
    ];
    expect(markerSpread(markers, "BETA_CASEIN")).toEqual([
      { genotype: "A2A2", count: 2 },
      { genotype: "A1A2", count: 1 },
    ]);
  });

  it("is empty for a marker nobody has been tested for", () => {
    expect(markerSpread([], "BETA_CASEIN")).toEqual([]);
  });
});

describe("liveConditions", () => {
  it("keeps only conditions something in the herd actually has", () => {
    const conditions = [cond("c1", "CVM"), cond("c2", "BLAD")];
    const rows = liveConditions(conditions, [status("a1", "c1", "carrier"), status("a2", "c2", "free")]);
    expect(rows.map((r) => r.condition.code)).toEqual(["CVM"]);
    expect(rows[0].carriers).toEqual(["a1"]);
  });

  it("puts affected animals above carriers", () => {
    const conditions = [cond("c1", "CVM"), cond("c2", "BLAD")];
    const rows = liveConditions(conditions, [
      status("a1", "c1", "carrier"),
      status("a2", "c1", "carrier"),
      status("a3", "c2", "affected"),
    ]);
    expect(rows.map((r) => r.condition.code)).toEqual(["BLAD", "CVM"]);
  });
});

describe("genotypeLabel", () => {
  it("spells out a slug", () => {
    expect(genotypeLabel("RED_FACTOR", "heterozygous_black")).toBe("Black, carries red");
  });

  it("leaves a genotype that already reads well alone", () => {
    expect(genotypeLabel("BETA_CASEIN", "A2A2")).toBe("A2A2");
  });
});
