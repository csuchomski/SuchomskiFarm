import { herdSchema } from "./supabase";

/**
 * Breedings: which cow, which bull, and — when it was AI — which straw.
 *
 * herd.breeding_events already modelled all of this and had never been
 * written to. What was missing is the writing, and that lives in the
 * database rather than here, because recording an AI service is four
 * changes that have to happen together: the event, a −1 on the straw ledger,
 * a cost entry against the cow, and the link between the last two. See
 * docs/migrations/027-record-breeding.sql.
 *
 * Note what this file does *not* do: it never touches semen_lots.
 * straws_remaining is derived by a trigger from the sum of the transaction
 * ledger, so writing it by hand would hold until the next transaction and
 * then be silently overwritten.
 */

export type BreedingMethod = "ai" | "natural";

export const METHODS: { code: BreedingMethod; label: string; hint: string }[] = [
  { code: "ai", label: "AI straw", hint: "Draws the straw from the tank and books its cost against her." },
  { code: "natural", label: "Exposed to a bull", hint: "No straw. Add a fee below if the service cost anything." },
];

export interface Breeding {
  id: string;
  animal_id: string;
  date: string;
  service_number: number;
  method: string;
  technician: string;
  sire_id: string | null;
  semen_lot_id: string | null;
  semen_type: string;
  naab_code_snapshot: string;
  voided: boolean;
  void_reason: string;
  cost_entry_id: string | null;
  notes: string;
}

const COLUMNS =
  "id, animal_id, date, service_number, method, technician, sire_id, semen_lot_id, semen_type, naab_code_snapshot, voided, void_reason, cost_entry_id, notes";

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchBreedings(farmId: string): Promise<Breeding[]> {
  const { data, error } = await herdSchema()
    .from("breeding_events")
    .select(COLUMNS)
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("date", { ascending: false });
  if (error) throw new Error(`herd.breeding_events: ${error.message}`);
  return (data ?? []) as Breeding[];
}

/**
 * What each breeding cost, keyed by breeding id.
 *
 * Read from cost_entries by `source_ref_id` rather than by following
 * cost_entry_id one row at a time, and withdrawn entries are left out — a
 * voided breeding's cost is soft-deleted and shouldn't still show a figure.
 */
export async function fetchBreedingCosts(farmId: string): Promise<Map<string, number>> {
  const { data, error } = await herdSchema()
    .from("cost_entries")
    .select("source_ref_id, amount_cents")
    .eq("farm_id", farmId)
    .eq("source", "breeding")
    .is("deleted_at", null);
  if (error) throw new Error(`herd.cost_entries: ${error.message}`);

  const by = new Map<string, number>();
  for (const row of (data ?? []) as { source_ref_id: string | null; amount_cents: number }[]) {
    if (!row.source_ref_id) continue;
    by.set(row.source_ref_id, (by.get(row.source_ref_id) ?? 0) + Number(row.amount_cents) / 100);
  }
  return by;
}

// ─── validation ────────────────────────────────────────────────────────

export interface BreedingDraft {
  animalId: string;
  date: string;
  method: BreedingMethod;
  sireId: string;
  semenLotId: string;
  technician: string;
  notes: string;
  /** Dollars, as typed. Blank means "whatever the straw cost". */
  cost: string;
}

/**
 * Mirrors record_breeding's own guards, so a mistake is a sentence rather
 * than a plpgsql exception. The one it can't check here is whether the lot
 * still has a straw at the moment of writing — two people at one tank is the
 * database's problem, and it takes a row lock for it.
 */
export function validateBreeding(draft: BreedingDraft, strawsLeft?: number): string | null {
  if (!draft.animalId) return "Which cow or heifer?";
  if (!draft.date) return "When was she bred?";

  if (draft.method === "ai") {
    if (!draft.semenLotId) return "Which straw was used?";
    if (strawsLeft !== undefined && strawsLeft < 1) return "That lot has no straws left.";
  } else if (!draft.sireId) {
    return "Which bull was she exposed to?";
  }

  const raw = draft.cost.trim();
  if (raw !== "") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return "The cost has to be a number.";
    if (value < 0) return "A cost can't be negative.";
  }
  return null;
}

// ─── writes ────────────────────────────────────────────────────────────

export async function recordBreeding(draft: BreedingDraft): Promise<string> {
  const raw = draft.cost.trim();
  const { data, error } = await herdSchema().rpc("record_breeding", {
    p_animal_id: draft.animalId,
    p_date: draft.date,
    p_method: draft.method,
    p_sire_id: draft.method === "natural" ? draft.sireId : null,
    p_semen_lot_id: draft.method === "ai" ? draft.semenLotId : null,
    p_technician: draft.technician.trim(),
    p_notes: draft.notes.trim(),
    // Null, not zero: null means "use the straw's price", and zero means
    // "this cost nothing", which are different answers.
    p_cost_cents: raw === "" ? null : Math.round(Number(raw) * 100),
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Marks it voided, returns the straw to the tank and withdraws the cost. */
export async function voidBreeding(id: string, reason: string): Promise<void> {
  const { error } = await herdSchema().rpc("void_breeding", { p_id: id, p_reason: reason.trim() });
  if (error) throw new Error(error.message);
}

// ─── derived ───────────────────────────────────────────────────────────

/** "AI · 7HO12345" or "AI · Dutton" when the lot carries no NAAB code — the
 * live lot doesn't, and "AI · " reads like something is missing. */
export function sireLabel(b: Breeding, sireName: string | undefined): string {
  const who = b.naab_code_snapshot.trim() || sireName || "unknown bull";
  return b.method === "ai" ? `AI · ${who}` : `Bull · ${sireName ?? "unknown"}`;
}

export const isActive = (b: Breeding): boolean => !b.voided;

/** Services this season, counting only the ones that still stand. */
export function countServices(breedings: Breeding[], animalId: string): number {
  return breedings.filter((b) => b.animal_id === animalId && isActive(b)).length;
}
