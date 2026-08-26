import { directionOf, type Direction, type RealLedgerAccount, type RealTransaction, type TypeMap } from "./books-data";

/**
 * Turning the ledger into the two questions you actually ask it: where is
 * the money, and where did it go.
 *
 * All of it is pure. fetchBooksData already reads the rows; nothing here
 * touches the network, so the arithmetic is testable without a database.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How a transaction moves a balance: income adds, expense subtracts, and a
 * transfer moves nothing on its own — it's neutral by design, because the
 * ledger records one row for a movement between two accounts rather than a
 * matched pair. Counting it would double the money. */
export function signedAmount(t: RealTransaction, types: TypeMap): number {
  const amount = Math.abs(Number(t.amount));
  const direction: Direction = directionOf(t, types);
  if (direction === "income") return amount;
  if (direction === "expense") return -amount;
  return 0;
}

export interface AccountBalance {
  account: string;
  opening: number;
  movement: number;
  balance: number;
  entries: number;
  /** True when transactions name this account but no ledger_accounts row for
   * this business does. */
  unlisted: boolean;
}

/**
 * Balances per account, opening balance plus everything posted to it.
 *
 * Accounts are matched by name, because ledger_transactions.account is text
 * rather than a foreign key. That has a live consequence worth knowing: the
 * "Venmo" account row carries business_id null, so it isn't in any
 * business's account list, yet transactions post to it by name. Those would
 * vanish if this only walked the accounts table — so an account named only
 * by a transaction still gets a line, flagged `unlisted`, rather than its
 * money going missing.
 */
export function accountBalances(
  accounts: RealLedgerAccount[],
  transactions: RealTransaction[],
  types: TypeMap,
): AccountBalance[] {
  const rows = new Map<string, AccountBalance>();

  for (const a of accounts) {
    const name = a.name.trim();
    if (!name) continue;
    rows.set(name, {
      account: name,
      opening: round2(Number(a.opening_balance ?? 0)),
      movement: 0,
      balance: 0,
      entries: 0,
      unlisted: false,
    });
  }

  for (const t of transactions) {
    const name = t.account?.trim();
    if (!name) continue;
    const row =
      rows.get(name) ??
      ({ account: name, opening: 0, movement: 0, balance: 0, entries: 0, unlisted: true } satisfies AccountBalance);
    row.movement += signedAmount(t, types);
    row.entries += 1;
    rows.set(name, row);
  }

  return [...rows.values()]
    .map((r) => ({ ...r, movement: round2(r.movement), balance: round2(r.opening + r.movement) }))
    .sort((a, b) => b.balance - a.balance || a.account.localeCompare(b.account));
}

export interface CategoryTotal {
  category: string;
  direction: Direction;
  total: number;
  entries: number;
}

/**
 * Spend and income by category, biggest first within each direction.
 *
 * Categories are free text on the transaction, so they're grouped
 * case-insensitively but displayed as first written — "Feed" and "feed"
 * are one line, not two.
 */
export function byCategory(transactions: RealTransaction[], types: TypeMap): CategoryTotal[] {
  const rows = new Map<string, CategoryTotal>();

  for (const t of transactions) {
    const direction = directionOf(t, types);
    if (direction !== "income" && direction !== "expense") continue;

    const label = t.category?.trim() || "Uncategorised";
    const key = `${direction}:${label.toLowerCase()}`;
    const row = rows.get(key) ?? { category: label, direction, total: 0, entries: 0 };
    row.total += Math.abs(Number(t.amount));
    row.entries += 1;
    rows.set(key, row);
  }

  return [...rows.values()]
    .map((r) => ({ ...r, total: round2(r.total) }))
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === "income" ? -1 : 1;
      return b.total - a.total || a.category.localeCompare(b.category);
    });
}

export interface MonthTotal {
  /** "2026-07" */
  month: string;
  income: number;
  expenses: number;
  net: number;
  entries: number;
}

/**
 * A month-by-month series, oldest first, with no gaps.
 *
 * Empty months are filled in rather than skipped: a chart drawn from only
 * the months that have entries compresses a quiet summer into nothing and
 * makes the line lie about the shape of the year.
 */
export function byMonth(transactions: RealTransaction[], types: TypeMap): MonthTotal[] {
  if (transactions.length === 0) return [];

  const rows = new Map<string, MonthTotal>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    const row = rows.get(month) ?? { month, income: 0, expenses: 0, net: 0, entries: 0 };
    const direction = directionOf(t, types);
    const amount = Math.abs(Number(t.amount));
    if (direction === "income") row.income += amount;
    else if (direction === "expense") row.expenses += amount;
    row.entries += 1;
    rows.set(month, row);
  }

  const months = [...rows.keys()].sort();
  const filled: MonthTotal[] = [];
  for (const month of monthRange(months[0], months[months.length - 1])) {
    const row = rows.get(month) ?? { month, income: 0, expenses: 0, net: 0, entries: 0 };
    filled.push({ ...row, income: round2(row.income), expenses: round2(row.expenses), net: round2(row.income - row.expenses) });
  }
  return filled;
}

export interface CashMonth {
  /** "2026-07" */
  month: string;
  /** Cash in hand on the first of the month, before anything posted. */
  opening: number;
  received: number;
  /** Positive. What left, said as a quantity rather than a negative. */
  spent: number;
  net: number;
  /** Cash in hand at the end of the month. */
  closing: number;
  entries: number;
}

