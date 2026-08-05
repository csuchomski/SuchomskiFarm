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
}

export async function fetchBooksData(): Promise<BooksData> {
  const [businessesRes, accountsRes, transactionsRes] = await Promise.all([
    supabase.from("businesses").select("id, name, type").order("name"),
    supabase.from("ledger_accounts").select("id, name, opening_balance, business_id").order("name"),
    supabase
      .from("ledger_transactions")
      .select("id, business_id, date, type, category, amount, note, payer, account")
      .order("date", { ascending: false }),
  ]);

  for (const [label, res] of [
    ["businesses", businessesRes],
    ["ledger_accounts", accountsRes],
    ["ledger_transactions", transactionsRes],
  ] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  return {
    businesses: (businessesRes.data ?? []) as RealBusiness[],
    accounts: (accountsRes.data ?? []) as RealLedgerAccount[],
    transactions: (transactionsRes.data ?? []) as RealTransaction[],
  };
}

/**
 * `type` is free text in the schema rather than an enum, so rather than
 * trusting one spelling this treats anything that looks like income as
 * income and everything else as an expense — and exposes the raw value so
 * the UI can show what was actually stored.
 */
export function isIncome(t: RealTransaction): boolean {
  return /^(income|revenue|sale|deposit|credit)/i.test(t.type.trim());
}

export function summarise(transactions: RealTransaction[]) {
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    const amount = Math.abs(Number(t.amount));
    if (isIncome(t)) income += amount;
    else expenses += amount;
  }
  return { income, expenses, net: income - expenses };
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
