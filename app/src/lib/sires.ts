import { herdSchema } from "./supabase";
import type { RealAnimal } from "./herd";

/**
 * Sires and the semen in the tank.
 *
 * A sire is an `animals` row like any other, which is what lets the existing
 * pedigree chart resolve him without knowing anything about this file. The
 * distinction is `record_type`: a bull you own is 'herd', an AI bull you've
 * only ever bought straws from is 'reference'. Both can be a calf's sire;
 * only the first is part of the herd you feed, count and milk.
 *
 * Straw counts are not written directly. herd.semen_transactions has a
 * trigger (recount_semen_lot) that sets straws_remaining to the sum of every
 * delta on the lot, so the ledger is the truth and the count is derived.
 * Writing straws_remaining by hand would hold until the next transaction and
 * then be silently overwritten — which is the worst kind of wrong.
 */

export type UnitType = "conventional" | "sexed_female" | "sexed_male";
export type TxReason = "purchase" | "service" | "service_void" | "discarded" | "sold" | "inventory_count_adjustment";

export const UNIT_TYPES: { code: UnitType; label: string }[] = [
  { code: "conventional", label: "Conventional" },
  { code: "sexed_female", label: "Sexed — female" },
  { code: "sexed_male", label: "Sexed — male" },
];

/** Reasons a straw leaves the tank, as offered in the UI. `purchase` is
 * absent because straws arrive by adding a lot, and the two draw-down
 * reasons the schema also allows (`service_void`, adjustments) are handled
 * by their own controls. */
export const DRAW_REASONS: { code: TxReason; label: string }[] = [
  { code: "service", label: "Bred a cow" },
  { code: "discarded", label: "Discarded" },
  { code: "sold", label: "Sold" },
];

export interface SemenLot {
  id: string;
  sire_id: string;
  naab_code: string;
  unit_type: UnitType;
  lot_code: string;
  tank: string;
  canister: string;
  cane: string;
  straws_initial: number;
  straws_remaining: number;
  cost_per_straw_cents: number;
  purchase_date: string | null;
  supplier: string;
  reorder_threshold: number;
  active: boolean;
  notes: string;
}

export interface SemenTransaction {
  id: string;
  semen_lot_id: string;
  date: string;
  delta: number;
  reason: TxReason;
  note: string;
}

// One string literal rather than a concatenation: PostgREST's types are
// inferred from the literal, and splitting it across a `+` widens it to
// `string`, which makes every row come back as GenericStringError.
const LOT_COLUMNS =
  "id, sire_id, naab_code, unit_type, lot_code, tank, canister, cane, straws_initial, straws_remaining, cost_per_straw_cents, purchase_date, supplier, reorder_threshold, active, notes";

const TX_COLUMNS = "id, semen_lot_id, date, delta, reason, note";

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchSemenLots(farmId: string): Promise<SemenLot[]> {
  const { data, error } = await herdSchema()
    .from("semen_lots")
    .select(LOT_COLUMNS)
    .eq("farm_id", farmId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`herd.semen_lots: ${error.message}`);
  return (data ?? []) as SemenLot[];
}

export async function fetchSemenTransactions(lotIds: string[]): Promise<SemenTransaction[]> {
  if (lotIds.length === 0) return [];
  const { data, error } = await herdSchema()
    .from("semen_transactions")
    .select(TX_COLUMNS)
    .in("semen_lot_id", lotIds)
    .is("deleted_at", null)
    .order("date", { ascending: false });
  if (error) throw new Error(`herd.semen_transactions: ${error.message}`);
  return (data ?? []) as SemenTransaction[];
}

// ─── derived ───────────────────────────────────────────────────────────

export type LotStatus = "empty" | "low" | "ok";

/**
 * Whether a lot needs attention. `low` is at or below the reorder threshold,
 * which is only meaningful when a threshold has been set — a lot left at the
 * default 0 would otherwise read "low" for its whole life, and then never
 * again once it hit zero and became "empty".
 */
export function lotStatus(lot: Pick<SemenLot, "straws_remaining" | "reorder_threshold">): LotStatus {
  if (lot.straws_remaining <= 0) return "empty";
  if (lot.reorder_threshold > 0 && lot.straws_remaining <= lot.reorder_threshold) return "low";
  return "ok";
}

/** Where to physically find it: "Tank A · can 3 · cane 7", skipping the
 * parts that haven't been recorded. */
