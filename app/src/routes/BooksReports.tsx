import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, GridRow, StatTile } from "../components/ui";
import { fetchBooksData, summarise, typeMap, type BooksData } from "../lib/books-data";
import { byCategory, byMonth, inRange, monthLabel, monthsBack } from "../lib/books-report";
import { useWorkspace } from "../lib/workspace";
import "./books-reports.css";

/**
 * Where the money went: by month, and by category.
 *
 * Everything is computed from the same rows the Transactions page shows —
 * see lib/books-report.ts, which is pure and unit-tested. Transfers are
 * excluded throughout: they're neutral by design, and counting them would
 * double every movement between accounts.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BooksData };

const RANGES = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
  { months: 0, label: "All time" },
];

const MONTH_COLS = "1fr 110px 110px 110px 70px";
const MONTH_COLS_SM = "1fr 90px 90px";

const CAT_COLS = "1fr 110px 70px";

export default function BooksReports() {
  const { business } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [months, setMonths] = useState(12);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    fetchBooksData()
      .then((data) => !cancelled && setLoad({ state: "ok", data }))
      .catch(
        (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const data = load.state === "ok" ? load.data : null;
  const types = useMemo(() => typeMap(data?.types ?? []), [data?.types]);
  const today = todayIso();

  const mine = useMemo(
    () => (data ? data.transactions.filter((t) => t.business_id === businessId) : []),
    [data, businessId],
  );

  // "All time" is months === 0; anything else counts back from the first of
  // the month, so "3 months" means three whole months rather than 90 days.
  const scoped = useMemo(
    () => (months === 0 ? mine : inRange(mine, monthsBack(today, months - 1), today)),
    [mine, months, today],
  );

  const totals = summarise(scoped, types);
  const monthRows = useMemo(() => byMonth(scoped, types), [scoped, types]);
  const categories = useMemo(() => byCategory(scoped, types), [scoped, types]);

  const income = categories.filter((c) => c.direction === "income");
  const expenses = categories.filter((c) => c.direction === "expense");
  const peak = Math.max(1, ...monthRows.map((m) => Math.max(m.income, m.expenses)));

  return (
    <OpsShell searchPlaceholder="A category…">
      <PageHeader eyebrow={business ? `${business.name} · books` : "Books"} title="Reports" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load the books: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="report-ranges">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                className={`report-chip ${months === r.months ? "report-chip--active" : ""}`}
                onClick={() => setMonths(r.months)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="stat-row">
            <StatTile value={totals.income ? money(totals.income) : "—"} label="Income" />
            <StatTile value={totals.expenses ? money(totals.expenses) : "—"} label="Expenses" />
            <StatTile value={scoped.length ? money(totals.net) : "—"} label="Net" />
            <StatTile value={scoped.length || "—"} label="Entries" />
          </div>

          {scoped.length === 0 ? (
            <Callout>
              Nothing recorded for this business in that period. Add entries on{" "}
              <Link to="/books/transactions">Transactions</Link>.
            </Callout>
          ) : (
            <>
              {/* ── by month ── */}
              <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                By month
              </div>

              <GridRow cols={MONTH_COLS} mobileCols={MONTH_COLS_SM} as="header">
                <span>Month</span>
                <span className="text-right">In</span>
                <span className="text-right">Out</span>
                <span className="text-right hide-sm">Net</span>
                <span className="text-right hide-sm">#</span>
              </GridRow>

              {monthRows.map((m) => (
                <GridRow key={m.month} cols={MONTH_COLS} mobileCols={MONTH_COLS_SM} as="body" highlight={m.entries === 0}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 15 }}>{monthLabel(m.month)}</span>
                    <div className="month-bars" aria-hidden="true">
                      <div className="month-bars__in" style={{ width: `${(m.income / peak) * 100}%` }} />
                      <div className="month-bars__out" style={{ width: `${(m.expenses / peak) * 100}%` }} />
                    </div>
                  </span>
                  <span className="mono text-right">{m.income ? money(m.income) : "—"}</span>
                  <span className="mono text-right" style={{ color: m.expenses ? "var(--red)" : undefined }}>
                    {m.expenses ? money(m.expenses) : "—"}
                  </span>
                  <span className="mono text-right hide-sm" style={{ fontWeight: 500 }}>
                    {m.entries ? money(m.net) : "—"}
                  </span>
                  <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
                    {m.entries || "—"}
                  </span>
                </GridRow>
              ))}

              {/* ── by category ── */}
              <div className="report-columns">
                <div>
                  <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                    Income by category
                  </div>
                  <CategoryTable rows={income} total={totals.income} empty="No income in this period." />
                </div>
                <div>
                  <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                    Expenses by category
                  </div>
                  <CategoryTable rows={expenses} total={totals.expenses} empty="No expenses in this period." />
                </div>
              </div>

              {totals.unknown > 0 && (
                <div style={{ paddingTop: 24 }}>
                  <Callout>
                    {money(totals.unknown)} sits under {totals.unknownTypes.length === 1 ? "a type" : "types"} the
                    lookup table doesn't know ({totals.unknownTypes.join(", ")}), so it's in no total above. Add the
                    type on <Link to="/books/transactions">Transactions</Link> and it'll be counted.
                  </Callout>
                </div>
              )}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 24 }}>
                Transfers are left out of every figure here — the ledger records one row for a movement between
                accounts, so counting it would double the money.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

function CategoryTable({
  rows,
  total,
  empty,
}: {
  rows: { category: string; total: number; entries: number }[];
  total: number;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>{empty}</p>;
  }
  return (
    <>
      <GridRow cols={CAT_COLS} as="header">
        <span>Category</span>
        <span className="text-right">Total</span>
        <span className="text-right">#</span>
      </GridRow>
      {rows.map((r) => (
        <GridRow key={r.category} cols={CAT_COLS} as="body">
          <span style={{ minWidth: 0 }}>
            <span style={{ fontSize: 15 }}>{r.category}</span>
            <div className="category-bar" aria-hidden="true">
              <div className="category-bar__fill" style={{ width: `${total > 0 ? (r.total / total) * 100 : 0}%` }} />
            </div>
          </span>
          <span className="mono text-right">{money(r.total)}</span>
          <span className="mono text-right" style={{ color: "var(--ink-muted)" }}>
            {r.entries}
          </span>
        </GridRow>
      ))}
    </>
  );
}