/**
 * Cash in hand, month by month: what it opened at, what moved, where it
 * closed.
 *
 * This is the question Reports does not answer. Reports totals income and
 * expenses by category and by month, which says what the business *earned
 * and spent* — it never says what is in the bank, or that a good month still
 * left you short because the previous three did not.
 *
 * ── The part that is easy to get wrong ──────────────────────────────────
 *
 * **A window has to carry the past forward.** Ask for the last three months
 * and the opening balance of the first of them is not the account's opening
 * balance — it is the opening balance plus every movement in all the months
 * before it. Starting a three-month view from the original opening balance
 * would show this farm opening June with $454.54 when it has been trading
 * since 2026, and every closing figure after it would inherit the error.
 *
 * So this takes **every** transaction the business has, and windows at the
 * end. `broughtForward` is what the window opens with, and is on the page
 * under that name rather than being folded silently into the first month.
 *
 * ── Transfers ───────────────────────────────────────────────────────────
 *
 * Neutral, via `signedAmount`, and correctly so for a total: moving money
 * between two of your own accounts does not change how much you have. It
 * does mean these figures are cash *across all accounts* and not per
 * account — the ledger records one row for a movement rather than a matched
 * pair, so which account received it is not recorded and a per-account
 * history would be a guess.
 */
export function cashFlow(input: {
  /** Every transaction for the business, not a windowed subset. */
  transactions: RealTransaction[];
  types: TypeMap;
  /** Cash held before the first transaction ever — the accounts' opening
   * balances added up. */
  openingCash: number;
  /** "YYYY-MM", inclusive. Omitted means from the first month with activity. */
  from?: string;
  /** "YYYY-MM", inclusive. Omitted means to the last month with activity. */
  to?: string;
}): { rows: CashMonth[]; broughtForward: number } {
  const { transactions, types, openingCash, from, to } = input;

  const moved = new Map<string, { received: number; spent: number; entries: number }>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    const row = moved.get(month) ?? { received: 0, spent: 0, entries: 0 };
    const signed = signedAmount(t, types);
    if (signed > 0) row.received += signed;
    else if (signed < 0) row.spent += -signed;
    row.entries += 1;
    moved.set(month, row);
  }

  const active = [...moved.keys()].sort();
  // No transactions at all: the business still holds whatever it opened
  // with, and saying so beats an empty page that reads like no money.
  if (active.length === 0) return { rows: [], broughtForward: round2(openingCash) };

  // A window never starts before the ledger does. "12 months" against a
  // ledger that opens in March would otherwise lead with six identical rows
  // holding the opening balance and saying nothing, pushing the months that
  // have something to say off the bottom of the screen.
  const requested = from ?? active[0];
  const first = requested < active[0] ? active[0] : requested;
  const last = to ?? active[active.length - 1];
  if (last < first) return { rows: [], broughtForward: round2(openingCash) };

  // Everything before the window, folded into the figure the window opens
  // with. Months are compared as strings, which sorts correctly because
  // they are zero-padded ISO.
  let carried = openingCash;
  for (const [month, row] of moved) {
    if (month < first) carried += row.received - row.spent;
  }
  const broughtForward = round2(carried);

  const rows: CashMonth[] = [];
  let running = broughtForward;
  for (const month of monthRange(first, last)) {
    const row = moved.get(month) ?? { received: 0, spent: 0, entries: 0 };
    const opening = round2(running);
    const received = round2(row.received);
    const spent = round2(row.spent);
    const closing = round2(opening + received - spent);
    rows.push({
      month,
      opening,
      received,
      spent,
      net: round2(received - spent),
      closing,
      entries: row.entries,
    });
    running = closing;
  }

  return { rows, broughtForward };
}

/** Every "YYYY-MM" from first to last inclusive. */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  // Guards against a malformed date producing an unbounded loop.
  for (let i = 0; i < 600 && (y < ly || (y === ly && m <= lm)); i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** "2026-07" -> "Jul 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return month;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1]} ${y}`;
}

/** Transactions in a closed date range, both ends inclusive. */
export function inRange(transactions: RealTransaction[], fromIso: string, toIso: string): RealTransaction[] {
  return transactions.filter((t) => t.date >= fromIso && t.date <= toIso);
}

/** The first day of the month `back` months before the one containing
 * `todayIso`. `monthsBack(today, 0)` is the current month's first day. */
export function monthsBack(todayIso: string, back: number): string {
  let y = Number(todayIso.slice(0, 4));
  let m = Number(todayIso.slice(5, 7)) - back;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * The account names that belong to a business.
 *
 * Two sources, deliberately. The obvious one is ledger_accounts rows scoped
 * to the business. The second is account names its own transactions already
 * use: `account` is free text, and the live "Venmo" row carries no
 * business_id at all, so an accounts-table-only list would leave you unable
 * to pick the account half your entries are already posted to.
 *
 * This exists because the entry form defaulted to `accounts[0]` across
 * *every* business — sorted by name, that was another business's chequing
 * account, pre-filled on a farm entry with nothing to say it was wrong.
 */
export function accountsForBusiness(
  accounts: RealLedgerAccount[],
  transactions: RealTransaction[],
  businessId: number | null,
): string[] {
  if (businessId === null) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const name = raw?.trim();
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    names.push(name);
  };

  // Listed accounts first, in name order, so the default is stable.
  for (const a of [...accounts].filter((a) => a.business_id === businessId).sort((x, y) => x.name.localeCompare(y.name))) {
    add(a.name);
  }
  for (const t of transactions.filter((t) => t.business_id === businessId)) add(t.account);

  return names;
}

/** What the entry form should start on: this business's first account, or
 * nothing rather than another business's. */
export const defaultAccountFor = (
  accounts: RealLedgerAccount[],
  transactions: RealTransaction[],
  businessId: number | null,
): string => accountsForBusiness(accounts, transactions, businessId)[0] ?? "";
