import { supabase } from "./supabase";
import { directionOf, type Direction, type RealTransaction, type TypeMap } from "./books-data";

/**
 * Filing: which schedule a business files, what lands on each line of it,
 * and what the balance sheet says at year end.
 *
 * This records where a total goes. It does not compute anyone's tax — there
 * is no depreciation engine here, no self-employment tax, no basis tracking.
 * "Depreciation & section 179" is a category you enter the figure into, the
 * way an accountant hands it to you. Anything this file cannot place is
 * surfaced as unmapped rather than quietly dropped, because a schedule that
 * silently loses money is worse than one that admits it.
 */

// ─── schedules and categories ──────────────────────────────────────────

export interface BusinessTypeSchedule {
  code: string;
  label: string;
  schedule_code: string;
  schedule_label: string;
}

export interface TaxCategory {
  id: number;
  business_type: string;
  direction: "income" | "expense";
  label: string;
  schedule_line: string;
  sort_order: number;
}

export async function fetchBusinessTypes(): Promise<BusinessTypeSchedule[]> {
  const { data, error } = await supabase
    .from("business_types")
    .select("code, label, schedule_code, schedule_label")
    .order("sort_order");
  if (error) throw new Error(`business_types: ${error.message}`);
  return (data ?? []) as BusinessTypeSchedule[];
}

export async function fetchTaxCategories(): Promise<TaxCategory[]> {
  const { data, error } = await supabase
    .from("tax_categories")
    .select("id, business_type, direction, label, schedule_line, sort_order")
    .eq("active", true)
    .order("sort_order");
  if (error) throw new Error(`tax_categories: ${error.message}`);
  return (data ?? []) as TaxCategory[];
}

export async function addTaxCategory(input: {
  businessType: string;
  direction: "income" | "expense";
  label: string;
  scheduleLine: string;
}): Promise<TaxCategory> {
  const { data, error } = await supabase
    .from("tax_categories")
    .insert({
      business_type: input.businessType,
      direction: input.direction,
      label: input.label.trim(),
      schedule_line: input.scheduleLine.trim(),
      // Past the seeded block, so a new category sorts to the end of its
      // section rather than landing in the middle of the IRS ordering.
      sort_order: 900,
    })
    .select("id, business_type, direction, label, schedule_line, sort_order")
    .single();
  if (error) throw new Error(error.message);
  return data as TaxCategory;
}

/** The categories a business of this type can post against, in schedule
 * order. */
