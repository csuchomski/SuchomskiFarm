import { herdSchema } from "./supabase";

/**
 * Access layer for herd.animals and the tables that describe an animal.
 *
 * breed_composition and breeds have rows and are joined. lactations,
 * test_days, treatments and calvings are all empty, so nothing queries them
 * — a join that can only return nothing is a query you pay for and a section
 * of UI that can only ever say "no data". See IMPLEMENTATION_PLAN.md.
 */

const ANIMAL_COLUMNS = "id, ear_tag, barn_name, sex, class, status, birth_date, sire_id, dam_id, notes";

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
}

export interface BreedShare {
  breedId: string;
  name: string;
  code: string;
  percent: number;
}

export async function fetchAnimals(): Promise<RealAnimal[]> {
  const { data, error } = await herdSchema().from("animals").select(ANIMAL_COLUMNS).order("barn_name");
  if (error) throw new Error(`herd.animals: ${error.message}`);
  return (data ?? []) as RealAnimal[];
}

export async function fetchAnimalByTag(earTag: string): Promise<RealAnimal | null> {
  const { data, error } = await herdSchema().from("animals").select(ANIMAL_COLUMNS).eq("ear_tag", earTag).maybeSingle();
  if (error) throw new Error(`herd.animals: ${error.message}`);
  return data as RealAnimal | null;
}

/** Breed shares for a set of animals, keyed by animal id. Sorted heaviest
 * first, so a display can take the first one as the dominant breed. */
export async function fetchBreedComposition(animalIds: string[]): Promise<Map<string, BreedShare[]>> {
  const out = new Map<string, BreedShare[]>();
  if (animalIds.length === 0) return out;

  const [compRes, breedRes] = await Promise.all([
    herdSchema().from("breed_composition").select("animal_id, breed_id, percent").in("animal_id", animalIds),
    herdSchema().from("breeds").select("id, code, name"),
  ]);
  if (compRes.error) throw new Error(`herd.breed_composition: ${compRes.error.message}`);
  if (breedRes.error) throw new Error(`herd.breeds: ${breedRes.error.message}`);

  const breeds = new Map(
    ((breedRes.data ?? []) as { id: string; code: string; name: string }[]).map((b) => [b.id, b]),
  );

  for (const row of (compRes.data ?? []) as { animal_id: string; breed_id: string; percent: number }[]) {
    const breed = breeds.get(row.breed_id);
    const list = out.get(row.animal_id) ?? [];
    list.push({
      breedId: row.breed_id,
      name: breed?.name ?? "Unknown breed",
      code: breed?.code ?? "?",
      percent: Number(row.percent),
    });
    out.set(row.animal_id, list);
  }

  for (const list of out.values()) list.sort((a, b) => b.percent - a.percent);
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
