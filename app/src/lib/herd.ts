import { herdSchema } from "./supabase";

/**
 * Access layer for herd.animals and the tables that describe an animal.
 *
 * breed_composition and breeds have rows and are joined. lactations,
 * test_days, treatments and calvings are all empty, so nothing queries them
 * — a join that can only return nothing is a query you pay for and a section
 * of UI that can only ever say "no data". See IMPLEMENTATION_PLAN.md.
 */

const ANIMAL_COLUMNS =
  "id, ear_tag, barn_name, sex, class, status, birth_date, sire_id, dam_id, notes, purpose, origin, record_type";

export interface RealAnimal {
  id: string;
  ear_tag: string;
  barn_name: string | null;
  sex: string;
  class: string;
  status: string;
  birth_date: string;
  sire_id: string | null;
  dam_id: string | null;
  notes: string | null;
  purpose: string;
  origin: string;
  /** 'herd' for an animal that lives here; 'reference' for one that exists
   * only to be named in a pedigree — an AI bull you buy straws from. Reads
   * that walk ancestry need both; anything that counts, feeds or milks the
   * herd wants only 'herd'. See lib/sires.ts. */
  record_type: string;
}

/** The animals this farm actually keeps. Reference rows are ancestors and
 * catalogue bulls, not livestock, and counting them would overstate the
 * herd on every screen that shows a total.
 *
 * Generic over the row rather than tied to RealAnimal: Today reads a narrower
 * set of columns and still needs this exact predicate. One definition, so a
 * catalogue bull can't be livestock on one screen and not on another. */
export const herdOnly = <T extends { record_type: string }>(animals: T[]): T[] =>
  animals.filter((a) => a.record_type !== "reference");

/**
 * Is this animal milked?
 *
 * `purpose` is the switch, not her breeds. A cow can be a dairy breed and be
 * run as a beef cow — that is exactly what a Jersey nursing her own calf is —
 * and the farm records that decision on the animal. Breed composition says
 * what she is; purpose says what she's for.
 *
 * 'dual' counts as milked, matching herd.record_calving, which opens a
 * lactation for `purpose in ('dairy', 'dual')`. Keeping one definition here
 * and one there is the whole point: a beef cow who calved never got a
 * lactation from the database, and the app was still counting her as a cow
 * missing one.
 */
export const isMilked = (animal: { purpose: string }): boolean =>
  animal.purpose === "dairy" || animal.purpose === "dual";

/** Females old enough to have calved, on the dairy side of the herd. */
export const milkingHerd = (animals: RealAnimal[]): RealAnimal[] =>
  herdOnly(animals).filter((a) => a.sex === "female" && a.class !== "calf" && isMilked(a));

export interface BreedShare {
  breedId: string;
  name: string;
  code: string;
  percent: number;
}

