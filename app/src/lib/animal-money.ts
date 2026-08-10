import { herdSchema } from "./supabase";
import { REVENUE_CATEGORIES } from "./attribution";

/**
 * What an animal has cost and what she has brought in.
 *
 * Both tables already have rows — `attribute()` writes them from a ledger
 * transaction, `record_breeding` writes a straw's cost against the cow it was
 * used on, and an acquisition price typed on her record lands here too. Today
 * tallies them into "profit per head"; her own page never showed either.
 *
 * The one distinction worth carrying through: **basis is not an expense.**
 * `cost_entries.is_basis` marks what it cost to acquire the animal —
 * `expense_categories.basis_type = 'basis'`, which goes on no Schedule F
 * expense line at all — while everything else is money spent running her this
 * year. Netting a $700 purchase price against a season's milk would say she
 * lost money in the year she was bought and never again, which is an artifact
 * of the arithmetic rather than a fact about the cow. So: net is revenue minus
 * operating cost, and what she cost to buy is reported beside it, not inside
 * it.
 */

export type MoneyKind = "cost" | "revenue";

export interface MoneyEntry {
  id: string;
  kind: MoneyKind;
  date: string;
  amountCents: number;
  /** The expense category's label, or what kind of income it was. */
  label: string;
  note: string;
  /** How the row got here: 'manual' is somebody's decision, 'breeding' and
   * 'acquisition' were written by the app as a side effect of recording
   * something else. Worth showing — it's the difference between a figure you
   * typed and one that followed from a service. */
  source: string;
  isBasis: boolean;
  isInternalTransfer: boolean;
  /** Set when the row came from attributing a ledger transaction. */
  ledgerTransactionId: number | null;
}

export interface MoneySummary {
  revenueCents: number;
  /** Costs of running her — everything that isn't basis. */
  operatingCents: number;
  /** What she cost to acquire. Reported, never netted. */
  basisCents: number;
  /** revenue − operating. Basis is deliberately not in here. */
  netCents: number;
  entries: number;
}

const REVENUE_LABELS = new Map<string, string>(REVENUE_CATEGORIES.map((c) => [c.code, c.label]));

/**
 * Both tables for one animal, newest first.
 *
 * Three reads rather than an embed: nothing else in this app relies on
 * PostgREST's foreign-key embedding, and the category list is small enough
 * that joining it in JavaScript costs nothing. Categories are fetched without
 * the `active` filter `fetchExpenseCategories` applies — a category that has
 * since been retired still has to label the entries already written under it.
 */
export async function fetchAnimalMoney(animalId: string): Promise<MoneyEntry[]> {
  const [costs, revenues, categories] = await Promise.all([
    herdSchema()
      .from("cost_entries")
      .select("id, date, amount_cents, note, source, is_basis, is_internal_transfer, category_id, ledger_transaction_id")
      .eq("animal_id", animalId)
      .is("deleted_at", null),
    herdSchema()
      .from("revenue_entries")
      .select("id, date, amount_cents, note, source, category, is_internal_transfer, ledger_transaction_id")
      .eq("animal_id", animalId)
      .is("deleted_at", null),
    herdSchema().from("expense_categories").select("id, label"),
  ]);

  if (costs.error) throw new Error(`herd.cost_entries: ${costs.error.message}`);
  if (revenues.error) throw new Error(`herd.revenue_entries: ${revenues.error.message}`);
  if (categories.error) throw new Error(`herd.expense_categories: ${categories.error.message}`);

  const labelOf = new Map(((categories.data ?? []) as { id: string; label: string }[]).map((c) => [c.id, c.label]));

  type CostRow = {
    id: string;
    date: string;
    amount_cents: number;
    note: string;
    source: string;
    is_basis: boolean;
    is_internal_transfer: boolean;
    category_id: string;
    ledger_transaction_id: number | null;
  };
  type RevenueRow = {
    id: string;
    date: string;
    amount_cents: number;
    note: string;
    source: string;
    category: string;
    is_internal_transfer: boolean;
    ledger_transaction_id: number | null;
  };

  const rows: MoneyEntry[] = [
    ...((costs.data ?? []) as CostRow[]).map((r) => ({
      id: r.id,
      kind: "cost" as const,
      date: r.date,
      amountCents: Number(r.amount_cents),
      label: labelOf.get(r.category_id) ?? "Uncategorised",
      note: r.note ?? "",
      source: r.source,
      isBasis: r.is_basis,
      isInternalTransfer: r.is_internal_transfer,
      ledgerTransactionId: r.ledger_transaction_id === null ? null : Number(r.ledger_transaction_id),
    })),
    ...((revenues.data ?? []) as RevenueRow[]).map((r) => ({
      id: r.id,
      kind: "revenue" as const,
      date: r.date,
      amountCents: Number(r.amount_cents),
      label: REVENUE_LABELS.get(r.category) ?? r.category,
      note: r.note ?? "",
      source: r.source,
      isBasis: false,
      isInternalTransfer: r.is_internal_transfer,
      ledgerTransactionId: r.ledger_transaction_id === null ? null : Number(r.ledger_transaction_id),
    })),
  ];

  // Newest first, and a stable tiebreak so two entries on one day don't swap
  // places between renders.
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
}

/**
 * The three figures worth stating, plus the net of two of them.
 *
 * Internal transfers are left out of every total. The flag exists so that
 * moving value between animals — a dam's cost carried forward onto her calf,
 * which `cost_entries.source = 'dam_carryforward'` is for — doesn't count
 * twice when the herd is added up. Nothing writes one yet; the totals are
 * built to survive the day something does.
 */
export function summariseMoney(entries: MoneyEntry[]): MoneySummary {
  let revenueCents = 0;
  let operatingCents = 0;
  let basisCents = 0;

  for (const e of entries) {
    if (e.isInternalTransfer) continue;
    if (e.kind === "revenue") revenueCents += e.amountCents;
    else if (e.isBasis) basisCents += e.amountCents;
    else operatingCents += e.amountCents;
  }

  return {
    revenueCents,
    operatingCents,
    basisCents,
    netCents: revenueCents - operatingCents,
    entries: entries.length,
  };
}
