import { herdSchema } from "./supabase";

/**
 * Attributing a ledger transaction to the animals it was actually for.
 *
 * No migration was needed: 002 put `ledger_transaction_id` on
 * herd.cost_entries and herd.revenue_entries, with foreign keys, and it has
 * been sitting unused since. This is the thing that writes it.
 *
 * Three facts from the schema shape everything here:
 *
 * - money is `amount_cents bigint`, not dollars. Every conversion happens at
 *   the edge of this file so nothing downstream has to remember.
 * - an expense needs a `category_id` from herd.expense_categories; income
 *   needs a `category` from a fixed vocabulary the CHECK constraint owns.
 *   They are different columns on different tables, not one shared idea.
 * - there is no DELETE policy on either table, only select/insert/update.
 *   Un-attributing is `deleted_at = now()`, which is the mechanism the
 *   schema intends rather than a workaround.
 *
 * Attribution is deliberately allowed to be partial. A feed bill can be 80%
 * herd and 20% household, and forcing the parts to sum to the whole would
 * make the honest version of that impossible to record.
 */

export type EntryKind = "cost" | "revenue";

export interface Attribution {
  /** The cost_entries / revenue_entries row id. */
  id: string;
  kind: EntryKind;
  transactionId: number;
  animalId: string;
  /** Dollars. The column is cents. */
  amount: number;
}

export interface ExpenseCategory {
  id: string;
  code: string;
  label: string;
}

/** herd.revenue_entries.category is a CHECK, not a table — this list is that
 * constraint, and a value outside it is rejected by the database. */
export const REVENUE_CATEGORIES = [
  { code: "live_sale", label: "Live sale" },
  { code: "cull_proceeds", label: "Cull proceeds" },
  { code: "packaged_meat", label: "Packaged meat" },
  { code: "milk_attributed", label: "Milk" },
  { code: "breeding_fee", label: "Breeding fee" },
  { code: "embryo_semen_sale", label: "Embryo or semen sale" },
  { code: "other", label: "Other" },
] as const;

const toCents = (dollars: number): number => Math.round(dollars * 100);
const toDollars = (cents: number): number => Math.round(Number(cents)) / 100;

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  const { data, error } = await herdSchema()
    .from("expense_categories")
    .select("id, code, label")
    .is("deleted_at", null)
    .eq("active", true)
    .order("label");
  if (error) throw new Error(`herd.expense_categories: ${error.message}`);
  return (data ?? []) as ExpenseCategory[];
}

/**
 * Every attribution for the given transactions.
 *
 * Two queries because they're two tables — a transaction is income or
 * expense, so in practice only one of them ever has rows for a given id, but
 * nothing in the schema enforces that and quietly reading one would hide the
 * other.
 */
export async function fetchAttributions(transactionIds: number[]): Promise<Attribution[]> {
  if (transactionIds.length === 0) return [];

  const [costs, revenues] = await Promise.all([
    herdSchema()
      .from("cost_entries")
      .select("id, animal_id, amount_cents, ledger_transaction_id")
      .in("ledger_transaction_id", transactionIds)
      .is("deleted_at", null),
    herdSchema()
      .from("revenue_entries")
      .select("id, animal_id, amount_cents, ledger_transaction_id")
      .in("ledger_transaction_id", transactionIds)
      .is("deleted_at", null),
  ]);
  if (costs.error) throw new Error(`herd.cost_entries: ${costs.error.message}`);
  if (revenues.error) throw new Error(`herd.revenue_entries: ${revenues.error.message}`);

  type Row = { id: string; animal_id: string; amount_cents: number; ledger_transaction_id: number };
  const shape = (rows: Row[], kind: EntryKind): Attribution[] =>
    rows.map((r) => ({
      id: r.id,
      kind,
      transactionId: Number(r.ledger_transaction_id),
      animalId: r.animal_id,
      amount: toDollars(r.amount_cents),
    }));

  return [
    ...shape((costs.data ?? []) as Row[], "cost"),
    ...shape((revenues.data ?? []) as Row[], "revenue"),
  ];
}

export function byTransaction(rows: Attribution[]): Map<number, Attribution[]> {
  const by = new Map<number, Attribution[]>();
  for (const r of rows) {
    const list = by.get(r.transactionId);
    if (list) list.push(r);
    else by.set(r.transactionId, [r]);
  }
  return by;
}

// ─── splitting ─────────────────────────────────────────────────────────

