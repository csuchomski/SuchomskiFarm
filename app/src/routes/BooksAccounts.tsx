import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchBooksData, typeMap, type BooksData } from "../lib/books-data";
import { accountBalances } from "../lib/books-report";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";

/**
 * Where the money is: one line per account, opening balance plus everything
 * posted to it.
 *
 * Accounts are matched to transactions by name rather than by id, because
 * ledger_transactions.account is text. See accountBalances for what that
 * costs and how an unlisted account is handled.
 */

const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BooksData };

const COLS = "1fr 130px 130px 90px 130px";
const COLS_SM = "1fr 100px 100px";

export default function BooksAccounts() {
  const { business } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });

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

  const accounts = useMemo(
    () => (data ? data.accounts.filter((a) => a.business_id === businessId) : []),
    [data, businessId],
  );
  const transactions = useMemo(
    () => (data ? data.transactions.filter((t) => t.business_id === businessId) : []),
    [data, businessId],
  );

  const rows = useMemo(() => accountBalances(accounts, transactions, types), [accounts, transactions, types]);
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const unlisted = rows.filter((r) => r.unlisted);

  return (
    <OpsShell searchPlaceholder="An account…">
      <PageHeader eyebrow={business ? `${business.name} · books` : "Books"} title="Accounts" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load the books: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={rows.length || "—"} label="Accounts" />
            <StatTile value={rows.length ? money(Math.round(total * 100) / 100) : "—"} label="Total balance" />
            <StatTile value={transactions.length || "—"} label="Entries posted" />
            <StatTile value={unlisted.length || "—"} label="Unlisted accounts" />
          </div>

          {rows.length === 0 ? (
            <Callout>
              No accounts for this business yet, and nothing posted against one. Entries added on{" "}
              <Link to="/books/transactions">Transactions</Link> name an account, and it'll appear here.
            </Callout>
          ) : (
            <>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Account</span>
                <span className="text-right hide-sm">Opening</span>
                <span className="text-right">Movement</span>
                <span className="text-right hide-sm">Entries</span>
                <span className="text-right">Balance</span>
              </GridRow>

              {rows.map((r) => (
                <GridRow key={r.account} cols={COLS} mobileCols={COLS_SM} as="body" highlight={r.unlisted}>
                  <span style={{ minWidth: 0 }}>
                    <span className="serif" style={{ fontSize: 17 }}>
                      {r.account}
                    </span>
                    {r.unlisted && (
                      <>
                        {" "}
                        <Pill variant="outline">unlisted</Pill>
                      </>
                    )}
                  </span>
                  <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
                    {money(r.opening)}
                  </span>
                  <span className="mono text-right" style={{ color: r.movement < 0 ? "var(--red)" : undefined }}>
                    {r.movement === 0 ? "—" : money(r.movement)}
                  </span>
                  <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
                    {r.entries || "—"}
                  </span>
                  <span className="mono text-right" style={{ fontSize: 15, fontWeight: 500 }}>
                    {money(r.balance)}
                  </span>
                </GridRow>
              ))}

              {unlisted.length > 0 && (
                <div style={{ paddingTop: 16 }}>
                  <Callout>
                    {unlisted.length === 1 ? "One account is" : `${unlisted.length} accounts are`} named only by
                    transactions — there's no <code>ledger_accounts</code> row for{" "}
                    {unlisted.map((r) => r.account).join(", ")} under this business, so{" "}
                    {unlisted.length === 1 ? "its" : "their"} opening balance is taken as zero. The live "Venmo" row
                    has no business attached, which is how this happens.
                  </Callout>
                </div>
              )}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                A transfer moves money between accounts but is neutral to the books, so it doesn't change a balance
                here — the ledger records one row for a movement, not a matched pair.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}
