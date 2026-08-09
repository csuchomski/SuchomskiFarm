import { herdSchema } from "./supabase";

/**
 * Did it take, and then she calved.
 *
 * Both writes are database functions, for the same reason breedings are: a
 * check has to attach itself to the right service and derive days bred from
 * it, and a calving is a calving, its calves, an animal record for each live
 * one, and — for a dairy dam — the lactation it freshens.
 * See docs/migrations/028-pregnancy-and-calving.sql.
 *
 * herd.ultrasound_scans is *not* part of this. It carries imf_pct,
 * ribeye_area_sqin and backfat_in — carcass ultrasound for beef seedstock,
 * nothing to do with pregnancy. A pregnancy ultrasound is a check with
 * method 'ultrasound'.
 */

export const CHECK_METHODS = [
  { code: "palpation", label: "Palpation" },
  { code: "ultrasound", label: "Ultrasound" },
  { code: "blood_biopryn", label: "Blood (BioPRYN)" },
  { code: "milk_test", label: "Milk test" },
  { code: "visual", label: "Visual" },
] as const;

export const CHECK_RESULTS = [
  { code: "pregnant", label: "Pregnant" },
  { code: "open", label: "Open" },
  { code: "recheck", label: "Recheck" },
  { code: "aborted", label: "Aborted" },
] as const;

export const ASSISTANCE = ["unassisted", "easy_pull", "hard_pull", "mechanical", "c_section"] as const;
export const PRESENTATION = ["anterior", "posterior", "breech", "head_back", "leg_back", "other"] as const;
export const OUTCOMES = [
  { code: "live", label: "Live" },
  { code: "stillborn", label: "Stillborn" },
  { code: "died_within_24h", label: "Died within 24h" },
] as const;

export interface PregnancyCheck {
  id: string;
  animal_id: string;
  date: string;
  method: string;
  result: string;
  estimated_days_bred: number | null;
  estimated_conception_date: string | null;
  breeding_event_id: string | null;
  technician: string;
  notes: string;
}

export interface Calving {
  id: string;
  dam_id: string;
  date: string;
  calving_ease: number;
  assistance: string;
  presentation: string;
  retained_placenta: boolean;
  is_twin: boolean;
  breeding_event_id: string | null;
  notes: string;
}

export interface CalfOutcome {
  id: string;
  calving_id: string;
  calf_animal_id: string | null;
  outcome: string;
  sex: string;
  birth_weight_lb: number | null;
  is_freemartin: boolean;
  vigor_score: number | null;
  notes: string;
}

/** One calf as the form collects it, before the database makes it a row. */
export interface CalfDraft {
  outcome: string;
  sex: string;
  earTag: string;
  barnName: string;
  birthWeight: string;
}

