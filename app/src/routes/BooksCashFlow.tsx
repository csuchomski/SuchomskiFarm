import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, GridRow, StatTile } from "../components/ui";
import { directionOf, fetchBooksData, typeMap, type BooksData } from "../lib/books-data";
import { accountBalances, cashFlow, monthLabel, monthsBack } from "../lib/books-report";
import { useWorkspace } from "../lib/workspace";
import "./books-reports.css";

/**
 * Cash in hand, month by month.
 *
 * The question Reports does not answer. Reports totals income and expenses
 * by category and by month — what the business *earned and spent*. Neither
 * of those is what is in the bank, and the difference is the whole reason a
 * profitable month can still leave you unable to pay for feed.
 *
 * Every figure is the ledger's own. Nothing here is projected, estimated or
 * carried from anywhere else, because a cash balance that is partly a guess
 * is worse than no cash balance.
 *
 * **The window carries the past forward.** Three months is three months of
 * *movement*, opening at what the business actually held on the first of
 * them — see `cashFlow`, which is pure and unit-tested, and which takes
 * every transaction rather than a windowed subset for exactly this reason.
 */

const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BooksData };

const RANGES = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
  { months: 0, label: "All time" },
];

const COLS = "1fr 110px 110px 120px 120px";
// Three cells fit a phone. In and Out drop out rather than Cash after —
// the bars under the month name already show the split, and the balance is
// the reason this page exists.
const COLS_SM = "1fr 100px 110px";

const ACC_COLS = "1fr 140px";

