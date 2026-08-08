import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchBooksData, typeMap, type BooksData } from "../lib/books-data";
import { accountBalances } from "../lib/books-report";
import { createAccount, deleteAccount, saveAccount, validateAccount, type AccountDraft } from "../lib/ledger-accounts";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";
import "./books-accounts.css";

/**
 * Where the money is: one line per account, opening balance plus everything
 * posted to it — and the place accounts are created, renamed and removed.
 *
 * Accounts are matched to transactions by name rather than by id, because
 * ledger_transactions.account is text. See accountBalances for what that
 * costs and how an unlisted account is handled; lib/ledger-accounts.ts for
 * what it costs a rename.
 */

const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: BooksData };

const COLS = "1fr 130px 130px 90px 130px";
const COLS_SM = "1fr 100px 100px";

const EMPTY_DRAFT: AccountDraft = { name: "", openingBalance: "" };

export default function BooksAccounts() {
  const { business } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<AccountDraft>(EMPTY_DRAFT);

  /** The id of the account being edited, and what it's being edited to. */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<AccountDraft>(EMPTY_DRAFT);

  const [removingId, setRemovingId] = useState<number | null>(null);
  const [reassignTo, setReassignTo] = useState("");

  const refresh = useCallback(async () => {
    setLoad({ state: "ok", data: await fetchBooksData() });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    refresh().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

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

  // The unique constraint is global, so a clash has to be checked against
  // every business's accounts and not just this one's.
  const takenNames = useMemo(() => (data ? data.accounts.map((a) => a.name) : []), [data]);
  const idByName = useMemo(() => new Map(accounts.map((a) => [a.name.trim(), a.id])), [accounts]);

  const newProblem = adding ? validateAccount({ draft: newDraft, takenNames }) : null;
  const editingAccount = accounts.find((a) => a.id === editingId) ?? null;
  const editProblem = editingAccount
    ? validateAccount({ draft: editDraft, takenNames, currentName: editingAccount.name })
    : null;

  const act = async (what: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      await refresh();
      setNote(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startAdd = (name = "") => {
    setAdding(true);
    setEditingId(null);
    setRemovingId(null);
    setNewDraft({ name, openingBalance: "" });
    setError(null);
    setNote(null);
  };

  const startEdit = (id: number, name: string, opening: number) => {
    setEditingId(id);
    setAdding(false);
    setRemovingId(null);
    setEditDraft({ name, openingBalance: String(opening) });
    setError(null);
    setNote(null);
  };

  return (
    <OpsShell searchPlaceholder="An account…">
      <PageHeader
        eyebrow={business ? `${business.name} · books` : "Books"}
        title="Accounts"
        actions={
          <Button
            variant="filled"
            disabled={load.state !== "ok"}
            onClick={() => (adding ? setAdding(false) : startAdd())}
          >
            {adding ? "Cancel" : "New account"}
          </Button>
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
          <div className="stat-row">
            <StatTile value={rows.length || "—"} label="Accounts" />
            <StatTile value={rows.length ? money(Math.round(total * 100) / 100) : "—"} label="Total balance" />
            <StatTile value={transactions.length || "—"} label="Entries posted" />
            <StatTile value={unlisted.length || "—"} label="Unlisted accounts" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {adding && (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                New account for {business?.name ?? "this business"}
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Name</div>
                  <input
                    className="order-select"
                    value={newDraft.name}
                    aria-label="Account name"
                    onChange={(e) => setNewDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Opening balance</div>
                  <input
                    className="order-select"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={newDraft.openingBalance}
                    aria-label="Opening balance"
                    onChange={(e) => setNewDraft((d) => ({ ...d, openingBalance: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button
                  variant="filled"
                  size="sm"
                  disabled={busy || newProblem !== null}
                  onClick={() =>
                    void act(async () => {
                      await createAccount({ draft: newDraft, businessId });
                      setAdding(false);
                      setNewDraft(EMPTY_DRAFT);
                    }, `Added ${newDraft.name.trim()}.`)
                  }
                >
                  {busy ? "Adding…" : "Add account"}
                </Button>
                {newProblem && <span style={{ fontSize: 13, color: "var(--red)" }}>{newProblem}</span>}
              </div>
            </div>
          )}

          {rows.length === 0 && !adding ? (
            <Callout>
              No accounts for this business yet, and nothing posted against one. Add one above, or name an account on{" "}
              <Link to="/books/transactions">Transactions</Link> and it'll appear here.
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

              {rows.map((r) => {
                const id = idByName.get(r.account) ?? null;
                return (
                  <div key={r.account}>
                    <GridRow cols={COLS} mobileCols={COLS_SM} as="body" highlight={r.unlisted}>
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
                        <br />
                        {/* An unlisted account has no row to edit — the offer
                            is to give it one, pre-filled with the name the
                            transactions already use. */}
                        {r.unlisted ? (
                          <button type="button" className="link-button mono" onClick={() => startAdd(r.account)}>
                            add as an account
                          </button>
                        ) : (
                          id !== null && (
                            <span style={{ display: "inline-flex", gap: 10 }}>
                              <button
                                type="button"
                                className="link-button mono"
                                onClick={() => startEdit(id, r.account, r.opening)}
                              >
                                edit
                              </button>
                              <button
                                type="button"
                                className="link-button mono"
                                onClick={() => {
                                  setRemovingId(removingId === id ? null : id);
                                  setEditingId(null);
                                  setReassignTo("");
                                  setError(null);
                                }}
                              >
                                remove
                              </button>
                            </span>
                          )
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

                    {editingId === id && id !== null && (
                      <div className="account-panel">
                        <div className="account-panel__fields">
                          <label style={{ fontSize: 13 }}>
                            <div className="eyebrow">Name</div>
                            <input
                              className="order-select"
                              value={editDraft.name}
                              aria-label={`Rename ${r.account}`}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                            />
                          </label>
                          <label style={{ fontSize: 13 }}>
                            <div className="eyebrow">Opening balance</div>
                            <input
                              className="order-select"
                              type="number"
                              step="0.01"
                              inputMode="decimal"
                              value={editDraft.openingBalance}
                              aria-label={`Opening balance for ${r.account}`}
                              onChange={(e) => setEditDraft((d) => ({ ...d, openingBalance: e.target.value }))}
                            />
                          </label>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <Button
                            variant="filled"
                            size="sm"
                            disabled={busy || editProblem !== null}
                            onClick={() =>
                              void act(async () => {
                                await saveAccount({ id, currentName: r.account, draft: editDraft });
                                setEditingId(null);
                              }, `Saved ${editDraft.name.trim()}.`)
                            }
                          >
                            {busy ? "Saving…" : "Save"}
                          </Button>
                          <Button size="sm" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                          <span style={{ fontSize: 13, color: editProblem ? "var(--red)" : "var(--ink-muted)" }}>
                            {editProblem ??
                              (r.entries > 0 && editDraft.name.trim() !== r.account
                                ? `Renaming moves ${r.entries} entr${r.entries === 1 ? "y" : "ies"} with it.`
                                : "Names are unique across every business.")}
                          </span>
                        </div>
                      </div>
                    )}

                    {removingId === id && id !== null && (
                      <div className="account-panel">
                        {r.entries > 0 ? (
                          <>
                            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                              {r.entries} entr{r.entries === 1 ? "y is" : "ies are"} posted to {r.account}. They have
                              to go somewhere — the money stays in the books either way, but leaving them pointing at
                              an account that no longer exists would drop its opening balance from the totals.
                            </p>
                            <div className="account-panel__fields">
                              <label style={{ fontSize: 13 }}>
                                <div className="eyebrow">Move the entries to</div>
                                <select
                                  className="order-select"
                                  value={reassignTo}
                                  aria-label={`Move entries from ${r.account} to`}
                                  onChange={(e) => setReassignTo(e.target.value)}
                                >
                                  <option value="">Pick an account…</option>
                                  {accounts
                                    .filter((a) => a.id !== id)
                                    .map((a) => (
                                      <option key={a.id} value={a.name}>
                                        {a.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            </div>
                          </>
                        ) : (
                          <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                            Nothing is posted to {r.account}, so removing it changes no figure.
                          </p>
                        )}
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <Button
                            variant="filled"
                            size="sm"
                            disabled={busy || (r.entries > 0 && reassignTo === "")}
                            onClick={() =>
                              void act(async () => {
                                await deleteAccount(id, r.entries > 0 ? reassignTo : null);
                                setRemovingId(null);
                              }, r.entries > 0 ? `Removed ${r.account}; its entries are on ${reassignTo}.` : `Removed ${r.account}.`)
                            }
                          >
                            {busy ? "Removing…" : "Remove account"}
                          </Button>
                          <Button size="sm" onClick={() => setRemovingId(null)}>
                            Keep it
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {unlisted.length > 0 && (
                <div style={{ paddingTop: 16 }}>
                  <Callout>
                    {unlisted.length === 1 ? "One account is" : `${unlisted.length} accounts are`} named only by
                    transactions — there's no <code>ledger_accounts</code> row for{" "}
                    {unlisted.map((r) => r.account).join(", ")} under this business, so{" "}
                    {unlisted.length === 1 ? "its" : "their"} opening balance is taken as zero. The live "Venmo" row
                    has no business attached, which is how this happens. "Add as an account" gives{" "}
                    {unlisted.length === 1 ? "it" : "them"} a row here.
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
