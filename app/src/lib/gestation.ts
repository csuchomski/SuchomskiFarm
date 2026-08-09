import { herdSchema } from "./supabase";

/**
 * How long a given cow carries a calf.
 *
 * The figures were already in the database and nothing read them:
 * herd.breeds.default_gestation_days is NOT NULL and every one of the
 * seventeen seeded breeds has one — Brown Swiss 290, Charolais 287, Jersey
 * 279. Due dates were being worked out from settings.gestation_days_beef /
 * _dairy instead, which is a whole-species average: it gave a Jersey and a
 * Brown Swiss the same 279 days, eleven days apart in truth.
 *
 * Resolution order, per breed:
 *
 *   1. this farm's override for that breed (herd.gestation_overrides)
 *   2. the breed's own default
 *
 * and per animal, the weighted average across her breed composition. A
 * purebred is the ordinary case and comes out exactly as her breed's figure;
 * a half Holstein, half Charolais lands between the two, which is roughly
 * how gestation length actually behaves. An animal with no composition
 * recorded falls back to the species setting, which is where everyone was
 * before this.
 */

export interface Breed {
  id: string;
  code: string;
  name: string;
  species_type: string;
  default_gestation_days: number;
  active: boolean;
}

export interface BreedShare {
  animal_id: string;
  breed_id: string;
  percent: number;
}

export interface GestationOverride {
  id: string;
  breed_id: string;
  gestation_days: number;
}

export interface GestationInputs {
  breeds: Breed[];
  composition: BreedShare[];
  overrides: GestationOverride[];
  /** settings.gestation_days_*, keyed by purpose. The fallback. */
  bySpecies: Record<string, number>;
}

/** What a breed counts as here, and whether the farm said so. */
export function daysForBreed(
  breed: Breed,
  overrides: GestationOverride[],
): { days: number; overridden: boolean } {
  const mine = overrides.find((o) => o.breed_id === breed.id);
  return mine ? { days: mine.gestation_days, overridden: true } : { days: breed.default_gestation_days, overridden: false };
}

export interface Gestation {
  days: number;
  /** "Jersey", "Jersey (farm figure)", "½ Holstein, ½ Charolais", or the
   * species fallback — so a due date can be explained without digging. */
  basis: string;
  /** False when this came from the species setting rather than her breeds. */
  fromBreed: boolean;
}

/**
 * Her gestation length, or null when nothing on file gives one — better than
 * a made-up date, and the caller renders a blank.
 */
export function gestationFor(
  animal: { id: string; purpose: string },
  inputs: GestationInputs,
): Gestation | null {
  const breedById = new Map(inputs.breeds.map((b) => [b.id, b]));
  const shares = inputs.composition
    .filter((c) => c.animal_id === animal.id && breedById.has(c.breed_id))
    .map((c) => ({ breed: breedById.get(c.breed_id)!, percent: Number(c.percent) }))
    .filter((s) => s.percent > 0);

  if (shares.length === 0) {
    const days = inputs.bySpecies[animal.purpose];
    if (days === undefined) return null;
    return { days, basis: `${animal.purpose} average`, fromBreed: false };
  }

  const total = shares.reduce((s, x) => s + x.percent, 0);
  let weighted = 0;
  const parts: string[] = [];
  for (const share of shares) {
    const { days, overridden } = daysForBreed(share.breed, inputs.overrides);
    weighted += days * share.percent;
    const fraction = Math.round((share.percent / total) * 100);
    parts.push(
      shares.length === 1
        ? `${share.breed.name}${overridden ? " (farm figure)" : ""}`
        : `${fraction}% ${share.breed.name}${overridden ? "*" : ""}`,
    );
  }

  return { days: Math.round(weighted / total), basis: parts.join(", "), fromBreed: true };
}

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchBreeds(farmId: string): Promise<Breed[]> {
  const { data, error } = await herdSchema()
    .from("breeds")
    .select("id, code, name, species_type, default_gestation_days, active")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(`herd.breeds: ${error.message}`);
  return (data ?? []) as Breed[];
}

export async function fetchComposition(farmId: string): Promise<BreedShare[]> {
  const { data, error } = await herdSchema()
    .from("breed_composition")
    .select("animal_id, breed_id, percent")
    .eq("farm_id", farmId)
    .is("deleted_at", null);
  if (error) throw new Error(`herd.breed_composition: ${error.message}`);
  return (data ?? []) as BreedShare[];
}

export async function fetchOverrides(farmId: string): Promise<GestationOverride[]> {
  const { data, error } = await herdSchema()
    .from("gestation_overrides")
    .select("id, breed_id, gestation_days")
    .eq("farm_id", farmId)
    .is("deleted_at", null);
  if (error) throw new Error(`herd.gestation_overrides: ${error.message}`);
  return (data ?? []) as GestationOverride[];
}

// ─── writes ────────────────────────────────────────────────────────────

export function validateGestation(days: string): string | null {
  const raw = days.trim();
  if (raw === "") return null; // clearing it is how you go back to the default
  const value = Number(raw);
  if (!Number.isInteger(value)) return "Gestation is a whole number of days.";
  // Wide on purpose — this is a guard against a typo, not a judgement about
  // anyone's cattle. Real bovine gestation runs roughly 275–295.
  if (value < 240 || value > 320) return "That's not a plausible gestation — expected somewhere near 280 days.";
  return null;
}

/**
 * Set or clear this farm's figure for a breed.
 *
 * Upserts on (farm_id, breed_id), which migration 029 made a key precisely
 * so this doesn't have to select first and race with itself.
 */
export async function setOverride(input: {
  farmId: string;
  breedId: string;
  days: string;
}): Promise<void> {
  const raw = input.days.trim();

  if (raw === "") {
    const { error } = await herdSchema()
      .from("gestation_overrides")
      .update({ deleted_at: new Date().toISOString() })
      .eq("farm_id", input.farmId)
      .eq("breed_id", input.breedId)
      .is("deleted_at", null);
    if (error) throw new Error(`herd.gestation_overrides: ${error.message}`);
    return;
  }

  const { error } = await herdSchema()
    .from("gestation_overrides")
    .upsert(
      { farm_id: input.farmId, breed_id: input.breedId, gestation_days: Number(raw) },
      { onConflict: "farm_id,breed_id" },
    );
  if (error) throw new Error(`herd.gestation_overrides: ${error.message}`);
}