export function categoriesFor(
  categories: TaxCategory[],
  businessType: string,
  direction: "income" | "expense",
): TaxCategory[] {
  return categories
    .filter((c) => c.business_type === businessType && c.direction === direction)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

// ─── building a schedule ───────────────────────────────────────────────

export interface ScheduleLine {
  line: string;
  label: string;
  total: number;
  entries: number;
}

export interface UnmappedCategory {
  category: string;
  direction: Direction;
  total: number;
  entries: number;
}

export interface TaxSchedule {
  scheduleCode: string;
  scheduleLabel: string;
  year: string;
  income: ScheduleLine[];
  expenses: ScheduleLine[];
  incomeTotal: number;
  expenseTotal: number;
  net: number;
  /** Money that couldn't be placed on a line. Counted in the totals above —
   * it is real income and real expense — but listed so it can be recategorised
   * before anything is filed. */
  unmapped: UnmappedCategory[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every line of the schedule, including the ones that are zero.
 *
 * Zero lines are kept deliberately: a filing schedule is a form, and reading
 * it against the paper form means finding line 16 whether or not you bought
 * feed this year. Reports is the screen that hides empty rows; this one is
 * the form.
 */
export function buildSchedule(input: {
  businessType: BusinessTypeSchedule | undefined;
  categories: TaxCategory[];
  transactions: RealTransaction[];
  types: TypeMap;
  year: string;
}): TaxSchedule {
  const { businessType, categories, transactions, types, year } = input;
  const typeCode = businessType?.code ?? "";

  const lineFor = (direction: "income" | "expense") => {
    const defs = categoriesFor(categories, typeCode, direction);
    const byLabel = new Map(defs.map((d) => [d.label.toLowerCase(), d]));
    const totals = new Map<string, ScheduleLine>();
    for (const d of defs) {
      // Several categories can share a line (Schedule C puts gross receipts
      // and commissions both on line 1), so they're pooled by line and label.
      const key = `${d.schedule_line}|${d.label}`;
      totals.set(key, { line: d.schedule_line, label: d.label, total: 0, entries: 0 });
    }
    return { defs, byLabel, totals };
  };

  const income = lineFor("income");
  const expense = lineFor("expense");
  const unmapped = new Map<string, UnmappedCategory>();

  let incomeTotal = 0;
  let expenseTotal = 0;

  for (const t of transactions) {
    const direction = directionOf(t, types);
    // A transfer moves money between accounts and belongs on no schedule
    // line; an unknown type isn't income or expense either.
    if (direction !== "income" && direction !== "expense") continue;

    const amount = Math.abs(Number(t.amount));
    if (direction === "income") incomeTotal += amount;
    else expenseTotal += amount;

    const side = direction === "income" ? income : expense;
    const label = t.category?.trim() ?? "";
    const def = side.byLabel.get(label.toLowerCase());

    if (!def) {
      const key = `${direction}:${label.toLowerCase()}`;
      const row = unmapped.get(key) ?? {
        category: label || "(blank)",
        direction,
        total: 0,
        entries: 0,
      };
      row.total += amount;
      row.entries += 1;
      unmapped.set(key, row);
      continue;
    }

    const key = `${def.schedule_line}|${def.label}`;
    const line = side.totals.get(key);
    if (line) {
      line.total += amount;
      line.entries += 1;
    }
  }

  const finish = (side: ReturnType<typeof lineFor>) =>
    [...side.totals.values()]
      .map((l) => ({ ...l, total: round2(l.total) }))
      .sort((a, b) => compareLines(a.line, b.line) || a.label.localeCompare(b.label));

  return {
    scheduleCode: businessType?.schedule_code || "—",
    scheduleLabel: businessType?.schedule_label || "No schedule recorded for this business type",
    year,
    income: finish(income),
    expenses: finish(expense),
    incomeTotal: round2(incomeTotal),
    expenseTotal: round2(expenseTotal),
    net: round2(incomeTotal - expenseTotal),
    unmapped: [...unmapped.values()]
      .map((u) => ({ ...u, total: round2(u.total) }))
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
  };
}

/** "21a" sorts after "21" and before "22" — numeric part first, then the
 * letter, so the form reads in order rather than alphabetically. */
export function compareLines(a: string, b: string): number {
  const parse = (s: string): [number, string] => {
    const m = /^(\d+)(.*)$/.exec(s.trim());
    return m ? [Number(m[1]), m[2]] : [Number.MAX_SAFE_INTEGER, s];
  };
  const [na, sa] = parse(a);
  const [nb, sb] = parse(b);
  return na - nb || sa.localeCompare(sb);
}

// ─── the year ──────────────────────────────────────────────────────────

/** Calendar year, which is what a Schedule F is filed on. */
export const yearStart = (year: string) => `${year}-01-01`;
export const yearEnd = (year: string) => `${year}-12-31`;

/** Years with at least one entry, newest first, always including the current
 * one so a fresh year is selectable before anything is posted to it. */
export function yearsWithActivity(transactions: RealTransaction[], todayIso: string): string[] {
  const years = new Set(transactions.map((t) => t.date.slice(0, 4)));
  years.add(todayIso.slice(0, 4));
  return [...years].sort().reverse();
}

// ─── balance sheet ─────────────────────────────────────────────────────

export type AssetKind = "asset" | "liability";

export interface LedgerAsset {
  id: number;
  business_id: number;
  kind: AssetKind;
  name: string;
  value: number;
}

export async function fetchAssets(businessId: number): Promise<LedgerAsset[]> {
  const { data, error } = await supabase
    .from("ledger_assets")
    .select("id, business_id, kind, name, value")
    .eq("business_id", businessId)
    .order("kind")
    .order("name");
  if (error) throw new Error(`ledger_assets: ${error.message}`);
  return (data ?? []) as LedgerAsset[];
}

export async function addAsset(input: {
  businessId: number;
  kind: AssetKind;
  name: string;
  value: number;
}): Promise<LedgerAsset> {
  const { data, error } = await supabase
    .from("ledger_assets")
    .insert({ business_id: input.businessId, kind: input.kind, name: input.name.trim(), value: input.value })
    .select("id, business_id, kind, name, value")
    .single();
  if (error) throw new Error(error.message);
  return data as LedgerAsset;
}

export async function updateAsset(id: number, patch: { name: string; value: number }): Promise<LedgerAsset> {
  const { data, error } = await supabase
    .from("ledger_assets")
    .update({ name: patch.name.trim(), value: patch.value })
    .eq("id", id)
    .select("id, business_id, kind, name, value")
    .single();
  if (error) throw new Error(error.message);
  return data as LedgerAsset;
}

export async function deleteAsset(id: number): Promise<void> {
  const { error } = await supabase.from("ledger_assets").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * The value column is `numeric not null check (value >= 0)`, so a liability
 * is stored as a positive number and subtracted here rather than entered
 * negative. Entering -5000 fails at the database with a constraint error, so
 * it's caught first with a sentence.
 */
export function validateAsset(input: { name: string; value: string }): string | null {
  if (!input.name.trim()) return "Give it a name.";
  const raw = input.value.trim();
  if (raw === "") return "What's it worth?";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "The value has to be a number.";
  if (value < 0) return "Enter a liability as a positive amount — it's subtracted for you.";
  return null;
}

export interface BalanceSheet {
  cash: { account: string; balance: number }[];
  cashTotal: number;
  otherAssets: LedgerAsset[];
  assetTotal: number;
  liabilities: LedgerAsset[];
  liabilityTotal: number;
  equity: number;
}

/**
 * Assets are cash-at-bank plus whatever's recorded by hand; equity is what's
 * left after liabilities.
 *
 * Cash comes from the account balances rather than from a hand-entered
 * asset, so it can't drift from the ledger. An asset row whose name matches
 * an account is dropped for the same reason — recording "Landmark CU" by
 * hand as well would count that money twice.
 */
export function buildBalanceSheet(
  accountBalances: { account: string; balance: number }[],
  assets: LedgerAsset[],
): BalanceSheet {
  const accountNames = new Set(accountBalances.map((a) => a.account.trim().toLowerCase()));

  const cashTotal = accountBalances.reduce((s, a) => s + a.balance, 0);
  const otherAssets = assets.filter(
    (a) => a.kind === "asset" && !accountNames.has(a.name.trim().toLowerCase()),
  );
  const liabilities = assets.filter((a) => a.kind === "liability");

  const otherTotal = otherAssets.reduce((s, a) => s + Number(a.value), 0);
  const liabilityTotal = liabilities.reduce((s, a) => s + Number(a.value), 0);
  const assetTotal = cashTotal + otherTotal;

  return {
    cash: accountBalances,
    cashTotal: round2(cashTotal),
    otherAssets,
    assetTotal: round2(assetTotal),
    liabilities,
    liabilityTotal: round2(liabilityTotal),
    equity: round2(assetTotal - liabilityTotal),
  };
}

// ─── export ────────────────────────────────────────────────────────────

/**
 * RFC 4180 quoting. Every field is quoted rather than only the ones that
 * need it: a category like "Rent/lease — machinery, equipment" would
 * otherwise split into two columns, and a payer with a quote in the name
 * would corrupt the rest of the row.
 */
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export const csvRow = (cells: (string | number | null | undefined)[]): string => cells.map(csvCell).join(",");

/** One row per schedule line, which is what an accountant or tax software
 * wants — the totals, in form order, with the line numbers. */
export function scheduleCsv(schedule: TaxSchedule, businessName: string): string {
  const lines: string[] = [];
  lines.push(csvRow(["Business", businessName]));
  lines.push(csvRow(["Schedule", schedule.scheduleLabel]));
  lines.push(csvRow(["Year", schedule.year]));
  lines.push("");
  lines.push(csvRow(["Section", "Line", "Category", "Amount", "Entries"]));

  for (const l of schedule.income) lines.push(csvRow(["Income", l.line, l.label, l.total.toFixed(2), l.entries]));
  lines.push(csvRow(["Income", "", "Total income", schedule.incomeTotal.toFixed(2), ""]));

  for (const l of schedule.expenses) lines.push(csvRow(["Expense", l.line, l.label, l.total.toFixed(2), l.entries]));
  lines.push(csvRow(["Expense", "", "Total expenses", schedule.expenseTotal.toFixed(2), ""]));

  lines.push(csvRow(["Net", "", `Net profit or loss (Schedule ${schedule.scheduleCode})`, schedule.net.toFixed(2), ""]));

  if (schedule.unmapped.length > 0) {
    lines.push("");
    lines.push(csvRow(["Unmapped", "", "Category", "Amount", "Entries"]));
    for (const u of schedule.unmapped) {
      lines.push(csvRow(["Unmapped", "", `${u.category} (${u.direction})`, u.total.toFixed(2), u.entries]));
    }
  }

  return lines.join("\n");
}

/** Every transaction behind the totals, with the line each one landed on —
 * the backup if a figure is ever questioned. */
export function detailCsv(input: {
  transactions: RealTransaction[];
  categories: TaxCategory[];
  types: TypeMap;
  businessType: string;
  businessName: string;
}): string {
  const { transactions, categories, types, businessType, businessName } = input;

  const lineFor = (direction: Direction, category: string): string => {
    if (direction !== "income" && direction !== "expense") return "";
    const match = categoriesFor(categories, businessType, direction).find(
      (c) => c.label.toLowerCase() === category.trim().toLowerCase(),
    );
    return match?.schedule_line ?? "UNMAPPED";
  };

  const rows = [csvRow(["Business", "Date", "Type", "Line", "Category", "Amount", "Payer", "Account", "Note"])];

  for (const t of [...transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    const direction = directionOf(t, types);
    rows.push(
      csvRow([
        businessName,
        t.date,
        t.type,
        lineFor(direction, t.category ?? ""),
        t.category,
        Math.abs(Number(t.amount)).toFixed(2),
        t.payer,
        t.account,
        t.note ?? "",
      ]),
    );
  }

  return rows.join("\n");
}

/** Hands the browser a file. Kept here so the pages don't each grow their
 * own copy of the object-URL dance. */
export function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