export function tankLocation(lot: Pick<SemenLot, "tank" | "canister" | "cane">): string | null {
  const parts = [
    lot.tank && `Tank ${lot.tank}`,
    lot.canister && `can ${lot.canister}`,
    lot.cane && `cane ${lot.cane}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** What's still in the tank is worth money; what's been used is a sunk
 * cost. Only the remaining straws count. */
export function inventoryValueCents(lots: Pick<SemenLot, "straws_remaining" | "cost_per_straw_cents">[]): number {
  return lots.reduce((sum, l) => sum + Math.max(0, l.straws_remaining) * l.cost_per_straw_cents, 0);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface SireStock {
  sireId: string;
  straws: number;
  lots: number;
  valueCents: number;
}

/** Straws on hand per sire, most-stocked first — the view you want when
 * deciding who to breed to. */
export function stockBySire(lots: SemenLot[]): SireStock[] {
  const by = new Map<string, SireStock>();
  for (const lot of lots) {
    const row = by.get(lot.sire_id) ?? { sireId: lot.sire_id, straws: 0, lots: 0, valueCents: 0 };
    row.straws += Math.max(0, lot.straws_remaining);
    row.lots += 1;
    row.valueCents += Math.max(0, lot.straws_remaining) * lot.cost_per_straw_cents;
    by.set(lot.sire_id, row);
  }
  return [...by.values()].sort((a, b) => b.straws - a.straws || a.sireId.localeCompare(b.sireId));
}

// ─── validation ────────────────────────────────────────────────────────

export interface LotDraft {
  sireId: string;
  naabCode: string;
  unitType: UnitType;
  lotCode: string;
  tank: string;
  canister: string;
  cane: string;
  straws: string;
  costPerStraw: string;
  purchaseDate: string;
  supplier: string;
  reorderThreshold: string;
}

export function validateLot(draft: LotDraft, todayIso: string): string | null {
  if (!draft.sireId) return "Pick which sire this semen is from.";

  const straws = Number(draft.straws);
  if (draft.straws.trim() === "" || !Number.isFinite(straws)) return "How many straws? Enter a number.";
  if (!Number.isInteger(straws)) return "Straws come whole — no fractions.";
  if (straws <= 0) return "A lot needs at least one straw.";

  if (draft.costPerStraw.trim() !== "") {
    const cost = Number(draft.costPerStraw);
    if (!Number.isFinite(cost) || cost < 0) return "Cost per straw has to be a number, and not negative.";
  }

  if (draft.reorderThreshold.trim() !== "") {
    const t = Number(draft.reorderThreshold);
    if (!Number.isFinite(t) || t < 0) return "The reorder point has to be zero or more.";
    if (t > straws) return "The reorder point is higher than the lot itself.";
  }

  if (draft.purchaseDate && draft.purchaseDate > todayIso) return "That purchase date is in the future.";

  return null;
}

export function validateDraw(lot: Pick<SemenLot, "straws_remaining">, count: number): string | null {
  if (!Number.isFinite(count) || !Number.isInteger(count)) return "Straws come whole — no fractions.";
  if (count <= 0) return "Enter how many straws to take out.";
  if (count > lot.straws_remaining) {
    return `Only ${lot.straws_remaining} straw${lot.straws_remaining === 1 ? "" : "s"} left in this lot.`;
  }
  return null;
}

// ─── writes ────────────────────────────────────────────────────────────

/** Dollars as typed to whole cents, without the floating-point drift of
 * `Math.round(Number(x) * 100)` on values like 19.99. */
const toCents = (dollars: string): number => {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

/**
 * Adds a lot and the purchase that filled it, in that order.
 *
 * The purchase transaction isn't bookkeeping for its own sake: the recount
 * trigger derives straws_remaining from the sum of transactions, so a lot
 * created without one reads as full until the first straw is drawn and then
 * jumps to -1. The ledger has to start with the straws going in.
 */
export async function createSemenLot(farmId: string, draft: LotDraft): Promise<SemenLot> {
  const straws = Number(draft.straws);

  const { data, error } = await herdSchema()
    .from("semen_lots")
    .insert({
      farm_id: farmId,
      sire_id: draft.sireId,
      naab_code: draft.naabCode.trim(),
      unit_type: draft.unitType,
      lot_code: draft.lotCode.trim(),
      tank: draft.tank.trim(),
      canister: draft.canister.trim(),
      cane: draft.cane.trim(),
      straws_initial: straws,
      straws_remaining: straws,
      cost_per_straw_cents: toCents(draft.costPerStraw),
      purchase_date: draft.purchaseDate || null,
      supplier: draft.supplier.trim(),
      reorder_threshold: draft.reorderThreshold.trim() === "" ? 0 : Number(draft.reorderThreshold),
    })
    .select(LOT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  const lot = data as SemenLot;

  const tx = await herdSchema().from("semen_transactions").insert({
    farm_id: farmId,
    semen_lot_id: lot.id,
    delta: straws,
    reason: "purchase",
    date: draft.purchaseDate || new Date().toISOString().slice(0, 10),
    note: "Lot added",
  });
  if (tx.error) throw new Error(`Lot saved, but the straws didn't register: ${tx.error.message}`);

  return { ...lot, straws_remaining: straws };
}

/** Takes straws out of a lot. Returns the lot's new remaining count, read
 * back after the trigger has recounted rather than assumed. */
export async function drawStraws(
  farmId: string,
  lot: SemenLot,
  count: number,
  reason: TxReason,
  note = "",
): Promise<number> {
  const problem = validateDraw(lot, count);
  if (problem) throw new Error(problem);

  const { error } = await herdSchema().from("semen_transactions").insert({
    farm_id: farmId,
    semen_lot_id: lot.id,
    delta: -count,
    reason,
    date: new Date().toISOString().slice(0, 10),
    note: note.trim(),
  });
  if (error) throw new Error(error.message);

  const { data, error: readError } = await herdSchema()
    .from("semen_lots")
    .select("straws_remaining")
    .eq("id", lot.id)
    .single();
  if (readError) throw new Error(readError.message);
  return (data as { straws_remaining: number }).straws_remaining;
}

/** Retires a lot without deleting its history — an empty cane you've thrown
 * out shouldn't keep showing up, but the straws it bred are still recorded. */
export async function setLotActive(id: string, active: boolean): Promise<void> {
  const { error } = await herdSchema()
    .from("semen_lots")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export interface SireDraft {
  barnName: string;
  earTag: string;
  naabCode: string;
  registrationNumber: string;
  birthDate: string;
  notes: string;
  /**
   * dairy | beef | dual. Only asked for when editing; a new AI bull defaults
   * to dairy, which is what this herd buys. It matters because it is the
   * gestation fallback for any calf of his whose breeds aren't on file, and
   * because a beef bull recorded as dairy reads as a mistake to anyone
   * scanning the list.
   */
  purpose?: string;
}

export function validateSire(draft: SireDraft, todayIso: string): string | null {
  if (!draft.barnName.trim() && !draft.earTag.trim()) return "Give the bull a name or a tag.";
  if (!draft.birthDate) return "A birth date is required — the schema won't take a row without one.";
  if (draft.birthDate > todayIso) return "That birth date is in the future.";
  return null;
}

/**
 * An AI bull you'll never own: a `reference` animal row.
 *
 * origin is 'purchased' because the schema's origin vocabulary has no
 * "never here" option and the column is NOT NULL — record_type is what
 * actually carries the distinction, and it's the column every list filters
 * on. purpose is 'dairy' for the same reason: required, and this herd's
 * bulls are bought for milk.
 */
export async function createReferenceSire(farmId: string, draft: SireDraft): Promise<RealAnimal> {
  const { data, error } = await herdSchema()
    .from("animals")
    .insert({
      farm_id: farmId,
      barn_name: draft.barnName.trim(),
      ear_tag: draft.earTag.trim(),
      registration_number: draft.registrationNumber.trim(),
      birth_date: draft.birthDate,
      notes: draft.notes.trim(),
      sex: "male",
      class: "bull",
      purpose: "dairy",
      origin: "purchased",
      record_type: "reference",
      class_is_manual: true,
    })
    .select(
      "id, ear_tag, barn_name, sex, class, status, birth_date, sire_id, dam_id, notes, purpose, origin, record_type",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as RealAnimal;
}

/**
 * Correct a bull's details.
 *
 * Only the columns a person could get wrong when adding him — never sex,
 * class or record_type. Turning a reference bull into a resident one is a
 * different decision with different consequences (he'd start appearing in
 * herd counts), and it is not this form's job to make it by accident.
 */
export const SIRE_PURPOSES = ["dairy", "beef", "dual"] as const;

export async function updateSire(id: string, draft: SireDraft): Promise<RealAnimal> {
  const { data, error } = await herdSchema()
    .from("animals")
    .update({
      barn_name: draft.barnName.trim(),
      ear_tag: draft.earTag.trim(),
      registration_number: draft.registrationNumber.trim(),
      birth_date: draft.birthDate,
      notes: draft.notes.trim(),
      ...(draft.purpose ? { purpose: draft.purpose } : {}),
    })
    .eq("id", id)
    .select(
      "id, ear_tag, barn_name, sex, class, status, birth_date, sire_id, dam_id, notes, purpose, origin, record_type",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as RealAnimal;
}

/**
 * His details, in the shape the form edits.
 *
 * Read fresh rather than built from the list, because `registration_number`
 * is not among the columns fetchAnimals selects — a form filled from the list
 * would show it blank and then write that blank back over a real number.
 */
export async function fetchSireDraft(id: string): Promise<SireDraft> {
  const { data, error } = await herdSchema()
    .from("animals")
    .select("barn_name, ear_tag, registration_number, birth_date, notes, purpose")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);

  const a = data as {
    barn_name: string | null;
    ear_tag: string | null;
    registration_number: string | null;
    birth_date: string;
    notes: string | null;
    purpose: string;
  };
  return {
    barnName: a.barn_name ?? "",
    earTag: a.ear_tag ?? "",
    naabCode: "",
    registrationNumber: a.registration_number ?? "",
    birthDate: a.birth_date,
    notes: a.notes ?? "",
    purpose: a.purpose,
  };
}

/** Every animal that could be a sire: males, whether they live here or are
 * only a name on a straw. */
export const siresIn = (herd: RealAnimal[]): RealAnimal[] =>
  herd.filter((a) => a.sex === "male").sort((a, b) => sireName(a).localeCompare(sireName(b)));

export const sireName = (a: RealAnimal): string => a.barn_name || (a.ear_tag ? `Tag ${a.ear_tag}` : "Unnamed bull");
