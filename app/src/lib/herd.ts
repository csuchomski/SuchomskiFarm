import { herdSchema } from "./supabase";

/**
 * Real-data access layer against the herd.animals table, kept separate
 * from mockData.ts so it's obvious which screens have made the jump.
 * Deliberately minimal right now — no joins to breed_composition,
 * lactations, treatments, or cost_entries yet. Those come in later steps;
 * see IMPLEMENTATION_PLAN.md.
 */
export interface RealAnimal {
  id: string;
  ear_tag: string;
  barn_name: string | null;
  sex: string;
  class: string;
  status: string;
  birth_date: string;
}

export async function fetchAnimals(): Promise<RealAnimal[]> {
  const { data, error } = await herdSchema()
    .from("animals")
    .select("id, ear_tag, barn_name, sex, class, status, birth_date")
    .order("barn_name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchAnimalByTag(earTag: string): Promise<RealAnimal | null> {
  const { data, error } = await herdSchema()
    .from("animals")
    .select("id, ear_tag, barn_name, sex, class, status, birth_date")
    .eq("ear_tag", earTag)
    .maybeSingle();
  if (error) throw error;
  return data;
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
