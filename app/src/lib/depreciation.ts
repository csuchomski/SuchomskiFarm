import { herdSchema } from "./supabase";
import type { RealAnimal } from "./herd";

/**
 * Economic herd depreciation — the management figure, not the tax one.
 *
 *     (replacement cost of a springing heifer − cull value) ÷ productive lifetime
 *
 * On a dairy this is usually the largest cost of production nobody books.
 * Leaving it out of cost-per-cwt is not conservative: it makes the margin read
 * better than it is, and it drives bad calls on culling aggressiveness, on
 * raising versus buying replacements, and on whether a third lactation is
 * worth chasing.
 *
 * Nothing in this file knows about MACRS, conventions, §179 or §1245
 * recapture, and it must not learn. Tax depreciation exists only where there
 * is basis, and a heifer raised on a cash-basis Schedule F has none — the two
 * computations answer different questions and share only a table. See
 * docs/BACKLOG.md and migration 035.
 */

/** A lactation is taken as a year. That is the convention the arithmetic in
 * the spec already encodes — $2,200 in, $900 out, 3.5 lactations, $371/year —
 * and it is named here rather than hidden in a divisor. */
const DAYS_PER_YEAR = 365;

export interface Assumptions {
  /** What a springing heifer costs to replace, in cents. */
  replacementCents: number;
  /** What she is worth going out, in cents. */
  cullCents: number;
  /** How many lactations she is expected to give. */
  lifetimeLactations: number;
  /** Fallback yield for a $/cwt where a cow has no record of her own, in lb. */
  expectedAnnualYieldLb: number;
  /** Production is logged in gallons; cwt is a hundredweight of pounds. */
  milkLbPerGallon: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  replacementCents: 220000,
  cullCents: 90000,
  lifetimeLactations: 3.5,
  expectedAnnualYieldLb: 20000,
  milkLbPerGallon: 8.6,
};

/**
 * What each cow costs the farm per year simply by wearing out.
 *
 * Null rather than zero when the assumptions can't produce a figure — a zero
 * would quietly add nothing to cost of production, which is the exact error
 * this whole feature exists to correct.
 */
export function annualChargeCents(a: Assumptions): number | null {
  if (!Number.isFinite(a.lifetimeLactations) || a.lifetimeLactations <= 0) return null;
  if (!Number.isFinite(a.replacementCents) || !Number.isFinite(a.cullCents)) return null;
  if (a.cullCents > a.replacementCents) return null;
  return (a.replacementCents - a.cullCents) / a.lifetimeLactations;
}

/**
 * The same charge as dollars per hundredweight of milk.
 *
 * This is the number that changes decisions, and it moves with yield as much
 * as with the spread: $371 a year is $1.86/cwt at 20,000 lb and $2.32/cwt at
 * 16,000 lb. Which is why `perCwt` takes a yield rather than assuming one.
 */
export function perCwtCents(annualCents: number | null, annualYieldLb: number): number | null {
  if (annualCents === null) return null;
  if (!Number.isFinite(annualYieldLb) || annualYieldLb <= 0) return null;
  return annualCents / (annualYieldLb / 100);
}

/**
 * Her carrying value on a date: replacement cost, less the annual charge for
 * the time she has been in production, floored at what she is worth going out.
 *
 * The floor is what makes this a value rather than a straight line to zero. A
 * cull cow is worth her cull cheque on the day she leaves, however long she
 * has been here. The same rule is implemented in `herd.mark_herd_values`, and
 * the two have to agree — the tests here are what keep them honest.
 */
export function carryingValueCents(
  a: Assumptions,
  enteredProduction: string | null,
  asOfIso: string,
): number | null {
  const annual = annualChargeCents(a);
  if (annual === null) return null;
  if (enteredProduction === null) return a.replacementCents;

  const years = daysBetween(enteredProduction, asOfIso) / DAYS_PER_YEAR;
  if (years <= 0) return a.replacementCents;
  return Math.max(a.cullCents, a.replacementCents - annual * years);
}

