import { herdSchema } from "./supabase";

/**
 * herd.lactations — a cow's milking period, from freshening to dry-off.
 *
 * The table was fully modelled but had no rows, so this is written
 * write-first: without a way to record a freshening there is nothing for a
 * screen to show.
 *
 * Two invariants the schema doesn't enforce are enforced here instead.
 * There is no unique index on (animal_id, lactation_number), and nothing
 * stops a second open lactation while one is still running — both are
 * nonsense for a real cow, and both would be silently accepted. Checked in
 * `validateFreshening` against the lactations already loaded; a database
 * constraint would be better and is noted in docs/migrations.
 */

export interface RealLactation {
  id: string;
  animal_id: string;
  lactation_number: number;
  fresh_date: string;
  dry_off_date: string | null;
  calving_id: string | null;
  peak_milk_lb: number | null;
  peak_dim: number | null;
  total_yield_lb: number | null;
  me305_lb: number | null;
  termination_reason: string;
}

export const LACTATION_COLUMNS =
  "id, animal_id, lactation_number, fresh_date, dry_off_date, calving_id, peak_milk_lb, peak_dim, total_yield_lb, me305_lb, termination_reason";

const todayIso = () => new Date().toISOString().slice(0, 10);

// ─── derived facts ─────────────────────────────────────────────────────

export type LactationStatus = "in-milk" | "dry" | "scheduled";

/**
 * Where a lactation is right now. `scheduled` covers a fresh_date in the
 * future — recording an expected freshening is reasonable, and calling that
 * "in milk" would put a cow into the milking count before she's calved.
 */
export function statusOf(lactation: RealLactation, today = todayIso()): LactationStatus {
  if (lactation.fresh_date > today) return "scheduled";
  if (lactation.dry_off_date !== null && lactation.dry_off_date <= today) return "dry";
  return "in-milk";
}

/**
 * Days in milk. Counts to the dry-off date once she's dry, so a finished
 * lactation's DIM is its final length rather than a number that keeps
 * climbing forever. Null before she's actually freshened.
 */
export function daysInMilk(lactation: RealLactation, today = todayIso()): number | null {
  if (lactation.fresh_date > today) return null;
  const end = lactation.dry_off_date !== null && lactation.dry_off_date <= today ? lactation.dry_off_date : today;
  return daysBetween(lactation.fresh_date, end);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** The open lactation for an animal, if she has one. */
export function openLactation(lactations: RealLactation[], today = todayIso()): RealLactation | null {
  return lactations.find((l) => statusOf(l, today) === "in-milk") ?? null;
}

/** Parity for the next freshening: one past her highest so far. */
export function nextLactationNumber(lactations: RealLactation[]): number {
  return lactations.reduce((max, l) => Math.max(max, l.lactation_number), 0) + 1;
}

/** Newest first — a cow's current lactation is the one you want at the top. */
export function byFreshDateDesc(a: RealLactation, b: RealLactation): number {
  return b.fresh_date.localeCompare(a.fresh_date) || b.lactation_number - a.lactation_number;
}

// ─── validation ────────────────────────────────────────────────────────

export interface FreshenInput {
  animalId: string;
  lactationNumber: number;
  freshDate: string;
}

/**
 * Returns a reason the freshening can't be recorded, or null when it can.
 * Kept separate from the write so the form can disable its button with the
 * same rule the write enforces, rather than two rules that can disagree.
 */
export function validateFreshening(
  input: FreshenInput,
  existing: RealLactation[],
  today = todayIso(),
): string | null {
  if (!input.freshDate) return "A fresh date is required.";
  if (!Number.isInteger(input.lactationNumber) || input.lactationNumber < 1) {
    return "Lactation number must be a whole number of 1 or more.";
  }

  const forAnimal = existing.filter((l) => l.animal_id === input.animalId);

  if (forAnimal.some((l) => l.lactation_number === input.lactationNumber)) {
    return `Lactation ${input.lactationNumber} already exists for this animal.`;
  }
  if (openLactation(forAnimal, today) !== null) {
    return "She already has an open lactation. Dry her off before recording a new one.";
  }
  // A freshening before a previous one would reorder her history.
  const latest = forAnimal.map((l) => l.fresh_date).sort().at(-1);
  if (latest !== undefined && input.freshDate <= latest) {
    return `Fresh date must be after her previous freshening (${latest}).`;
  }

  return null;
}

export function validateDryOff(lactation: RealLactation, dryOffDate: string, today = todayIso()): string | null {
  if (!dryOffDate) return "A dry-off date is required.";
  if (dryOffDate < lactation.fresh_date) return "Dry-off can't be before she freshened.";
  if (dryOffDate > today) return "Dry-off can't be in the future.";
  return null;
}

// ─── access ────────────────────────────────────────────────────────────

export async function fetchLactations(farmId: string): Promise<RealLactation[]> {
  const { data, error } = await herdSchema()
    .from("lactations")
    .select(LACTATION_COLUMNS)
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("fresh_date", { ascending: false });

  if (error) throw new Error(`herd.lactations: ${error.message}`);
  return (data ?? []) as RealLactation[];
}

/**
 * farm_id is required, not derived: the insert policy is
 * `with check (can_write_farm(farm_id))`, so omitting it fails rather than
 * writing an unscoped row. created_by/created_at/rev are set by the
 * herd.touch_row trigger, so they're deliberately not sent.
 */
export async function recordFreshening(
  farmId: string,
  input: FreshenInput & { calvingId?: string | null },
): Promise<RealLactation> {
  const { data, error } = await herdSchema()
    .from("lactations")
    .insert({
      farm_id: farmId,
      animal_id: input.animalId,
      lactation_number: input.lactationNumber,
      fresh_date: input.freshDate,
      calving_id: input.calvingId ?? null,
    })
    .select(LACTATION_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as RealLactation;
}

export async function recordDryOff(
  id: string,
  dryOffDate: string,
  terminationReason: string,
): Promise<RealLactation> {
  const { data, error } = await herdSchema()
    .from("lactations")
    .update({ dry_off_date: dryOffDate, termination_reason: terminationReason })
    .eq("id", id)
    .select(LACTATION_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as RealLactation;
}

/**
 * Peak, total and ME305 are typed in from a DHIA report rather than derived,
 * because deriving them needs herd.test_days and that table is empty. Once
 * test days are recorded these should be computed and this should become
 * read-only — otherwise a typed figure and the records it summarises can
 * disagree with no way to tell which is right.
 */
export interface LactationFigures {
  peakMilkLb: number | null;
  peakDim: number | null;
  totalYieldLb: number | null;
  me305Lb: number | null;
}

export async function updateFigures(id: string, figures: LactationFigures): Promise<RealLactation> {
  const { data, error } = await herdSchema()
    .from("lactations")
    .update({
      peak_milk_lb: figures.peakMilkLb,
      peak_dim: figures.peakDim,
      total_yield_lb: figures.totalYieldLb,
      me305_lb: figures.me305Lb,
    })
    .eq("id", id)
    .select(LACTATION_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as RealLactation;
}
