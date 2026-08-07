import { useCallback, useEffect, useMemo, useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, StatTile } from "../components/ui";
import {
  addTransaction,
  addTransactionType,
  directionOf,
  fetchBooksData,
  summarise,
  typeMap,
  type BooksData,
  type Direction,
  type RealTransaction,
} from "../lib/books-data";
import { accountsForBusiness, defaultAccountFor } from "../lib/books-report";
import { categoriesFor, fetchTaxCategories, type TaxCategory } from "../lib/tax";
import { useWorkspace } from "../lib/workspace";
import "./books-transactions.css";

type Fetch = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BooksData };
type Save = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = "96px 1fr 140px 120px 120px 120px 110px";
/** Seven tracks need ~800px. On a phone a ledger line is a date, what it
 *  was, and how much — category, type, payer and account are detail you
 *  open the entry for. */
const COLS_SM = "72px 1fr 88px";

export default function BooksTransactions() {
  // The business is chosen once, in the topbar, and every screen follows it —
  // rather than Books keeping a second selector that could disagree with it.
  const { business } = useWorkspace();
  const businessId = business?.id ?? null;
  const [result, setResult] = useState<Fetch>({ state: "loading" });

  // Which business the *entry* is for. Defaults to the one you're viewing,
  // but an entry can be logged against any business you belong to — the
  // cheque book doesn't care which page you happened to be on.
  const [entryBusinessId, setEntryBusinessId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [save, setSave] = useState<Save>({ state: "idle" });
  const [date, setDate] = useState(todayIso);
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState("");
  const [payer, setPayer] = useState("");
  const [amount, setAmount] = useState("");

  // The schedule vocabulary for this business type, used to suggest
  // categories that map to a line. Absent before migration 018, in which
  // case the field simply falls back to plain free text.
  const [taxCategories, setTaxCategories] = useState<TaxCategory[]>([]);

  const [showNewType, setShowNewType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [newTypeDirection, setNewTypeDirection] = useState<Exclude<Direction, "unknown">>("expense");
  const [typeSave, setTypeSave] = useState<Save>({ state: "idle" });

  const load = useCallback(async () => {
    const data = await fetchBooksData();
    setResult({ state: "ok", data });
    return data;
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

  useEffect(() => {
    let cancelled = false;
    fetchTaxCategories()
      .then((c) => !cancelled && setTaxCategories(c))
      // Suggestions are a convenience; the page must still work without them.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const data = result.state === "ok" ? result.data : null;
  const types = useMemo(() => typeMap(data?.types ?? []), [data?.types]);
  const rows: RealTransaction[] = data ? data.transactions.filter((t) => t.business_id === businessId) : [];
  const totals = summarise(rows, types);

  // The entry follows the page unless you deliberately point it elsewhere,
  // and switching business in the topbar resets it — otherwise a half-typed
  // farm entry would quietly stay attached to the farm after you'd moved on.
  useEffect(() => {
    setEntryBusinessId(businessId);
  }, [businessId]);

  const entryBusiness = data?.businesses.find((b) => b.id === entryBusinessId) ?? null;

  // Accounts belong to a business. This was `data.accounts[0]` across every
  // business — sorted by name that is the rental account, which is what put
  // "5553 N Lyd Check" on a farm entry.
  const accountOptions = useMemo(
    () => (data ? accountsForBusiness(data.accounts, data.transactions, entryBusinessId) : []),
    [data, entryBusinessId],
  );

  // Re-default whenever the entry's business changes, rather than leaving
  // the previous business's account sitting in the field.
  useEffect(() => {
    if (!data) return;
    setAccount(defaultAccountFor(data.accounts, data.transactions, entryBusinessId));
  }, [data, entryBusinessId]);

  // Keyed on the direction of the type being entered, so an expense form
  // doesn't offer income lines — and on the *entry's* business type, so
  // logging a rental expense offers Schedule E's categories, not the farm's.
  const direction = types.get(type.trim())?.direction;
  const categoryOptions =
    direction === "income" || direction === "expense"
      ? categoriesFor(taxCategories, entryBusiness?.type ?? "", direction)
      : [];

  const amountNum = Number(amount);
  const canSave =
    entryBusinessId !== null &&
    date !== "" &&
    payer.trim() !== "" &&
    amount.trim() !== "" &&
    !Number.isNaN(amountNum) &&
    amountNum !== 0;

  const handleSave = async () => {
    if (!canSave || entryBusinessId === null) return;
    setSave({ state: "saving" });
    try {
      await addTransaction({
        businessId: entryBusinessId,
        date,
        type,
        category: category.trim() || "Uncategorised",
        amount: Math.abs(amountNum),
        note: note.trim() || null,
        payer: payer.trim(),
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

  const handleAddType = async () => {
    const label = newTypeLabel.trim();
    if (!label) return;
    setTypeSave({ state: "saving" });
    try {
      const created = await addTransactionType({
        code: label.toLowerCase().replace(/\s+/g, "_"),
        label,
        direction: newTypeDirection,
      });
      await load();
      setType(created.code);
      setNewTypeLabel("");
      setShowNewType(false);
      setTypeSave({ state: "idle" });
    } catch (err) {
      setTypeSave({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow={business ? `${business.name} · ${business.type}` : "Books"}
        title="Transactions"
        actions={
          <>
            <Button variant="filled" onClick={() => setShowForm((v) => !v)} disabled={!data || !businessId}>
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
            {totals.neutral > 0 && <StatTile value={money(totals.neutral)} label="Transfers" />}
            <StatTile value={rows.length} label="Entries" />
          </div>

          {totals.unknownTypes.length > 0 && (
            <div style={{ margin: "16px 0" }}>
              <Callout>
                <strong style={{ fontWeight: 500 }}>{money(totals.unknown)} isn't counted above.</strong>{" "}
                <span className="mono">{totals.unknownTypes.join(", ")}</span>{" "}
                {totals.unknownTypes.length === 1 ? "isn't a known type" : "aren't known types"}, so there's no way
                to tell which direction {totals.unknownTypes.length === 1 ? "it moves" : "they move"} the books.
                Add {totals.unknownTypes.length === 1 ? "it" : "them"} under Add entry → New type.
              </Callout>
            </div>
          )}

          {showForm && (
            <div className="entry-form">
              <div className="eyebrow" style={{ marginBottom: 10 }}>
                New entry
                {entryBusiness && entryBusiness.id !== businessId && " · for another business"}
              </div>
              <div className="entry-form__grid entry-form__grid--wide">
                {/* Which set of books this lands in. Defaults to the one
                    you're looking at; the picker is here because a cheque
                    written for the rental shouldn't need a page change to
                    record.

                    Labelled "Business for this entry" rather than
                    "Business": the topbar's switcher already owns that name,
                    and two controls sharing an accessible name on one page
                    is a real ambiguity for anyone navigating by label. */}
                <select
                  className="entry-form__field"
                  value={entryBusinessId ?? ""}
                  onChange={(e) => setEntryBusinessId(e.target.value === "" ? null : Number(e.target.value))}
                  aria-label="Business for this entry"
                >
                  {data.businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
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
                  onChange={(e) => {
                    if (e.target.value === "__new") setShowNewType(true);
                    else setType(e.target.value);
                  }}
                  aria-label="Type"
                >
                  {data.types
                    .filter((t) => t.active)
                    .map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.label}
                      </option>
                    ))}
                  <option value="__new">+ New type…</option>
                </select>
                <input
                  className="entry-form__field"
                  placeholder="Description"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                {/* A datalist rather than a select: every category the
                    schedule knows is offered, so entries land on a line by
                    default, but a category nobody anticipated can still be
                    typed. Anything unmatched shows up on Books → Taxes as
                    unmapped rather than being silently lost. */}
                <input
                  className="entry-form__field"
                  placeholder="Category"
                  list="tax-category-options"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <datalist id="tax-category-options">
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.label}>
                      {c.schedule_line ? `line ${c.schedule_line}` : ""}
                    </option>
                  ))}
                </datalist>
                <input
                  className="entry-form__field"
                  placeholder="Payer"
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                  aria-label="Payer"
                  required
                />
                {/* Only this business's accounts. Still a datalist rather
                    than a select so a new account name can be typed — but
                    the list no longer offers another business's. */}
                <input
                  className="entry-form__field"
                  placeholder="Account"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  list="ledger-accounts"
                />
                <datalist id="ledger-accounts">
                  {accountOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <input
                  className="entry-form__field mono"
                  placeholder="Amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button
                  className="entry-form__submit"
                  onClick={() => void handleSave()}
                  disabled={!canSave || save.state === "saving"}
                >
                  {save.state === "saving" ? "Saving…" : "Post entry"}
                </button>
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                Amount is entered positive; the type carries the direction. Payer is required — the column doesn't
                accept nulls.
              </p>

              {showNewType && (
                <div className="new-type-row">
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    New transaction type
                  </div>
                  {!data.typesTableExists ? (
                    <p style={{ fontSize: 13, color: "var(--ochre)" }}>
                      Types can't be added yet — <code>public.transaction_types</code> doesn't exist. Run{" "}
                      <code>docs/migrations/003-transaction-types-lookup.sql</code> first. Until then Income and
                      Expense are built in.
                    </p>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          className="entry-form__field"
                          placeholder="Name, e.g. Transfer"
                          value={newTypeLabel}
                          onChange={(e) => setNewTypeLabel(e.target.value)}
                          style={{ flex: 1, minWidth: 180 }}
                        />
                        <select
                          className="entry-form__field"
                          value={newTypeDirection}
                          onChange={(e) => setNewTypeDirection(e.target.value as Exclude<Direction, "unknown">)}
                          aria-label="Direction"
                        >
                          <option value="expense">Counts as an expense</option>
                          <option value="income">Counts as income</option>
                          <option value="neutral">Neither — excluded from Net</option>
                        </select>
                        <button
                          className="entry-form__submit"
                          onClick={() => void handleAddType()}
                          disabled={!newTypeLabel.trim() || typeSave.state === "saving"}
                        >
                          {typeSave.state === "saving" ? "Adding…" : "Add type"}
                        </button>
                        <Button size="sm" onClick={() => setShowNewType(false)}>
                          Cancel
                        </Button>
                      </div>
                      {typeSave.state === "error" && (
                        <p className="mono" style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }}>
                          {typeSave.message}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
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
              transaction to an animal in the schema today — that needs{" "}
              <code>docs/migrations/002-link-books-to-herd.sql</code>, which hasn't been run.
            </Callout>
          </div>

          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>Date</span>
            <span>Description</span>
            <span className="hide-sm">Category</span>
            <span className="hide-sm">Type</span>
            <span className="hide-sm">Payer</span>
            <span className="hide-sm">Account</span>
            <span className="text-right">Amount</span>
          </GridRow>

          {rows.map((t) => {
            const direction = directionOf(t, types);
            const sign = direction === "income" ? "+" : direction === "expense" ? "−" : "";
            const label = types.get(t.type.trim())?.label ?? t.type ?? "(blank)";
            return (
              <GridRow cols={COLS} mobileCols={COLS_SM} as="body" className="mono" key={t.id}>
                <span>{t.date}</span>
                <span style={{ fontFamily: "var(--font-sans)" }}>{t.note || "—"}</span>
                <span className="hide-sm">{t.category}</span>
                <span
                  className="hide-sm"
                  style={{ color: direction === "unknown" ? "var(--ochre)" : "var(--ink-muted)" }}
                >
                  {label}
                  {direction === "unknown" && " ?"}
                </span>
                <span className="hide-sm" style={{ color: "var(--ink-muted)" }}>{t.payer || "—"}</span>
                <span className="hide-sm" style={{ color: "var(--ink-muted)" }}>{t.account || "—"}</span>
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
