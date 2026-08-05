import { supabase } from "./supabase";

/**
 * Real-data access for Books. The ledger lives in the `public` schema and is
 * scoped by business, not by farm — see docs/books-herd-link.md.
 *
 * The mockup's "Attributed to" column isn't here: nothing links a ledger
 * transaction to an animal yet. That needs migration 002.
 */

export interface RealBusiness {
  id: number;
  name: string;
  type: string;
}

export interface RealLedgerAccount {
  id: number;
  name: string;
  opening_balance: number;
  business_id: number | null;
}

export interface RealTransaction {
  id: number;
  business_id: number;
  date: string;
  type: string;
  category: string;
  amount: number;
  note: string | null;
  payer: string;
  account: string;
}

export interface BooksData {
  businesses: RealBusiness[];
  accounts: RealLedgerAccount[];
  transactions: RealTransaction[];
  types: TransactionType[];
  /** False when public.transaction_types doesn't exist yet — migration 003
   * hasn't run, and FALLBACK_TYPES is standing in. */
  typesTableExists: boolean;
}

export async function fetchBooksData(): Promise<BooksData> {
  const [businessesRes, accountsRes, transactionsRes, typesRes] = await Promise.all([
    supabase.from("businesses").select("id, name, type").order("name"),
    supabase.from("ledger_accounts").select("id, name, opening_balance, business_id").order("name"),
    supabase
      .from("ledger_transactions")
      .select("id, business_id, date, type, category, amount, note, payer, account")
      .order("date", { ascending: false }),
    supabase.from("transaction_types").select("code, label, direction, active, sort_order").order("sort_order"),
  ]);

  for (const [label, res] of [
    ["businesses", businessesRes],
    ["ledger_accounts", accountsRes],
    ["ledger_transactions", transactionsRes],
  ] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  // A missing table is expected before migration 003; anything else isn't.
  const typesMissing = Boolean(typesRes.error);
  if (typesRes.error && !/does not exist|schema cache|not find the table/i.test(typesRes.error.message)) {
    throw new Error(`transaction_types: ${typesRes.error.message}`);
  }

  return {
    businesses: (businessesRes.data ?? []) as RealBusiness[],
    accounts: (accountsRes.data ?? []) as RealLedgerAccount[],
    transactions: (transactionsRes.data ?? []) as RealTransaction[],
    types: typesMissing ? FALLBACK_TYPES : ((typesRes.data ?? []) as TransactionType[]),
    typesTableExists: !typesMissing,
  };
}

export async function addTransactionType(input: {
  code: string;
  label: string;
  direction: Exclude<Direction, "unknown">;
}): Promise<TransactionType> {
  const { data, error } = await supabase
    .from("transaction_types")
    .insert({
      code: input.code.trim().toLowerCase(),
      label: input.label.trim(),
      direction: input.direction,
    })
    .select("code, label, direction, active, sort_order")
    .single();

  if (error) throw new Error(error.message);
  return data as TransactionType;
}

/**
 * How a transaction moves the books. `neutral` is a real answer, not a
 * failure — an account transfer is neither income nor expense and must stay
 * out of Net. `unknown` means the type isn't in the lookup table at all.
 */
export type Direction = "income" | "expense" | "neutral" | "unknown";

export interface TransactionType {
  code: string;
  label: string;
  direction: Exclude<Direction, "unknown">;
  active: boolean;
  sort_order: number;
}

/**
 * Fallback for before migration 003 creates public.transaction_types. Keeps
 * the app working against the current schema instead of erroring, and makes
 * the pre-migration state visible rather than silent.
 */
export const FALLBACK_TYPES: TransactionType[] = [
  { code: "income", label: "Income", direction: "income", active: true, sort_order: 10 },
  { code: "expense", label: "Expense", direction: "expense", active: true, sort_order: 20 },
];

export type TypeMap = Map<string, TransactionType>;

export function typeMap(types: TransactionType[]): TypeMap {
  return new Map(types.map((t) => [t.code, t]));
}

export function directionOf(t: RealTransaction, types: TypeMap): Direction {
  return types.get(t.type.trim())?.direction ?? "unknown";
}

export function summarise(transactions: RealTransaction[], types: TypeMap) {
  let income = 0;
  let expenses = 0;
  let neutral = 0;
  let unknown = 0;
  const unknownTypes = new Set<string>();

  for (const t of transactions) {
    const amount = Math.abs(Number(t.amount));
    switch (directionOf(t, types)) {
      case "income":
        income += amount;
        break;
      case "expense":
        expenses += amount;
        break;
      case "neutral":
        neutral += amount;
        break;
      default:
        unknown += amount;
        unknownTypes.add(t.type.trim() || "(blank)");
    }
  }

  return {
    income,
    expenses,
    net: income - expenses,
    neutral,
    unknown,
    unknownTypes: [...unknownTypes],
  };
}

export async function addTransaction(input: {
  businessId: number;
  date: string;
  type: string;
  category: string;
  amount: number;
  note: string | null;
  payer: string;
  account: string;
}): Promise<RealTransaction> {
  const { data, error } = await supabase
    .from("ledger_transactions")
    .insert({
      business_id: input.businessId,
      date: input.date,
      type: input.type,
      category: input.category,
      amount: input.amount,
      note: input.note,
      payer: input.payer,
      account: input.account,
    })
    .select("id, business_id, date, type, category, amount, note, payer, account")
    .single();

  if (error) throw new Error(error.message);
  return data as RealTransaction;
}