export const emptyCalf = (): CalfDraft => ({ outcome: "live", sex: "", earTag: "", barnName: "", birthWeight: "" });

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchPregnancyChecks(farmId: string): Promise<PregnancyCheck[]> {
  const { data, error } = await herdSchema()
    .from("pregnancy_checks")
    .select(
      "id, animal_id, date, method, result, estimated_days_bred, estimated_conception_date, breeding_event_id, technician, notes",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("date", { ascending: false });
  if (error) throw new Error(`herd.pregnancy_checks: ${error.message}`);
  return (data ?? []) as PregnancyCheck[];
}

export async function fetchCalvings(farmId: string): Promise<Calving[]> {
  const { data, error } = await herdSchema()
    .from("calvings")
    .select(
      "id, dam_id, date, calving_ease, assistance, presentation, retained_placenta, is_twin, breeding_event_id, notes",
    )
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("date", { ascending: false });
  if (error) throw new Error(`herd.calvings: ${error.message}`);
  return (data ?? []) as Calving[];
}

export async function fetchCalfOutcomes(farmId: string): Promise<CalfOutcome[]> {
  const { data, error } = await herdSchema()
    .from("calving_outcomes")
    .select("id, calving_id, calf_animal_id, outcome, sex, birth_weight_lb, is_freemartin, vigor_score, notes")
    .eq("farm_id", farmId)
    .is("deleted_at", null);
  if (error) throw new Error(`herd.calving_outcomes: ${error.message}`);
  return (data ?? []) as CalfOutcome[];
}

/**
 * Gestation length per purpose, from the farm's own settings rather than a
 * constant here — they're editable, and a due date computed from a number
 * the farm doesn't hold would drift the moment somebody changed it.
 */
export async function fetchGestationDays(): Promise<Record<string, number>> {
  const { data, error } = await herdSchema().from("settings").select("key, value").like("key", "gestation_days_%");
  if (error) throw new Error(`herd.settings: ${error.message}`);

  const out: Record<string, number> = {};
  for (const row of (data ?? []) as { key: string; value: unknown }[]) {
    const purpose = row.key.replace("gestation_days_", "");
    const days = Number(row.value);
    if (Number.isFinite(days)) out[purpose] = days;
  }
  return out;
}

// ─── derived ───────────────────────────────────────────────────────────

const MS_DAY = 86_400_000;
const parse = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export const addDays = (iso: string, days: number): string =>
  new Date(parse(iso) + days * MS_DAY).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number => Math.round((parse(to) - parse(from)) / MS_DAY);

/**
 * When she's due, from the day she was bred and the gestation length for her
 * purpose. Null when the farm has no figure for that purpose rather than
 * guessing one — a made-up due date is worse than none.
 */
export function dueDate(bredOn: string, purpose: string, gestation: Record<string, number>): string | null {
  const days = gestation[purpose];
  return days === undefined ? null : addDays(bredOn, days);
}

/** The latest check for a breeding, which is the one that counts — a recheck
 * supersedes the check that asked for it. */
export function latestCheck(checks: PregnancyCheck[], breedingId: string): PregnancyCheck | null {
  const mine = checks
    .filter((c) => c.breeding_event_id === breedingId)
    .sort((a, b) => b.date.localeCompare(a.date));
  return mine[0] ?? null;
}

// ─── validation ────────────────────────────────────────────────────────

export function validateCheck(input: {
  animalId: string;
  date: string;
  method: string;
  result: string;
  bredOn?: string | null;
}): string | null {
  if (!input.animalId) return "Which cow or heifer?";
  if (!input.date) return "When was she checked?";
  if (!CHECK_METHODS.some((m) => m.code === input.method)) return "Pick how she was checked.";
  if (!CHECK_RESULTS.some((r) => r.code === input.result)) return "Pick what it came back as.";
  // record_pregnancy_check refuses this too; catching it here names the day.
  if (input.bredOn && input.bredOn > input.date) return `She was bred on ${input.bredOn}, after this check.`;
  return null;
}

export function validateCalving(input: { damId: string; date: string; calves: CalfDraft[] }): string | null {
  if (!input.damId) return "Which cow or heifer calved?";
  if (!input.date) return "When did she calve?";
  if (input.calves.length === 0) return "A calving needs at least one calf, even a stillborn one.";

  for (const calf of input.calves) {
    if (!OUTCOMES.some((o) => o.code === calf.outcome)) return "Each calf is live, stillborn, or died within 24h.";
    // animals.sex is NOT NULL, so a live calf can't get a record without one.
    if (calf.outcome === "live" && calf.sex === "") return "A live calf needs a sex before it can have its own record.";
    const w = calf.birthWeight.trim();
    if (w !== "" && (!Number.isFinite(Number(w)) || Number(w) <= 0)) return "A birth weight has to be a number above zero.";
  }
  return null;
}

// ─── writes ────────────────────────────────────────────────────────────

export async function recordCheck(input: {
  animalId: string;
  date: string;
  method: string;
  result: string;
  breedingEventId?: string | null;
  technician?: string;
  notes?: string;
}): Promise<string> {
  const { data, error } = await herdSchema().rpc("record_pregnancy_check", {
    p_animal_id: input.animalId,
    p_date: input.date,
    p_method: input.method,
    p_result: input.result,
    p_breeding_event_id: input.breedingEventId ?? null,
    p_technician: (input.technician ?? "").trim(),
    p_notes: (input.notes ?? "").trim(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function recordCalving(input: {
  damId: string;
  date: string;
  calves: CalfDraft[];
  calvingEase: number;
  assistance: string;
  presentation: string;
  retainedPlacenta: boolean;
  notes?: string;
}): Promise<string> {
  const { data, error } = await herdSchema().rpc("record_calving", {
    p_dam_id: input.damId,
    p_date: input.date,
    p_calves: input.calves.map((c) => ({
      outcome: c.outcome,
      sex: c.sex,
      ear_tag: c.earTag.trim(),
      barn_name: c.barnName.trim(),
      birth_weight_lb: c.birthWeight.trim() === "" ? null : Number(c.birthWeight),
    })),
    p_calving_ease: input.calvingEase,
    p_assistance: input.assistance,
    p_presentation: input.presentation,
    p_retained_placenta: input.retainedPlacenta,
    p_notes: (input.notes ?? "").trim(),
    p_breeding_event_id: null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