export async function fetchAnimals(): Promise<RealAnimal[]> {
  const { data, error } = await herdSchema()
    .from("animals")
    .select(ANIMAL_COLUMNS)
    .is("deleted_at", null)
    .order("barn_name");
  if (error) throw new Error(`herd.animals: ${error.message}`);
  return (data ?? []) as RealAnimal[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The link to an animal's record.
 *
 * Her tag, because a URL somebody reads or types should say which animal it
 * is. Migration 059 makes a tag required and unique within the farm, so from
 * here on every animal has one.
 *
 * **Rows written before 059 might not**, and an animal with a blank tag had
 * no reachable record at all — the link came out as `/animals/`, which is
 * the list. Falling back to the id keeps her reachable, and the record page
 * resolves either form. It is a way back to a row that needs fixing, not a
 * second addressing scheme: give her a tag and the link becomes the tag.
 */
export const animalPath = (animal: { id: string; ear_tag: string }): string =>
  `/animals/${encodeURIComponent(animal.ear_tag.trim() || animal.id)}`;

/** Resolve what `animalPath` produced: a tag, or an id for an animal that has
 *  no tag to be found by. */
export async function fetchAnimalByTag(tagOrId: string): Promise<RealAnimal | null> {
  const column = UUID.test(tagOrId) ? "id" : "ear_tag";
  const { data, error } = await herdSchema()
    .from("animals")
    .select(ANIMAL_COLUMNS)
    .eq(column, tagOrId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`herd.animals: ${error.message}`);
  return data as RealAnimal | null;
}

/** The fields this app lets you change. Everything else on herd.animals —
 * tattoos, genotypes, registry numbers, the audit columns — is left alone,
 * so an edit here can't quietly blank a column the form doesn't show. */
export interface AnimalEdit {
  barn_name: string;
  ear_tag: string;
  sex: string;
  class: string;
  status: string;
  birth_date: string;
  notes: string;
  dam_id: string | null;
  sire_id: string | null;
  purpose: string;
  origin: string;
}

/**
 * Creating needs the six columns that are NOT NULL with no default —
 * purpose, sex, class, birth_date, origin and farm_id. Everything else on
 * the table defaults ('' , 'unknown', 'untested', 'herd', 'active'), so this
 * deliberately sends nothing for them rather than inventing values.
 */
export async function createAnimal(farmId: string, patch: AnimalEdit): Promise<RealAnimal> {
  const { data, error } = await herdSchema()
    .from("animals")
    .insert({ ...patch, farm_id: farmId, class_is_manual: true })
    .select(ANIMAL_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as RealAnimal;
}

export async function updateAnimal(id: string, patch: AnimalEdit): Promise<RealAnimal> {
  const { data, error } = await herdSchema()
    .from("animals")
    .update({
      ...patch,
      // class_is_manual records that a human set the class rather than it
      // being derived from age — otherwise whatever computes it could
      // silently revert this edit.
      class_is_manual: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ANIMAL_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as RealAnimal;
}

/** Breed shares for a set of animals, keyed by animal id. Sorted heaviest
 * first, so a display can take the first one as the dominant breed. */
export async function fetchBreedComposition(animalIds: string[]): Promise<Map<string, BreedShare[]>> {
  const out = new Map<string, BreedShare[]>();
  if (animalIds.length === 0) return out;

  const [compRes, breedRes] = await Promise.all([
    herdSchema()
      .from("breed_composition")
      .select("animal_id, breed_id, percent")
      .in("animal_id", animalIds)
      .is("deleted_at", null),
    herdSchema().from("breeds").select("id, code, name").is("deleted_at", null),
  ]);
  if (compRes.error) throw new Error(`herd.breed_composition: ${compRes.error.message}`);
  if (breedRes.error) throw new Error(`herd.breeds: ${breedRes.error.message}`);

  const breeds = new Map(
    ((breedRes.data ?? []) as { id: string; code: string; name: string }[]).map((b) => [b.id, b]),
  );

  // Summed per breed, not one entry per row. An animal can inherit the same
  // breed down both sides — 50% Jersey from the dam and 25% from the sire is
  // 75% Jersey, not "Jersey · Jersey".
  const byAnimal = new Map<string, Map<string, number>>();
  for (const row of (compRes.data ?? []) as { animal_id: string; breed_id: string; percent: number }[]) {
    const shares = byAnimal.get(row.animal_id) ?? new Map<string, number>();
    shares.set(row.breed_id, (shares.get(row.breed_id) ?? 0) + Number(row.percent));
    byAnimal.set(row.animal_id, shares);
  }

  for (const [animalId, shares] of byAnimal) {
    const list: BreedShare[] = [...shares.entries()].map(([breedId, percent]) => {
      const breed = breeds.get(breedId);
      return {
        breedId,
        name: breed?.name ?? "Unknown breed",
        code: breed?.code ?? "?",
        percent: Math.round(percent * 100) / 100,
      };
    });
    list.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
    out.set(animalId, list);
  }

  return out;
}

/**
 * "Jersey" when it's a purebred, "Jersey × Holstein" for a cross, and the
 * percentages only when they're not the obvious even split — a 50/50 cross
 * reads better without "50% / 50%" after it.
 */
export function describeBreeding(shares: BreedShare[] | undefined): string | null {
  if (!shares || shares.length === 0) return null;
  if (shares.length === 1) return shares[0].percent >= 99.5 ? shares[0].name : `${pct(shares[0].percent)} ${shares[0].name}`;

  const even = shares.every((s) => Math.abs(s.percent - 100 / shares.length) < 0.5);
  if (even) return shares.map((s) => s.name).join(" × ");
  return shares.map((s) => `${pct(s.percent)} ${s.name}`).join(" · ");
}

function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/** "2023-05-01" -> "3 years", "2026-07-24" -> "2 weeks" — coarse, matches
 * how a farmer thinks about age rather than exact day counts. */
export function formatAge(birthDateIso: string, todayIso = new Date().toISOString().slice(0, 10)): string {
  const birth = new Date(birthDateIso);
  const today = new Date(todayIso);
  const days = Math.max(0, Math.floor((today.getTime() - birth.getTime()) / 86_400_000));
  if (days < 60) return `${Math.max(1, Math.floor(days / 7))} week${days < 14 ? "" : "s"}`;
  if (days < 730) return `${Math.floor(days / 30.44)} months`;
  return `${Math.floor(days / 365.25)} years`;
}

// ─── attribute vocabularies ────────────────────────────────────────────

export interface AttributeOption {
  code: string;
  label: string;
}

export type AttributeOptions = Record<string, AttributeOption[]>;

/** Attributes the animal form offers. Others may exist in the table
 * (horn_status, record_type…) and are ignored until something edits them. */
export const ANIMAL_ATTRIBUTES = ["sex", "class", "purpose", "origin", "status"] as const;

/**
 * Vocabularies from herd.attribute_options. Returns null when the table
 * doesn't exist yet — migration 013 hasn't run — so callers can fall back to
 * deriving options from the herd rather than showing nothing.
 */
export async function fetchAttributeOptions(): Promise<AttributeOptions | null> {
  const { data, error } = await herdSchema()
    .from("attribute_options")
    .select("attribute, code, label, sort_order")
    .eq("active", true)
    .is("deleted_at", null)
    .order("sort_order");

  if (error) {
    if (/does not exist|schema cache|not find the table|relation/i.test(error.message)) return null;
    throw new Error(`herd.attribute_options: ${error.message}`);
  }

  const out: AttributeOptions = {};
  for (const row of (data ?? []) as { attribute: string; code: string; label: string }[]) {
    (out[row.attribute] ??= []).push({ code: row.code, label: row.label });
  }
  return out;
}

export async function addAttributeOption(
  farmId: string,
  attribute: string,
  code: string,
  label: string,
): Promise<AttributeOption> {
  const { data, error } = await herdSchema()
    .from("attribute_options")
    .insert({ farm_id: farmId, attribute, code: code.trim(), label: label.trim() })
    .select("code, label")
    .single();
  if (error) throw new Error(error.message);
  return data as AttributeOption;
}

// ─── pedigree ──────────────────────────────────────────────────────────

export interface PedigreeNode {
  /** null when no parent is recorded, or the record isn't in this herd. */
  animal: RealAnimal | null;
  /** True when an id is on file but the animal isn't in the herd — an
   * outside sire, say. Distinct from simply not knowing. */
  offHerd: boolean;
  role: "dam" | "sire";
}

/**
 * Generations of ancestors, widest-first per generation: [dam, sire], then
 * [dam's dam, dam's sire, sire's dam, sire's sire], and so on. Slots are
 * always 2^n so the grid stays aligned even where ancestry is unknown —
 * a chart with holes still has to line up.
 */
export function buildPedigree(animal: RealAnimal, herd: RealAnimal[], generations = 3): PedigreeNode[][] {
  const byId = new Map(herd.map((a) => [a.id, a]));
  const out: PedigreeNode[][] = [];
  let level: (RealAnimal | null)[] = [animal];

  for (let g = 0; g < generations; g++) {
    const nodes: PedigreeNode[] = [];
    const next: (RealAnimal | null)[] = [];

    for (const current of level) {
      for (const role of ["dam", "sire"] as const) {
        const id = current ? (role === "dam" ? current.dam_id : current.sire_id) : null;
        const found = id ? (byId.get(id) ?? null) : null;
        nodes.push({ animal: found, offHerd: Boolean(id) && !found, role });
        next.push(found);
      }
    }

    out.push(nodes);
    level = next;
    // Nothing known at this depth, so deeper generations are all blank.
    if (nodes.every((n) => !n.animal)) break;
  }

  return out;
}

/** Point an existing animal at a parent — the "this calf is hers" case,
 * done from the parent's record rather than by editing the calf. */
export async function setParent(childId: string, role: "dam" | "sire", parentId: string | null): Promise<RealAnimal> {
  const { data, error } = await herdSchema()
    .from("animals")
    .update({ [role === "dam" ? "dam_id" : "sire_id"]: parentId, updated_at: new Date().toISOString() })
    .eq("id", childId)
    .select(ANIMAL_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as RealAnimal;
}
