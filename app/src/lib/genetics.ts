import { herdSchema } from "./supabase";

/**
 * Genetics: marker genotypes, genetic-condition statuses, and what a pairing
 * would risk.
 *
 * The vocabularies here are not invented — every code and value mirrors a
 * CHECK constraint on the live schema (herd.marker_genotypes,
 * herd.animal_genetic_status, herd.genetic_conditions). A value this file
 * offers that the database rejects would be a save that fails at the very
 * end, so the two lists have to agree. See docs/migrations/016 for the
 * uniqueness guard that lets a re-test overwrite rather than pile up.
 */

// ─── markers ───────────────────────────────────────────────────────────

export type MarkerCode =
  | "BETA_CASEIN"
  | "KAPPA_CASEIN"
  | "BETA_LACTOGLOBULIN"
  | "RED_FACTOR"
  | "DILUTION";

export interface MarkerDef {
  code: MarkerCode;
  label: string;
  /** Allowed genotypes, in the order the constraint lists them. */
  genotypes: string[];
  /** Pretty labels for genotypes that aren't self-explanatory. */
  labels?: Record<string, string>;
  /** The value a dairy herd is usually selecting for, highlighted in lists.
   * Absent where there's no "better" answer — coat colour isn't a goal. */
  desirable?: string;
  note: string;
}

export const MARKERS: MarkerDef[] = [
  {
    code: "BETA_CASEIN",
    label: "Beta casein",
    genotypes: ["A2A2", "A1A2", "A1A1"],
    desirable: "A2A2",
    note: "A2A2 milk is the one customers ask for by name.",
  },
  {
    code: "KAPPA_CASEIN",
    label: "Kappa casein",
    genotypes: ["AA", "AB", "BB", "AE", "BE", "EE"],
    desirable: "BB",
    note: "BB gives the best cheese yield and curd firmness. E is the one to avoid.",
  },
  {
    code: "BETA_LACTOGLOBULIN",
    label: "Beta lactoglobulin",
    genotypes: ["AA", "AB", "BB"],
    desirable: "BB",
    note: "BB leans toward higher casein and better cheese; AA toward more whey protein.",
  },
  {
    code: "RED_FACTOR",
    label: "Red factor",
    genotypes: ["homozygous_black", "heterozygous_black", "homozygous_red"],
    labels: {
      homozygous_black: "Black (homozygous)",
      heterozygous_black: "Black, carries red",
      homozygous_red: "Red",
    },
    note: "Coat colour. Two red-carriers can throw a red calf.",
  },
  {
    code: "DILUTION",
    label: "Dilution",
    genotypes: ["none", "heterozygous", "homozygous"],
    labels: { none: "None", heterozygous: "One copy", homozygous: "Two copies" },
    note: "Lightens the coat where present.",
  },
];

export const markerDef = (code: string): MarkerDef | undefined => MARKERS.find((m) => m.code === code);

/** "A2A2" as written, "Black, carries red" where the raw value is a slug. */
export function genotypeLabel(markerCode: string, genotype: string): string {
  return markerDef(markerCode)?.labels?.[genotype] ?? genotype;
}

// ─── conditions ────────────────────────────────────────────────────────

export type Inheritance = "recessive" | "dominant" | "haplotype";
export type ConditionStatusCode = "free" | "carrier" | "affected" | "untested";
export type StatusSource = "test" | "pedigree_inferred" | "reported" | "registry";

export const STATUS_CODES: ConditionStatusCode[] = ["free", "carrier", "affected", "untested"];
export const STATUS_SOURCES: StatusSource[] = ["test", "pedigree_inferred", "reported", "registry"];

export interface GeneticCondition {
  id: string;
  code: string;
  name: string;
  inheritance: Inheritance;
  species_scope: "dairy" | "beef" | "both";
}

export interface ConditionStatus {
  id: string;
  animal_id: string;
  condition_id: string;
  status: ConditionStatusCode;
  source: StatusSource;
  recorded_on: string;
}

export interface MarkerGenotype {
  id: string;
  animal_id: string;
  marker_code: string;
  genotype: string;
  tested_on: string | null;
  source: string;
}

// ─── reads ─────────────────────────────────────────────────────────────

const CONDITION_COLUMNS = "id, code, name, inheritance, species_scope";
const STATUS_COLUMNS = "id, animal_id, condition_id, status, source, recorded_on";
const MARKER_COLUMNS = "id, animal_id, marker_code, genotype, tested_on, source";

