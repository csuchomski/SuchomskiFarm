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
  /**
   * An animal already on file that *is* this calf. Empty means make a new
   * record, which is the ordinary case — you record the calving as it
   * happens. It is filled in when the calf was entered before the calving
   * was, which is how every animal born before Herd -> Calvings existed got
   * onto the farm. See docs/migrations/031.
   */
  animalId: string;
}

export const emptyCalf = (): CalfDraft => ({
  outcome: "live",
  sex: "",
  earTag: "",
  barnName: "",
  birthWeight: "",
  animalId: "",
});

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
 * How long after calving the farm waits before breeding her back.
 *
 * herd.settings.voluntary_waiting_period_days, seeded at 60 and never read
 * until the timeline drew it. Null rather than a default when the row is
 * missing: the shaded block on a season row is a statement about this farm's
 * policy, and drawing someone else's 60 days would be a lie in the shape of
 * a rule.
 */
export async function fetchVoluntaryWaitDays(): Promise<number | null> {
  const { data, error } = await herdSchema()
    .from("settings")
    .select("value")
    .eq("key", "voluntary_waiting_period_days")
    .maybeSingle();
  if (error) throw new Error(`herd.settings: ${error.message}`);
  const days = Number((data as { value: unknown } | null)?.value);
  return Number.isFinite(days) ? days : null;
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
 * When she's due: the day she was bred plus her gestation length.
 *
 * The length comes from lib/gestation.ts, which resolves it from her breeds
 * — a Jersey and a Brown Swiss are eleven days apart, and this used to give
 * them both the species average. Null when nothing on file yields a figure,
 * because a made-up due date is worse than none.
 */
export function dueDate(bredOn: string, gestationDays: number | null | undefined): string | null {
  return gestationDays === null || gestationDays === undefined ? null : addDays(bredOn, gestationDays);
}

/**
 * Which service most likely made this calf.
 *
 * Not the latest before the calving, which is the obvious guess and is wrong
 * exactly when it matters: a cow served in March, returned to heat, served
 * again three weeks later and calving in December conceived on the *first*
 * service — and crediting the second puts the wrong sire on the calf.
 *
 * So: the service whose expected calving date lands nearest the real one.
 * Ties go to the earlier service, since a cow that held to the first was
 * never in calf to the second.
 */
export function likelyService<T extends { id: string; date: string }>(
  calvedOn: string,
  services: T[],
  gestationDays: number | null | undefined,
): T | null {
  const before = services.filter((s) => s.date < calvedOn).sort((a, b) => a.date.localeCompare(b.date));
  if (before.length === 0) return null;
  if (gestationDays === null || gestationDays === undefined) return before[before.length - 1];

  let best = before[0];
  let bestGap = Math.abs(daysBetween(addDays(best.date, gestationDays), calvedOn));
  for (const s of before.slice(1)) {
    const gap = Math.abs(daysBetween(addDays(s.date, gestationDays), calvedOn));
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
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
    // Only a live calf has an animal record, so only a live calf can name one.
    if (calf.animalId !== "" && calf.outcome !== "live") return "Only a live calf can be an animal already on file.";
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
  /** Which service made this calf. Null lets the database fall back to her
   * most recent one, which is wrong whenever she was served twice. */
  breedingEventId?: string | null;
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
      // Omitted rather than sent empty: the function reads `animal_id` being
      // present at all as "adopt this one".
      ...(c.animalId === "" ? {} : { animal_id: c.animalId }),
    })),
    p_calving_ease: input.calvingEase,
    p_assistance: input.assistance,
    p_presentation: input.presentation,
    p_retained_placenta: input.retainedPlacenta,
    p_notes: (input.notes ?? "").trim(),
    p_breeding_event_id: input.breedingEventId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
