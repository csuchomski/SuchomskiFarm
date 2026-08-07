import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, StatTile } from "../components/ui";
import { fetchBooksData, typeMap, type BooksData } from "../lib/books-data";
import { inRange } from "../lib/books-report";
import {
  buildSchedule,
  detailCsv,
  downloadCsv,
  fetchBusinessTypes,
  fetchTaxCategories,
  scheduleCsv,
  yearEnd,
  yearsWithActivity,
  yearStart,
  type BusinessTypeSchedule,
  type TaxCategory,
} from "../lib/tax";
import { useWorkspace } from "../lib/workspace";
import "./books-taxes.css";

/**
 * The filing schedule for a business, a year at a time.
 *
 * Every line of the form is shown, including the zeros, because this is read
 * against the paper form — you need to find line 16 whether or not you bought
 * feed. Reports is the screen that hides empty rows; this one is the form.
 *
 * It records where totals go. It does not compute anyone's tax: no
 * depreciation engine, no self-employment tax, no basis tracking.
 * Depreciation is a category you enter the figure into.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; books: BooksData; categories: TaxCategory[]; businessTypes: BusinessTypeSchedule[] };

const COLS = "70px 1fr 130px 80px";
const COLS_SM = "56px 1fr 110px";

export default function BooksTaxes() {
  const { business } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [year, setYear] = useState(() => todayIso().slice(0, 4));

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    (async () => {
      const [books, categories, businessTypes] = await Promise.all([
        fetchBooksData(),
        fetchTaxCategories(),
        fetchBusinessTypes(),
      ]);
      if (!cancelled) setLoad({ state: "ok", books, categories, businessTypes });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const books = load.state === "ok" ? load.books : null;
  const categories = load.state === "ok" ? load.categories : EMPTY_CATEGORIES;
  const businessTypes = load.state === "ok" ? load.businessTypes : EMPTY_TYPES;
  const types = useMemo(() => typeMap(books?.types ?? []), [books?.types]);

  const mine = useMemo(
    () => (books ? books.transactions.filter((t) => t.business_id === businessId) : []),
    [books, businessId],
  );
  const years = useMemo(() => yearsWithActivity(mine, todayIso()), [mine]);
  const scoped = useMemo(() => inRange(mine, yearStart(year), yearEnd(year)), [mine, year]);

  const businessType = businessTypes.find((t) => t.code === business?.type);

  const schedule = useMemo(
    () => buildSchedule({ businessType, categories, transactions: scoped, types, year }),
    [businessType, categories, scoped, types, year],
  );

  const exportSchedule = () =>
    downloadCsv(
      `${slug(business?.name ?? "business")}-schedule-${schedule.scheduleCode}-${year}.csv`,
      scheduleCsv(schedule, business?.name ?? "Business"),
    );

  const exportDetail = () =>
    downloadCsv(
      `${slug(business?.name ?? "business")}-transactions-${year}.csv`,
      detailCsv({
        transactions: scoped,
        categories,
        types,
        businessType: business?.type ?? "",
        businessName: business?.name ?? "Business",
      }),
    );

  return (
    <OpsShell searchPlaceholder="A line, a category…">
      <PageHeader
        eyebrow={business ? `${business.name} · books` : "Books"}
        title="Taxes"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button disabled={load.state !== "ok" || scoped.length === 0} onClick={exportDetail}>
              Export detail
            </Button>
            <Button variant="filled" disabled={load.state !== "ok"} onClick={exportSchedule}>
              Export schedule
            </Button>
          </div>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load the books: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="tax-head">
            <div>
              <div className="serif tax-schedule">{schedule.scheduleLabel}</div>
              <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                Calendar year {year} · {scoped.length} {scoped.length === 1 ? "entry" : "entries"}
              </div>
            </div>
            <div className="tax-years">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={`report-chip ${y === year ? "report-chip--active" : ""}`}
                  onClick={() => setYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          <div className="stat-row">
            <StatTile value={schedule.incomeTotal ? money(schedule.incomeTotal) : "—"} label="Gross income" />
            <StatTile value={schedule.expenseTotal ? money(schedule.expenseTotal) : "—"} label="Total expenses" />
            <StatTile value={scoped.length ? money(schedule.net) : "—"} label={`Net (Sch ${schedule.scheduleCode})`} />
            <StatTile value={schedule.unmapped.length || "—"} label="Unmapped categories" />
          </div>

          {!businessType && (
            <Callout>
              No schedule is recorded for the business type "{business?.type ?? "unknown"}", so the lines below are
              empty. Migration 018 sets this for farm, rental and other.
            </Callout>
          )}

          {schedule.unmapped.length > 0 && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                {schedule.unmapped.length === 1 ? "One category doesn't" : `${schedule.unmapped.length} categories don't`}{" "}
                match a line on this schedule:{" "}
                {schedule.unmapped.map((u) => `${u.category} (${money(u.total)})`).join(", ")}. The money is counted in
                the totals above — it just has nowhere to go on the form. Recategorise those entries on{" "}
                <Link to="/books/transactions">Transactions</Link> before filing.
              </Callout>
            </div>
          )}

          {scoped.length === 0 && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                Nothing recorded for {year}. The form below is the empty schedule — add entries on{" "}
                <Link to="/books/transactions">Transactions</Link>.
              </Callout>
            </div>
          )}

          <Section
            title={`Part I — Income`}
            lines={schedule.income}
            total={schedule.incomeTotal}
            totalLabel="Gross income"
          />

          <Section
            title={`Part II — Expenses`}
            lines={schedule.expenses}
            total={schedule.expenseTotal}
            totalLabel="Total expenses"
          />

          <div className="tax-net">
            <span className="serif" style={{ fontSize: 19 }}>
              Net profit or loss — Schedule {schedule.scheduleCode}
            </span>
            <span className="mono tax-net__value" style={{ color: schedule.net < 0 ? "var(--red)" : undefined }}>
              {money(schedule.net)}
            </span>
          </div>

          <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 24 }}>
            These are your books totalled onto the schedule's lines — not a tax calculation. Depreciation and section
            179 is whatever figure you record against that category; nothing here computes it, and nothing here works
            out self-employment tax or basis. Take this to whoever files for you.
          </p>
        </>
      )}
    </OpsShell>
  );
}

function Section({
  title,
  lines,
  total,
  totalLabel,
}: {
  title: string;
  lines: { line: string; label: string; total: number; entries: number }[];
  total: number;
  totalLabel: string;
}) {
  if (lines.length === 0) return null;
  return (
    <>
      <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
        {title}
      </div>
      <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
        <span>Line</span>
        <span>Category</span>
        <span className="text-right">Amount</span>
        <span className="text-right hide-sm">Entries</span>
      </GridRow>
      {lines.map((l) => (
        <GridRow key={`${l.line}-${l.label}`} cols={COLS} mobileCols={COLS_SM} as="body" highlight={l.entries === 0}>
          <span className="mono" style={{ fontSize: 14, fontWeight: l.entries > 0 ? 500 : 400 }}>
            {l.line}
          </span>
          <span style={{ fontSize: 15, color: l.entries === 0 ? "var(--ink-muted)" : undefined, minWidth: 0 }}>
            {l.label}
          </span>
          <span className="mono text-right" style={{ color: l.entries === 0 ? "var(--ink-faint)" : undefined }}>
            {l.entries === 0 ? "—" : money(l.total)}
          </span>
          <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
            {l.entries || "—"}
          </span>
        </GridRow>
      ))}
      <div className="tax-subtotal">
        <span>{totalLabel}</span>
        <span className="mono">{money(total)}</span>
      </div>
    </>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "business";

const EMPTY_CATEGORIES: TaxCategory[] = [];
const EMPTY_TYPES: BusinessTypeSchedule[] = [];