export async function fetchConditions(): Promise<GeneticCondition[]> {
  const { data, error } = await herdSchema()
    .from("genetic_conditions")
    .select(CONDITION_COLUMNS)
    .eq("active", true)
    .is("deleted_at", null)
    .order("code");
  if (error) throw new Error(`herd.genetic_conditions: ${error.message}`);
  return (data ?? []) as GeneticCondition[];
}

export async function fetchConditionStatuses(animalIds: string[]): Promise<ConditionStatus[]> {
  if (animalIds.length === 0) return [];
  const { data, error } = await herdSchema()
    .from("animal_genetic_status")
    .select(STATUS_COLUMNS)
    .in("animal_id", animalIds)
    .is("deleted_at", null);
  if (error) throw new Error(`herd.animal_genetic_status: ${error.message}`);
  return (data ?? []) as ConditionStatus[];
}

export async function fetchMarkers(animalIds: string[]): Promise<MarkerGenotype[]> {
  if (animalIds.length === 0) return [];
  const { data, error } = await herdSchema()
    .from("marker_genotypes")
    .select(MARKER_COLUMNS)
    .in("animal_id", animalIds)
    .is("deleted_at", null);
  if (error) throw new Error(`herd.marker_genotypes: ${error.message}`);
  return (data ?? []) as MarkerGenotype[];
}

// ─── writes ────────────────────────────────────────────────────────────

/**
 * One genotype per animal per marker. Written find-then-write rather than
 * as an upsert: the unique index that would make `on conflict` work ships in
 * migration 016, and this has to behave the same before and after it runs.
 * With the index in place this is still correct — it just does the lookup
 * the database would otherwise do.
 *
 * A re-test overwrites. Keeping both rows would make "what is she?" a
 * question with two answers and no way to tell which is current.
 */
export async function saveMarker(
  farmId: string,
  animalId: string,
  markerCode: MarkerCode,
  genotype: string,
  opts: { testedOn?: string | null; source?: string } = {},
): Promise<MarkerGenotype> {
  const def = markerDef(markerCode);
  if (!def) throw new Error(`Unknown marker ${markerCode}.`);
  if (!def.genotypes.includes(genotype)) {
    throw new Error(`${genotype} isn't a ${def.label} result — expected one of ${def.genotypes.join(", ")}.`);
  }

  const existing = await herdSchema()
    .from("marker_genotypes")
    .select("id")
    .eq("animal_id", animalId)
    .eq("marker_code", markerCode)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const patch = {
    genotype,
    tested_on: opts.testedOn ?? null,
    source: opts.source ?? "test",
    updated_at: new Date().toISOString(),
  };

  const { data, error } = existing.data
    ? await herdSchema().from("marker_genotypes").update(patch).eq("id", existing.data.id).select(MARKER_COLUMNS).single()
    : await herdSchema()
        .from("marker_genotypes")
        .insert({ ...patch, farm_id: farmId, animal_id: animalId, marker_code: markerCode })
        .select(MARKER_COLUMNS)
        .single();

  if (error) throw new Error(error.message);
  return data as MarkerGenotype;
}

