import { useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, EarTag, GridRow, ProgressBar, StatTile } from "../components/ui";
import { spendBreakdown } from "../lib/mockData";
import { TODAY_LABEL, monthTotals, useAppActions, useAppState } from "../lib/store";
import "./books-transactions.css";

const CASH_ON_HAND = 14062;

export default function BooksTransactions() {
  const state = useAppState();
  const { ledger, arriving, awaitingCategory, splitRule } = state;
  const { postArrivingAsMilkSales, addLedgerEntry, setSplitRule } = useAppActions();
  const totals = monthTotals(state);

  const [reviewNote, setReviewNote] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [attributedTo, setAttributedTo] = useState("");
  const [account, setAccount] = useState("Chase Checking");
  const [amount, setAmount] = useState("");

  const canSubmit = description.trim() !== "" && amount.trim() !== "" && !Number.isNaN(Number(amount));

  const submitEntry = () => {
    if (!canSubmit) return;
    addLedgerEntry({
      date: TODAY_LABEL,
      description: description.trim(),
      category: category.trim() || "Uncategorised",
      categoryPending: category.trim() === "",
      attribution: { label: attributedTo.trim() || "Unattributed" },
      account,
      amount: Number(amount),
      highlight: true,
    });
    setDescription("");
    setCategory("");
    setAttributedTo("");
    setAmount("");
    setShowForm(false);
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow="Dairy & farm store · July 2026"
        title="Transactions"
        actions={
          <>
            <Button className="mono">July 2026 ▾</Button>
            <Button variant="filled" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Cancel" : "Add entry"}
            </Button>
          </>
        }
      />

      <div className="stat-row">
        <StatTile value={`$${totals.income.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Income" />
        <StatTile
          value={`$${totals.expenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          tone="red"
          label="Expenses"
        />
        <StatTile value={`+$${totals.net.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} label="Net" />
        <StatTile value={`$${CASH_ON_HAND.toLocaleString()}`} label="Cash on hand" />
        <StatTile value={awaitingCategory} label="Awaiting category" />
      </div>

      {showForm && (
        <div className="entry-form">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            New entry — posts to {TODAY_LABEL} · category and attribution default to Uncategorised / Unattributed if
            left blank
          </div>
          <div className="entry-form__grid">
            <input
              className="entry-form__field"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <input
              className="entry-form__field"
              placeholder="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <input
              className="entry-form__field"
              placeholder="Attributed to"
              value={attributedTo}
              onChange={(e) => setAttributedTo(e.target.value)}
            />
            <select className="entry-form__field" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option>Chase Checking</option>
              <option>Farm Visa</option>
              <option>Venmo</option>
              <option>Cash box</option>
            </select>
            <input
              className="entry-form__field mono"
              placeholder="Amount, − = expense"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button className="entry-form__submit" onClick={submitEntry} disabled={!canSubmit}>
              Post entry
            </button>
          </div>
        </div>
      )}

      <div className="arriving-panel">
        <div className="arriving-panel__head">
          <span className="eyebrow" style={{ color: "var(--ink-soft)" }}>
            Arriving from the store
          </span>
          <span className="mono" style={{ fontSize: 13 }}>
            {arriving.count > 0 ? `$${arriving.amount.toFixed(2)} · ${arriving.count} pickups` : "All caught up"}
          </span>
        </div>
        {arriving.count > 0 ? (
          <>
            <p className="arriving-panel__body text-wrap-pretty">
              Every completed pickup lands here already priced and dated. Confirm the category once and it posts —
              nothing is re-typed from the store.
            </p>
            <div className="action-row">
              <Button variant="filled" size="sm" onClick={postArrivingAsMilkSales}>
                Post all as Milk sales
              </Button>
              <Button size="sm" onClick={() => setReviewNote(true)}>
                Review one by one
              </Button>
            </div>
            {reviewNote && (
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 10 }}>
                One-by-one review isn't built in this preview — use "Post all as Milk sales" instead.
              </p>
            )}
          </>
        ) : (
          <p className="arriving-panel__body text-wrap-pretty">
            Nothing waiting on a category — the last batch of pickups posted to the ledger below.
          </p>
        )}
      </div>

      <GridRow cols="88px 1fr 150px 178px 130px 104px" as="header">
        <span>Date</span>
        <span>Description</span>
        <span>Category</span>
        <span>Attributed to</span>
        <span>Account</span>
        <span className="text-right">Amount</span>
      </GridRow>

      {ledger.map((row, i) => (
        <GridRow
          cols="88px 1fr 150px 178px 130px 104px"
          as="body"
          className="mono"
          key={`${row.date}-${row.description}-${i}`}
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
        Showing {ledger.length} entries — the 8 drawn in the mockup{ledger.length > 8 ? `, plus ${ledger.length - 8} added this session` : ""}, out of July's full ledger.
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
              The 24 July feed invoice is set to split {splitRule === "evenly" ? "evenly across 41 head" : "by production"}.
              {splitRule === "evenly" ? (
                <>
                  {" "}
                  Weight it by production instead and the per-cow numbers on{" "}
                  <Link to="/animals/1103">every animal record</Link> change with it.
                </>
              ) : (
                <> Per-cow numbers now reflect production share.</>
              )}
            </p>
            <div className="action-row">
              <Button
                size="sm"
                variant={splitRule === "evenly" ? "filled" : "outline"}
                onClick={() => setSplitRule("evenly")}
              >
                Split evenly
              </Button>
              <Button
                size="sm"
                variant={splitRule === "production" ? "filled" : "outline"}
                onClick={() => setSplitRule("production")}
              >
                By production
              </Button>
            </div>
          </Callout>
        </div>
      </div>
    </OpsShell>
  );
}