/**
 * When she entered production — the earlier of her first freshening and her
 * first calving.
 *
 * Two sources because either can be the one on file: a dairy cow's lactation
 * and her calving are the same day, but this herd was entered by hand and has
 * calvings with no lactation and lactations with no calving. The earlier of
 * the two starts her clock; null means she has not started.
 */
export function enteredProduction(
  freshDates: string[],
  calvingDates: string[],
  asOfIso: string,
): string | null {
  const dates = [...freshDates, ...calvingDates].filter((d) => d <= asOfIso).sort();
  return dates[0] ?? null;
}

/**
 * Is this animal one the roll speaks for?
 *
 * Dairy females in the string. Every figure in the assumptions is a dairy
 * figure — a springing heifer, a cull cow, a lifetime in lactations — so
 * marking a beef cow with them would be inventing a number rather than
 * measuring one. She can still be valued by hand. Mirrors the WHERE clause in
 * `herd.mark_herd_values`.
 */
export function isHerdInventory(a: RealAnimal): boolean {
  return (
    a.sex === "female" &&
    a.class !== "calf" &&
    a.status === "active" &&
    a.record_type !== "reference" &&
    (a.purpose === "dairy" || a.purpose === "dual")
  );
}

/** Milk logged in gallons, as pounds. */
export function gallonsToLb(gallons: number, lbPerGallon: number): number {
  return gallons * lbPerGallon;
}

/**
 * Her yield over the trailing year, in pounds, or null when there isn't
 * enough of a record to divide by.
 *
 * `minDays` is the honest part. A cow with one week of records would give a
 * $/cwt in the hundreds of dollars — arithmetically correct and completely
 * misleading — so below the threshold this returns null and the caller falls
 * back to the farm's expected yield, saying which one it used.
 */
export function trailingYieldLb(
  records: { produced_date: string; quantity: number; unit: string }[],
  asOfIso: string,
  lbPerGallon: number,
  minDays = 90,
): { lb: number; days: number } | null {
  const from = addDays(asOfIso, -DAYS_PER_YEAR);
  const inWindow = records.filter((r) => r.produced_date > from && r.produced_date <= asOfIso);
  if (inWindow.length === 0) return null;

  const dates = inWindow.map((r) => r.produced_date).sort();
  const days = daysBetween(dates[0], dates[dates.length - 1]) + 1;
  if (days < minDays) return null;

  const lb = inWindow.reduce(
    (sum, r) => sum + (r.unit === "gallon" ? gallonsToLb(Number(r.quantity), lbPerGallon) : Number(r.quantity)),
    0,
  );
  // Scale a partial year up to a year, so a cow with nine months of records
  // isn't compared against a herd assumption stated annually.
  return { lb: (lb / days) * DAYS_PER_YEAR, days };
}

// ─── dates ─────────────────────────────────────────────────────────────

/** Both are ISO days. Built at midnight local so a bare date doesn't shift a
 * day through UTC. */