export default function BooksCashFlow() {
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

  /**
   * What the business held before it recorded anything, and where it stands
   * now, per account.
   *
   * Straight from `accountBalances`, which is what the Balance sheet reads —
   * so the closing figure on this page and the cash line on that one cannot
   * disagree. It also keeps the "Venmo" behaviour: an account named only by
   * a transaction still gets a line rather than its money going missing.
   */
  const balances = useMemo(() => {
    if (!data) return [];
    return accountBalances(data.accounts.filter((a) => a.business_id === businessId), mine, types);
  }, [data, businessId, mine, types]);

  const openingCash = useMemo(() => balances.reduce((sum, b) => sum + b.opening, 0), [balances]);
  const cashNow = useMemo(() => balances.reduce((sum, b) => sum + b.balance, 0), [balances]);

  const { rows, broughtForward } = useMemo(
    () =>
      cashFlow({
        transactions: mine,
        types,
        openingCash,
        // "3 months" means this month and the two before it. All time leaves
        // the start open so it begins at the first month with activity.
        from: months === 0 ? undefined : monthsBack(today, months - 1).slice(0, 7),
        to: today.slice(0, 7),
      }),
    [mine, types, openingCash, months, today],
  );

  const received = rows.reduce((sum, r) => sum + r.received, 0);
  const spent = rows.reduce((sum, r) => sum + r.spent, 0);
  const closing = rows.length ? rows[rows.length - 1].closing : broughtForward;

  /** The tallest bar to scale against — floor of 1 so an all-quiet window
   * does not divide by zero. */
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.received, r.spent)));

  const transfers = useMemo(() => mine.filter((t) => directionOf(t, types) === "neutral").length, [mine, types]);
  const lowest = rows.length ? rows.reduce((a, b) => (b.closing < a.closing ? b : a)) : null;

  return (
    <OpsShell searchPlaceholder="A month…">
      <PageHeader eyebrow={business ? `${business.name} · books` : "Books"} title="Cash flow" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load the books: {load.message}
        </p>
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
            <StatTile value={money(cashNow)} label="Cash on hand" />
            <StatTile value={received ? money(received) : "—"} label="Came in" />
            <StatTile value={spent ? money(spent) : "—"} label="Went out" />
            <StatTile
              value={rows.length ? money(closing - broughtForward) : "—"}
              label={months === 0 ? "Change, all time" : `Change, ${months} months`}
            />
          </div>

          {mine.length === 0 ? (
            <Callout>
              {openingCash === 0 ? (
                <>
                  Nothing recorded for this business, and no opening balance on its accounts — so there is no cash to
                  follow yet. Add entries on <Link to="/books/transactions">Transactions</Link>.
                </>
              ) : (
                <>
                  This business holds {money(openingCash)} in opening balances and has no entries recorded against it,
                  so there is no movement to show. Add entries on <Link to="/books/transactions">Transactions</Link>.
                </>
              )}
            </Callout>
          ) : rows.length === 0 ? (
            <Callout>
              Nothing moved in that period. It opened and closed on {money(broughtForward)} — try a longer range, or
              add entries on <Link to="/books/transactions">Transactions</Link>.
            </Callout>
          ) : (
            <>
              {/* ── the run ── */}
              <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                Month by month
              </div>

              <p className="cash-carried">
                Brought forward <strong className="mono">{money(broughtForward)}</strong>
                {months !== 0 && " — what was in hand before this period, so the balances below are real rather than a running total from zero"}
                .
              </p>

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Month</span>
                <span className="text-right hide-sm">In</span>
                <span className="text-right hide-sm">Out</span>
                <span className="text-right">Net</span>
                <span className="text-right">Cash after</span>
              </GridRow>

              {rows.map((r) => (
                <GridRow key={r.month} cols={COLS} mobileCols={COLS_SM} as="body" highlight={r.entries === 0}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 15 }}>{monthLabel(r.month)}</span>
                    <div className="month-bars" aria-hidden="true">
                      <div className="month-bars__in" style={{ width: `${(r.received / peak) * 100}%` }} />
                      <div className="month-bars__out" style={{ width: `${(r.spent / peak) * 100}%` }} />
                    </div>
                  </span>
                  <span className="mono text-right hide-sm">{r.received ? money(r.received) : "—"}</span>
                  <span className="mono text-right hide-sm" style={{ color: r.spent ? "var(--red)" : undefined }}>
                    {r.spent ? money(r.spent) : "—"}
                  </span>
                  <span className="mono text-right">{r.entries ? money(r.net) : "—"}</span>
                  {/* The column the page exists for. Red when the month ended
                      overdrawn — that is not a rounding detail, it is the
                      thing you needed to know a month earlier. */}
                  <span
                    className="mono text-right"
                    style={{ fontWeight: 500, color: r.closing < 0 ? "var(--red)" : undefined }}
                  >
                    {money(r.closing)}
                  </span>
                </GridRow>
              ))}

              {lowest && lowest.closing < 0 && (
                <div style={{ paddingTop: 20 }}>
                  <Callout>
                    Cash went below zero in {monthLabel(lowest.month)}, closing at {money(lowest.closing)}. These are
                    the accounts' own figures, so that is either an overdraft or an entry posted to the wrong account.
                  </Callout>
                </div>
              )}

              {/* ── where it sits now ── */}
              <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                Where it sits today
              </div>

              <GridRow cols={ACC_COLS} as="header">
                <span>Account</span>
                <span className="text-right">Balance</span>
              </GridRow>

              {balances.map((b) => (
                <GridRow key={b.account} cols={ACC_COLS} as="body">
                  <span style={{ minWidth: 0, fontSize: 15 }}>
                    {b.account}
                    {b.unlisted && (
                      <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                        {" "}
                        · named by entries, not on the account list
                      </span>
                    )}
                  </span>
                  <span className="mono text-right" style={{ color: b.balance < 0 ? "var(--red)" : undefined }}>
                    {money(b.balance)}
                  </span>
                </GridRow>
              ))}

              <GridRow cols={ACC_COLS} as="body">
                <span style={{ fontSize: 15, fontWeight: 500 }}>Cash on hand</span>
                <span className="mono text-right" style={{ fontWeight: 500 }}>
                  {money(cashNow)}
                </span>
              </GridRow>

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 24 }}>
                {transfers > 0 ? (
                  <>
                    {transfers === 1 ? "One entry is" : `${transfers} entries are`} a transfer, and transfers are left
                    out of every figure here: moving money between two of your own accounts does not change how much
                    you have. It does mean these are totals across all accounts — the ledger records one row for a
                    movement rather than a matched pair, so which account received it is not on file.{" "}
                  </>
                ) : (
                  <>Totals across all accounts. Transfers, when there are any, are neutral — they move money without
                    changing how much there is.{" "}
                  </>
                )}
                Every figure is the ledger's own; nothing here is projected.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}
