import { useCallback, useEffect, useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, StatTile } from "../components/ui";
import {
  addTransaction,
  fetchBooksData,
  directionOf,
  summarise,
  type BooksData,
  type RealTransaction,
} from "../lib/books-data";
import "./books-transactions.css";

type Fetch = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BooksData };
type Save = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = "96px 1fr 150px 140px 130px 110px";

export default function BooksTransactions() {
  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [businessId, setBusinessId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [save, setSave] = useState<Save>({ state: "idle" });
  const [date, setDate] = useState(todayIso);
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    const data = await fetchBooksData();
    setResult({ state: "ok", data });
    setBusinessId((cur) => cur ?? data.businesses[0]?.id ?? null);
    setAccount((cur) => cur || data.accounts[0]?.name || "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().catch(
      (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  const data = result.state === "ok" ? result.data : null;
  const business = data?.businesses.find((b) => b.id === businessId) ?? null;
  const rows: RealTransaction[] = data ? data.transactions.filter((t) => t.business_id === businessId) : [];
  const totals = summarise(rows);

  const amountNum = Number(amount);
  const canSave =
    businessId !== null && date !== "" && amount.trim() !== "" && !Number.isNaN(amountNum) && amountNum !== 0;

  const handleSave = async () => {
    if (!canSave || businessId === null) return;
    setSave({ state: "saving" });
    try {
      await addTransaction({
        businessId,
        date,
        type,
        category: category.trim() || "Uncategorised",
        amount: Math.abs(amountNum),
        // payer is NOT NULL in the schema but isn't in the mockup's form;
        // empty string rather than inventing a value.
        note: note.trim() || null,
        payer: "",
        account: account.trim() || "",
      });
      setAmount("");
      setNote("");
      setCategory("");
      await load();
      setSave({ state: "saved" });
      setShowForm(false);
      setTimeout(() => setSave((s) => (s.state === "saved" ? { state: "idle" } : s)), 4000);
    } catch (err) {
      setSave({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow={business ? `${business.name} · ${business.type}` : "Books"}
        title="Transactions"
        actions={
          <>
            {data && data.businesses.length > 1 && (
              <select
                className="entry-form__field mono"
                value={businessId ?? ""}
                onChange={(e) => setBusinessId(Number(e.target.value))}
                aria-label="Business"
                style={{ minHeight: 44 }}
              >
                {data.businesses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant="filled" onClick={() => setShowForm((v) => !v)} disabled={!data}>
              {showForm ? "Cancel" : "Add entry"}
            </Button>
          </>
        }
      />

      {result.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading the books…</p>
      )}
      {result.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load the books: {result.message}</p>
      )}

      {data && (
        <>
          <div className="stat-row">
            <StatTile value={money(totals.income)} label="Income" />
            <StatTile value={money(totals.expenses)} tone="red" label="Expenses" />
            <StatTile
              value={`${totals.net < 0 ? "−" : "+"}${money(Math.abs(totals.net))}`}
              label="Net"
              tone={totals.net < 0 ? "red" : "ink"}
            />
            <StatTile value={rows.length} label="Entries" />
          </div>

          {totals.unknownTypes.length > 0 && (
            <div style={{ margin: "16px 0" }}>
              <Callout>
                <strong style={{ fontWeight: 500 }}>
                  {money(totals.unknown)} isn't counted in the totals above.
                </strong>{" "}
                {totals.unknownTypes.length === 1 ? "The type" : "The types"}{" "}
                <span className="mono">{totals.unknownTypes.join(", ")}</span>{" "}
                {totals.unknownTypes.length === 1 ? "isn't" : "aren't"} recognised as income or expense, and
                guessing would make Net look authoritative while being wrong. Those rows are marked below.
              </Callout>
            </div>
          )}

          {showForm && (
            <div className="entry-form">
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                New entry · {business?.name}
              </div>
              <div className="entry-form__grid" style={{ gridTemplateColumns: "140px 110px 1fr 1fr 140px 130px 120px" }}>
                <input
                  className="entry-form__field mono"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  aria-label="Date"
                />
                <select
                  className="entry-form__field"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  aria-label="Type"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <input
                  className="entry-form__field"
                  placeholder="Description"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <input
                  className="entry-form__field"
                  placeholder="Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <input
                  className="entry-form__field"
                  placeholder="Account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  list="ledger-accounts"
                />
                <datalist id="ledger-accounts">
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.name} />
                  ))}
                </datalist>
                <input
                  className="entry-form__field mono"
                  placeholder="Amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button className="entry-form__submit" onClick={() => void handleSave()} disabled={!canSave || save.state === "saving"}>
                  {save.state === "saving" ? "Saving…" : "Post entry"}
                </button>
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                Amount is entered positive; income vs. expense is carried by the type, matching how the rows
                already in the table are stored.
              </p>
            </div>
          )}

          {save.state === "saved" && (
            <p style={{ fontSize: 13, color: "var(--herd-green)", margin: "12px 0" }}>
              Posted — the table below is re-read from the database.
            </p>
          )}
          {save.state === "error" && (
            <div style={{ margin: "12px 0" }}>
              <p style={{ fontSize: 13, color: "var(--red)", marginBottom: 2 }}>Insert failed:</p>
              <p className="mono" style={{ fontSize: 13, color: "var(--red)" }}>
                {save.message}
              </p>
            </div>
          )}

          <div style={{ margin: "16px 0" }}>
            <Callout>
              <strong style={{ fontWeight: 500 }}>No "Attributed to" column yet.</strong> Nothing links a
              transaction to an animal in the schema today — that needs the migration in{" "}
              <code>docs/migrations/002-link-books-to-herd.sql</code>, which hasn't been run.
            </Callout>
          </div>

          <GridRow cols={COLS} as="header">
            <span>Date</span>
            <span>Description</span>
            <span>Category</span>
            <span>Type</span>
            <span>Account</span>
            <span className="text-right">Amount</span>
          </GridRow>

          {rows.map((t) => {
            const direction = directionOf(t);
            const sign = direction === "income" ? "+" : direction === "expense" ? "−" : "";
            return (
              <GridRow cols={COLS} as="body" className="mono" key={t.id}>
                <span>{t.date}</span>
                <span style={{ fontFamily: "var(--font-sans)" }}>{t.note || "—"}</span>
                <span>{t.category}</span>
                <span style={{ color: direction === "unknown" ? "var(--ochre)" : "var(--ink-muted)" }}>
                  {t.type || "(blank)"}
                  {direction === "unknown" && " ?"}
                </span>
                <span style={{ color: "var(--ink-muted)" }}>{t.account || "—"}</span>
                <span
                  className="text-right"
                  style={{
                    fontWeight: 500,
                    color:
                      direction === "expense" ? "var(--red)" : direction === "unknown" ? "var(--ochre)" : undefined,
                  }}
                >
                  {sign}
                  {money(Math.abs(Number(t.amount)))}
                </span>
              </GridRow>
            );
          })}

          {rows.length === 0 && (
            <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>
              No transactions recorded for {business?.name ?? "this business"}.
            </p>
          )}
        </>
      )}
    </OpsShell>
  );
}