function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`).getTime();
  const to = new Date(`${toIso}T00:00:00`).getTime();
  return Math.round((to - from) / 86400000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── reads and writes ──────────────────────────────────────────────────

const SETTING_KEYS = [
  "replacement_cost_cents",
  "cull_value_cents",
  "productive_lifetime_lactations",
  "expected_annual_yield_lb",
  "milk_lb_per_gallon",
] as const;

export async function fetchAssumptions(farmId: string): Promise<Assumptions> {
  const { data, error } = await herdSchema()
    .from("settings")
    .select("key, value")
    .eq("farm_id", farmId)
    .in("key", SETTING_KEYS as unknown as string[])
    .is("deleted_at", null);
  if (error) throw new Error(`herd.settings: ${error.message}`);

  const by = new Map((data ?? []).map((r: { key: string; value: unknown }) => [r.key, Number(r.value)]));
  const pick = (key: string, fallback: number) => {
    const v = by.get(key);
    return v === undefined || !Number.isFinite(v) ? fallback : v;
  };

  return {
    replacementCents: pick("replacement_cost_cents", DEFAULT_ASSUMPTIONS.replacementCents),
    cullCents: pick("cull_value_cents", DEFAULT_ASSUMPTIONS.cullCents),
    lifetimeLactations: pick("productive_lifetime_lactations", DEFAULT_ASSUMPTIONS.lifetimeLactations),
    expectedAnnualYieldLb: pick("expected_annual_yield_lb", DEFAULT_ASSUMPTIONS.expectedAnnualYieldLb),
    milkLbPerGallon: pick("milk_lb_per_gallon", DEFAULT_ASSUMPTIONS.milkLbPerGallon),
  };
}

export async function saveAssumptions(farmId: string, a: Assumptions): Promise<void> {
  const rows = [
    { key: "replacement_cost_cents", value: Math.round(a.replacementCents) },
    { key: "cull_value_cents", value: Math.round(a.cullCents) },
    { key: "productive_lifetime_lactations", value: a.lifetimeLactations },
    { key: "expected_annual_yield_lb", value: Math.round(a.expectedAnnualYieldLb) },
    { key: "milk_lb_per_gallon", value: a.milkLbPerGallon },
  ].map((r) => ({ ...r, farm_id: farmId }));

  const { error } = await herdSchema().from("settings").upsert(rows, { onConflict: "farm_id,key" });
  if (error) throw new Error(`herd.settings: ${error.message}`);
}

export interface Valuation {
  id: string;
  animalId: string;
  asOf: string;
  valueCents: number;
  basis: string;
  note: string;
}

export async function fetchValuations(farmId: string): Promise<Valuation[]> {
  const { data, error } = await herdSchema()
    .from("animal_valuations")
    .select("id, animal_id, as_of, value_cents, basis, note")
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("as_of", { ascending: false });
  if (error) throw new Error(`herd.animal_valuations: ${error.message}`);

  return ((data ?? []) as { id: string; animal_id: string; as_of: string; value_cents: number; basis: string; note: string }[]).map(
    (r) => ({
      id: r.id,
      animalId: r.animal_id,
      asOf: r.as_of,
      valueCents: Number(r.value_cents),
      basis: r.basis,
      note: r.note ?? "",
    }),
  );
}

/** The most recent value on or before a date, per animal. */
export function latestValuations(rows: Valuation[], asOfIso: string): Map<string, Valuation> {
  const latest = new Map<string, Valuation>();
  for (const r of rows) {
    if (r.asOf > asOfIso) continue;
    const held = latest.get(r.animalId);
    if (!held || r.asOf > held.asOf) latest.set(r.animalId, r);
  }
  return latest;
}

/** Roll the herd: write today's carrying value for every cow the model speaks
 * for. Returns how many rows were written. */
export async function markHerdValues(farmId: string, asOf: string): Promise<number> {
  const { data, error } = await herdSchema().rpc("mark_herd_values", { p_farm_id: farmId, p_as_of: asOf });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * A value somebody decided on, which the roll will not overwrite.
 *
 * An RPC rather than a PostgREST upsert: the unique index it conflicts on is
 * partial (`where deleted_at is null`), PostgREST emits no WHERE clause, and
 * Postgres can't infer a partial index without one. See migration 035.
 */
export async function recordValuation(input: {
  farmId: string;
  animalId: string;
  asOf: string;
  valueCents: number;
  basis: string;
  note: string;
}): Promise<void> {
  const { error } = await herdSchema().rpc("record_valuation", {
    p_farm_id: input.farmId,
    p_animal_id: input.animalId,
    p_as_of: input.asOf,
    p_value_cents: input.valueCents,
    p_basis: input.basis,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
}
