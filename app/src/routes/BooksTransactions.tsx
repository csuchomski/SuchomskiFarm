import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, EarTag, GridRow, ProgressBar, StatTile } from "../components/ui";
import { ledger, spendBreakdown } from "../lib/mockData";
import "./books-transactions.css";

// July's stat-row totals reflect the whole month's books; the ledger below
// is only the 8 entries the mockup draws, not the full month, so these are
// authored to match the design directly rather than summed from that sample.
const monthStats = { income: 6180, expenses: 3770, net: 2410, cash: 14062, awaitingCategory: 4 };

export default function BooksTransactions() {
  return (
    <OpsShell>
      <PageHeader
        eyebrow="Dairy & farm store · July 2026"
        title="Transactions"
        actions={
          <>
            <Button className="mono">July 2026 ▾</Button>
            <Button variant="filled">Add entry</Button>
          </>
        }
      />

      <div className="stat-row">
        <StatTile value={`$${monthStats.income.toLocaleString()}`} label="Income" />
        <StatTile value={`$${monthStats.expenses.toLocaleString()}`} tone="red" label="Expenses" />
        <StatTile value={`+$${monthStats.net.toLocaleString()}`} label="Net" />
        <StatTile value={`$${monthStats.cash.toLocaleString()}`} label="Cash on hand" />
        <StatTile value={monthStats.awaitingCategory} label="Awaiting category" />
      </div>

      <div className="arriving-panel">
        <div className="arriving-panel__head">
          <span className="eyebrow" style={{ color: "var(--ink-soft)" }}>
            Arriving from the store
          </span>
          <span className="mono" style={{ fontSize: 13 }}>
            $164.50 · 4 pickups
          </span>
        </div>
        <p className="arriving-panel__body text-wrap-pretty">
          Every completed pickup lands here already priced and dated. Confirm the category once and it posts —
          nothing is re-typed from the store.
        </p>
        <div className="action-row">
          <Button variant="filled" size="sm">
            Post all as Milk sales
          </Button>
          <Button size="sm">Review one by one</Button>
        </div>
      </div>

      <GridRow cols="88px 1fr 150px 178px 130px 104px" as="header">
        <span>Date</span>
        <span>Description</span>
        <span>Category</span>
        <span>Attributed to</span>
        <span>Account</span>
        <span className="text-right">Amount</span>
      </GridRow>

      {ledger.map((row) => (
        <GridRow
          cols="88px 1fr 150px 178px 130px 104px"
          as="body"
          className="mono"
          key={row.date + row.description}
          highlight={row.highlight}
        >
          <span>{row.date}</span>
          <span style={{ fontFamily: "var(--font-sans)" }}>{row.description}</span>
          <span style={{ color: row.categoryPending ? "var(--ink-muted)" : undefined }}>{row.category}</span>
          <span>
            {row.attribution.tag ? (
              <span className="attribution-tag">
                <EarTag tag={row.attribution.tag} accent={row.attribution.tagAccent ?? "herd"} size="sm" />
                <span style={{ fontFamily: "var(--font-sans)" }}>{row.attribution.name}</span>
              </span>
            ) : (
              <span
                style={{
                  color: row.attribution.emphasis
                    ? "var(--herd-green)"
                    : row.categoryPending
                      ? "var(--ink-muted)"
                      : "var(--ink-muted)",
                }}
              >
                {row.attribution.label}
              </span>
            )}
          </span>
          <span style={{ color: "var(--ink-muted)" }}>{row.account}</span>
          <span
            className="text-right"
            style={{ fontWeight: 500, color: row.amount < 0 ? "var(--red)" : undefined }}
          >
            {row.amount < 0 ? "−" : "+"}${Math.abs(row.amount).toFixed(2)}
          </span>
        </GridRow>
      ))}
      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
        Showing 8 entries — the ones drawn in the mockup, out of July's full ledger.
      </p>

      <div className="ledger-footer">
        <div>
          <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
            Where July went
          </div>
          {spendBreakdown.map((c) => (
            <ProgressBar key={c.label} label={c.label} valueLabel={`$${c.amount.toLocaleString()} · ${c.pct}%`} pct={c.pct} />
          ))}
        </div>
        <div>
          <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
            Unallocated
          </div>
          <Callout tone="dashed">
            <div className="serif" style={{ fontSize: 21, marginBottom: 8 }}>
              One entry needs a home
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12, maxWidth: "52ch" }} className="text-wrap-pretty">
              The 24 July feed invoice is set to split evenly across 41 head. Weight it by production instead and
              the per-cow numbers on <Link to="/animals/1103">every animal record</Link> change with it.
            </p>
            <div className="action-row">
              <Button size="sm">Split evenly</Button>
              <Button variant="filled" size="sm">
                By production
              </Button>
            </div>
          </Callout>
        </div>
      </div>
    </OpsShell>
  );
}