/** Soft delete, because the role has no DELETE grant on herd tables. */
export async function clearMarker(id: string): Promise<void> {
  const { error } = await herdSchema()
    .from("marker_genotypes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Same find-then-write shape as saveMarker, for the same reason. */
export async function saveConditionStatus(
  farmId: string,
  animalId: string,
  conditionId: string,
  status: ConditionStatusCode,
  opts: { source?: StatusSource; recordedOn?: string } = {},
): Promise<ConditionStatus> {
  if (!STATUS_CODES.includes(status)) throw new Error(`${status} isn't a genetic status.`);

  const existing = await herdSchema()
    .from("animal_genetic_status")
    .select("id")
    .eq("animal_id", animalId)
    .eq("condition_id", conditionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const patch = {
    status,
    source: opts.source ?? "test",
    recorded_on: opts.recordedOn ?? new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = existing.data
    ? await herdSchema()
        .from("animal_genetic_status")
        .update(patch)
        .eq("id", existing.data.id)
        .select(STATUS_COLUMNS)
        .single()
    : await herdSchema()
        .from("animal_genetic_status")
        .insert({ ...patch, farm_id: farmId, animal_id: animalId, condition_id: conditionId })
        .select(STATUS_COLUMNS)
        .single();

  if (error) throw new Error(error.message);
  return data as ConditionStatus;
}

export async function clearConditionStatus(id: string): Promise<void> {
  const { error } = await herdSchema()
    .from("animal_genetic_status")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ─── breed composition ─────────────────────────────────────────────────

export interface BreedEntry {
  breedId: string;
  percent: number;
}

/**
 * Composition has to total 100. A cow that is 60% Jersey and nothing else
 * isn't 60% of a cow — the remainder is a breed you haven't named, and
 * storing it as-is would make every downstream percentage wrong.
 *
 * The database only checks each row is in (0, 100]; the total is this
 * app's rule, so it's enforced here where it can be explained.
 */
export function validateComposition(entries: BreedEntry[]): string | null {
  const kept = entries.filter((e) => e.breedId !== "");
  if (kept.length === 0) return null; // clearing composition entirely is allowed

  if (kept.some((e) => !Number.isFinite(e.percent) || e.percent <= 0)) {
    return "Every breed needs a share above zero — remove the row instead.";
  }
  if (kept.some((e) => e.percent > 100)) return "No breed can be more than 100%.";

  const seen = new Set<string>();
  for (const e of kept) {
    if (seen.has(e.breedId)) return "The same breed is listed twice — combine them into one share.";
    seen.add(e.breedId);
  }

  const total = Math.round(kept.reduce((s, e) => s + e.percent, 0) * 100) / 100;
  if (Math.abs(total - 100) > 0.01) {
    return `Shares total ${total}%, not 100% — ${total < 100 ? "add the rest" : "trim it back"}.`;
  }
  return null;
}

/**
 * Replaces an animal's composition wholesale: soft-delete what's there, then
 * insert the new set. Not a diff, because a diff has to decide what "the
 * same row" means when a breed's share changes, and getting that wrong
 * leaves a stale row that silently inflates the total.
 */
export async function saveComposition(farmId: string, animalId: string, entries: BreedEntry[]): Promise<void> {
  const problem = validateComposition(entries);
  if (problem) throw new Error(problem);

  const clear = await herdSchema()
    .from("breed_composition")
    .update({ deleted_at: new Date().toISOString() })
    .eq("animal_id", animalId)
    .is("deleted_at", null);
  if (clear.error) throw new Error(clear.error.message);

  const kept = entries.filter((e) => e.breedId !== "");
  if (kept.length === 0) return;

  const { error } = await herdSchema()
    .from("breed_composition")
    .insert(kept.map((e) => ({ farm_id: farmId, animal_id: animalId, breed_id: e.breedId, percent: e.percent })));
  if (error) throw new Error(error.message);
}

export interface Breed {
  id: string;
  code: string;
  name: string;
  species_type: string;
}

export async function fetchBreeds(): Promise<Breed[]> {
  const { data, error } = await herdSchema()
    .from("breeds")
    .select("id, code, name, species_type")
    .eq("active", true)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(`herd.breeds: ${error.message}`);
  return (data ?? []) as Breed[];
}

// ─── pairing risk ──────────────────────────────────────────────────────

export type RiskLevel = "risk" | "watch" | "clear" | "unknown";

export interface PairingRisk {
  conditionId: string;
  code: string;
  name: string;
  inheritance: Inheritance;
  sire: ConditionStatusCode;
  dam: ConditionStatusCode;
  /** Percent of calves expected to be affected, or null when unknowable. */
  affectedPercent: number | null;
  /** Percent expected to carry a copy without showing it. */
  carrierPercent: number | null;
  level: RiskLevel;
  note: string;
}

const statusFor = (
  statuses: ConditionStatus[],
  animalId: string | null,
  conditionId: string,
): ConditionStatusCode => {
  if (!animalId) return "untested";
  return statuses.find((s) => s.animal_id === animalId && s.condition_id === conditionId)?.status ?? "untested";
};

/**
 * What mating these two would risk, per condition.
 *
 * The rule that matters most is the one that keeps this quiet: for a
 * recessive, a single `free` parent means no calf can be affected, whatever
 * the other parent is — even untested. Without that, every untested animal
 * in the herd would light up against every condition and the page would be
 * unreadable, which is how a real warning gets missed.
 */
export function pairingRisks(
  sireId: string | null,
  damId: string | null,
  conditions: GeneticCondition[],
  statuses: ConditionStatus[],
): PairingRisk[] {
  const out = conditions.map((c) => {
    const sire = statusFor(statuses, sireId, c.id);
    const dam = statusFor(statuses, damId, c.id);
    return { condition: c, ...riskOf(c.inheritance, sire, dam), sire, dam };
  });

  return out
    .map(
      (r): PairingRisk => ({
        conditionId: r.condition.id,
        code: r.condition.code,
        name: r.condition.name,
        inheritance: r.condition.inheritance,
        sire: r.sire,
        dam: r.dam,
        affectedPercent: r.affectedPercent,
        carrierPercent: r.carrierPercent,
        level: r.level,
        note: r.note,
      }),
    )
    .sort((a, b) => RISK_ORDER[a.level] - RISK_ORDER[b.level] || a.code.localeCompare(b.code));
}

const RISK_ORDER: Record<RiskLevel, number> = { risk: 0, watch: 1, unknown: 2, clear: 3 };

/** Copies of the allele a parent passes on, as a fraction of gametes. */
const dose = (s: ConditionStatusCode): number | null =>
  s === "affected" ? 1 : s === "carrier" ? 0.5 : s === "free" ? 0 : null;

function riskOf(
  inheritance: Inheritance,
  sire: ConditionStatusCode,
  dam: ConditionStatusCode,
): { affectedPercent: number | null; carrierPercent: number | null; level: RiskLevel; note: string } {
  const s = dose(sire);
  const d = dose(dam);

  if (inheritance === "dominant") {
    // One copy shows, so an untested parent can't be ruled out the way a
    // recessive's can — there is no "free partner" shortcut here.
    if (s === null || d === null) {
      return { affectedPercent: null, carrierPercent: null, level: "unknown", note: "Untested — a single copy would show." };
    }
    const unaffected = (1 - s) * (1 - d);
    const affected = Math.round((1 - unaffected) * 100);
    return affected === 0
      ? { affectedPercent: 0, carrierPercent: 0, level: "clear", note: "Neither parent carries it." }
      : { affectedPercent: affected, carrierPercent: 0, level: "risk", note: `About ${affected}% of calves would show it.` };
  }

  // Recessive and haplotype both need two copies to matter.
  if (s === 0 || d === 0) {
    const other = s === 0 ? d : s;
    const carrier = other === null ? null : Math.round(other * 100);
    if (carrier === null) {
      return {
        affectedPercent: 0,
        carrierPercent: null,
        level: "clear",
        note: "One parent is free, so no calf can be affected.",
      };
    }
    return {
      affectedPercent: 0,
      carrierPercent: carrier,
      level: carrier > 0 ? "watch" : "clear",
      note:
        carrier > 0
          ? `No calf can be affected, but about ${carrier}% would carry it.`
          : "Both parents are free.",
    };
  }

  if (s === null || d === null) {
    return { affectedPercent: null, carrierPercent: null, level: "unknown", note: "Not tested on both sides." };
  }

  const affected = Math.round(s * d * 100);
  const carrier = Math.round((s * (1 - d) + d * (1 - s)) * 100);
  if (affected === 0) {
    return { affectedPercent: 0, carrierPercent: carrier, level: carrier > 0 ? "watch" : "clear", note: "No affected calves expected." };
  }

  return {
    affectedPercent: affected,
    carrierPercent: carrier,
    level: "risk",
    note:
      inheritance === "haplotype"
        ? `About ${affected}% of conceptions would fail early.`
        : `About ${affected}% of calves would be affected.`,
  };
}

/** The worst thing a pairing risks, for a one-line summary. */
export function worstRisk(risks: PairingRisk[]): PairingRisk | null {
  return risks.find((r) => r.level === "risk") ?? risks.find((r) => r.level === "watch") ?? null;
}

// ─── herd summary ──────────────────────────────────────────────────────

/** How many animals hold each genotype of a marker, commonest first. */
export function markerSpread(markers: MarkerGenotype[], markerCode: string): { genotype: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of markers) {
    if (m.marker_code !== markerCode) continue;
    counts.set(m.genotype, (counts.get(m.genotype) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([genotype, count]) => ({ genotype, count }))
    .sort((a, b) => b.count - a.count || a.genotype.localeCompare(b.genotype));
}

/** Conditions where at least one animal is a carrier or affected — the ones
 * worth showing. A condition nobody in the herd has is noise. */
export function liveConditions(
  conditions: GeneticCondition[],
  statuses: ConditionStatus[],
): { condition: GeneticCondition; carriers: string[]; affected: string[] }[] {
  return conditions
    .map((condition) => ({
      condition,
      carriers: statuses.filter((s) => s.condition_id === condition.id && s.status === "carrier").map((s) => s.animal_id),
      affected: statuses.filter((s) => s.condition_id === condition.id && s.status === "affected").map((s) => s.animal_id),
    }))
    .filter((r) => r.carriers.length > 0 || r.affected.length > 0)
    .sort(
      (a, b) =>
        b.affected.length - a.affected.length ||
        b.carriers.length - a.carriers.length ||
        a.condition.code.localeCompare(b.condition.code),
    );
}
