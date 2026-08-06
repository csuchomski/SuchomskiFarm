import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, StatTile } from "../components/ui";
import { fetchBusinessOverview, type BusinessOverview } from "../lib/books-data";
import { useWorkspace } from "../lib/workspace";
import { groupsForModules } from "../components/shell/nav";

/**
 * Home for a business with no herd. Today's dairy chain — milk, batches,
 * profit per head — describes a farm and nothing else, so a realtor gets
 * this instead: the ledger, which every business type has.
 */

type Fetch = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BusinessOverview };

const dollars = (n: number) =>
  `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const signed = (n: number) => `${n < 0 ? "−" : ""}${dollars(n)}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function Overview() {
  const navigate = useNavigate();
  const { business, modules, role } = useWorkspace();
  const businessId = business?.id ?? null;
  const [result, setResult] = useState<Fetch>({ state: "loading" });

  useEffect(() => {
    if (businessId === null) return;
    let cancelled = false;
    setResult({ state: "loading" });

    fetchBusinessOverview(businessId, todayIso())
      .then((data) => !cancelled && setResult({ state: "ok", data }))
      .catch(
        (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
      );

    return () => {
      cancelled = true;
    };
    // Re-runs on every business switch, which is the whole point of the page.
  }, [businessId]);

  const data = result.state === "ok" ? result.data : null;
  const month = new Date(`${todayIso()}T00:00:00`).toLocaleDateString(undefined, { month: "long" });

  // What this business type can actually reach, minus the sections nobody
  // has built yet — an honest list beats four links that do nothing.
  const groups = groupsForModules(modules);
  const built = groups.flatMap((g) => g.items.filter((i) => i.to).map((i) => ({ ...i, heading: g.heading })));
  const unbuilt = groups.filter((g) => g.items.every((i) => !i.to)).map((g) => g.heading);

  return (
    <OpsShell searchPlaceholder="An entry, an account, a note…">
      <PageHeader
        eyebrow={business ? `${business.name} · ${business.type}${role ? ` · ${role}` : ""}` : longDate(todayIso())}
        title="Overview"
        actions={
          <Button variant="filled" onClick={() => navigate("/books/transactions")}>
            Add entry
          </Button>
        }
      />

      {result.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {result.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load this business: {result.message}
        </p>
      )}

      {data && (
        <>
          <div className="stat-row">
            <StatTile value={signed(data.monthNet)} label={`Net · ${month}`} tone={data.monthNet < 0 ? "red" : "ink"} />
            <StatTile value={dollars(data.monthIncome)} label={`In · ${month}`} />
            <StatTile value={dollars(data.monthExpenses)} label={`Out · ${month}`} />
            <StatTile value={data.monthEntries} label="Entries this month" />
          </div>

          {data.unknownTypes.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Callout>
                {data.unknownTypes.length} transaction type
                {data.unknownTypes.length === 1 ? "" : "s"} on this business ({data.unknownTypes.join(", ")}) aren't in
                the lookup table, so they're left out of the totals above rather than guessed at.
              </Callout>
            </div>
          )}

          <div className="two-col" style={{ paddingTop: 24 }}>
            <div>
              <div className="section__head" style={{ marginBottom: 12 }}>
                <div className="serif" style={{ fontSize: 21 }}>
                  Recent entries
                </div>
                <Link to="/books/transactions" className="mono" style={{ fontSize: 13 }}>
                  all entries →
                </Link>
              </div>

              {data.recent.length === 0 ? (
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--ink-muted)",
                    padding: "12px 8px",
                    borderTop: "1px solid var(--hairline)",
                  }}
                >
                  Nothing posted to {business?.name ?? "this business"} yet.
                </p>
              ) : (
                <>
                  <GridRow cols="92px 1fr 100px" as="header">
                    <span>Date</span>
                    <span>Entry</span>
                    <span className="text-right">Amount</span>
                  </GridRow>
                  {data.recent.map((t) => (
                    <GridRow key={t.id} cols="92px 1fr 100px" as="body">
                      <span className="mono" style={{ fontSize: 13 }}>
                        {t.date}
                      </span>
                      <span>
                        <span style={{ fontSize: 15 }}>{t.category || t.type}</span>
                        {t.note && (
                          <>
                            <br />
                            <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{t.note}</span>
                          </>
                        )}
                      </span>
                      <span className="mono text-right" style={{ fontSize: 15 }}>
                        {dollars(Number(t.amount))}
                      </span>
                    </GridRow>
                  ))}
                </>
              )}
            </div>

            <div>
              <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
                Accounts
              </div>
              {data.balances.length === 0 ? (
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--ink-muted)",
                    padding: "12px 8px",
                    borderTop: "1px solid var(--hairline)",
                  }}
                >
                  No accounts on this business.
                </p>
              ) : (
                data.balances.map((b, i) => (
                  <div
                    key={b.account}
                    style={{
                      borderTop: "1px solid var(--hairline)",
                      borderBottom: i === data.balances.length - 1 ? "1px solid var(--hairline)" : undefined,
                      padding: "12px 8px",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{b.account}</span>
                    <span
                      className="mono"
                      style={{ fontSize: 15, color: b.balance < 0 ? "var(--red)" : undefined }}
                    >
                      {signed(b.balance)}
                    </span>
                  </div>
                ))
              )}

              <div className="serif" style={{ fontSize: 21, margin: "24px 0 12px" }}>
                In this business
              </div>
              {built.map((item) => (
                <Link
                  key={item.to}
                  to={item.to!}
                  style={{ color: "inherit", display: "block", borderTop: "1px solid var(--hairline)" }}
                >
                  <div style={{ padding: "12px 8px" }}>
                    <div style={{ fontSize: 15 }}>{item.label}</div>
                    <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>{item.heading}</div>
                  </div>
                </Link>
              ))}
              {unbuilt.length > 0 && (
                <div
                  style={{
                    borderTop: "1px solid var(--hairline)",
                    padding: "12px 8px",
                    fontSize: 13,
                    color: "var(--ink-muted)",
                  }}
                >
                  {unbuilt.join(" and ")} {unbuilt.length === 1 ? "is" : "are"} part of this business type but
                  {unbuilt.length === 1 ? " hasn't" : " haven't"} been built yet.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </OpsShell>
  );
}