/**
 * An even split that actually adds up.
 *
 * Done in cents and handed out one at a time, so $10 across three animals is
 * 3.34 / 3.33 / 3.33 rather than three of 3.33 and a missing penny. Same
 * reasoning as complete_pickup's proceeds split, which gives its remainder to
 * the largest contributor; here every part is equal, so the first ones take
 * it.
 */
export function splitEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const cents = toCents(total);
  const base = Math.floor(cents / parts);
  const remainder = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => toDollars(base + (i < remainder ? 1 : 0)));
}

// ─── validation ────────────────────────────────────────────────────────

export interface AttributionDraft {
  /** Absolute value of the transaction, in dollars. */
  total: number;
  direction: "income" | "expense";
  rows: { animalId: string; amount: string }[];
  /** herd.expense_categories.id — required for an expense. */
  categoryId: string;
  /** herd.revenue_entries.category — required for income. */
  revenueCategory: string;
}

export function validateAttribution(draft: AttributionDraft): string | null {
  const rows = draft.rows.filter((r) => r.animalId !== "");
  if (rows.length === 0) return "Pick at least one animal.";

  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.animalId)) return "The same animal is listed twice.";
    seen.add(r.animalId);
  }

  let sum = 0;
  for (const r of rows) {
    const raw = r.amount.trim();
    if (raw === "") return "Every animal needs an amount.";
    const value = Number(raw);
    if (!Number.isFinite(value)) return "Amounts have to be numbers.";
    if (value <= 0) return "An amount of zero isn't an attribution — remove the row instead.";
    sum += toCents(value);
  }

  // Partial is fine; more than the transaction is not.
  if (sum > toCents(draft.total)) {
    return `That comes to $${toDollars(sum).toFixed(2)}, which is more than the transaction's $${draft.total.toFixed(2)}.`;
  }

  if (draft.direction === "expense" && draft.categoryId === "") return "Pick an expense category.";
  if (draft.direction === "income" && draft.revenueCategory === "") return "Pick what kind of income this was.";
  return null;
}

/** What's left over, in dollars. Zero when it all adds up. */
export function unattributed(total: number, rows: { amount: string }[]): number {
  const sum = rows.reduce((s, r) => {
    const v = Number(r.amount.trim());
    return Number.isFinite(v) && v > 0 ? s + toCents(v) : s;
  }, 0);
  return toDollars(Math.max(0, toCents(total) - sum));
}

// ─── writes ────────────────────────────────────────────────────────────

export async function attribute(input: {
  transactionId: number;
  farmId: string;
  date: string;
  direction: "income" | "expense";
  note: string;
  categoryId: string;
  revenueCategory: string;
  rows: { animalId: string; amount: string }[];
}): Promise<void> {
  const rows = input.rows.filter((r) => r.animalId !== "" && r.amount.trim() !== "");
  if (rows.length === 0) return;

  if (input.direction === "expense") {
    const { error } = await herdSchema()
      .from("cost_entries")
      .insert(
        rows.map((r) => ({
          farm_id: input.farmId,
          animal_id: r.animalId,
          date: input.date,
          amount_cents: toCents(Number(r.amount)),
          category_id: input.categoryId,
          ledger_transaction_id: input.transactionId,
          // 'manual' is honest and it's what the CHECK allows — somebody
          // decided this bill was for these animals. The ledger link is what
          // distinguishes these from an entry typed on the animal's page.
          source: "manual",
          note: input.note,
        })),
      );
    if (error) throw new Error(`herd.cost_entries: ${error.message}`);
    return;
  }

  const { error } = await herdSchema()
    .from("revenue_entries")
    .insert(
      rows.map((r) => ({
        farm_id: input.farmId,
        animal_id: r.animalId,
        date: input.date,
        amount_cents: toCents(Number(r.amount)),
        category: input.revenueCategory,
        ledger_transaction_id: input.transactionId,
        source: "manual",
        note: input.note,
      })),
    );
  if (error) throw new Error(`herd.revenue_entries: ${error.message}`);
}

/**
 * Take an attribution back off.
 *
 * A soft delete, because there is no DELETE policy on either table — and
 * because a per-animal cost that has already been counted into a margin is
 * better marked withdrawn than made never to have existed.
 */
export async function unattribute(row: Attribution): Promise<void> {
  const table = row.kind === "cost" ? "cost_entries" : "revenue_entries";
  const { error } = await herdSchema()
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw new Error(`herd.${table}: ${error.message}`);
}
