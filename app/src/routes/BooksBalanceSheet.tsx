import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, StatTile } from "../components/ui";
import { fetchBooksData, typeMap, type BooksData } from "../lib/books-data";
import { accountBalances } from "../lib/books-report";
import {
  addAsset,
  buildBalanceSheet,
  deleteAsset,
  fetchAssets,
  updateAsset,
  validateAsset,
  type AssetKind,
  type LedgerAsset,
} from "../lib/tax";
import { useWorkspace } from "../lib/workspace";
import "./books-taxes.css";

/**
 * What the business owns and owes.
 *
 * Cash is read from the account balances rather than entered by hand, so it
 * can't drift from the ledger. Everything else — a tractor, a loan — is
 * recorded here in herd-adjacent public.ledger_assets, which has carried a
 * `kind` of asset or liability since before this app and had no way in
 * until now.
 */

const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; books: BooksData; assets: LedgerAsset[] };

const COLS = "1fr 140px 90px";

export default function BooksBalanceSheet() {
  const { business } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState<AssetKind | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (businessId === null) {
      setLoad({ state: "ok", books: EMPTY_BOOKS, assets: [] });
      return;
    }
    const [books, assets] = await Promise.all([fetchBooksData(), fetchAssets(businessId)]);
    setLoad({ state: "ok", books, assets });
  }, [businessId]);

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

  const books = load.state === "ok" ? load.books : null;
  const assets = load.state === "ok" ? load.assets : EMPTY_ASSETS;
  const types = useMemo(() => typeMap(books?.types ?? []), [books?.types]);

  const balances = useMemo(() => {
    if (!books) return [];
    const accounts = books.accounts.filter((a) => a.business_id === businessId);
    const transactions = books.transactions.filter((t) => t.business_id === businessId);
    return accountBalances(accounts, transactions, types).map((b) => ({ account: b.account, balance: b.balance }));
  }, [books, businessId, types]);

  const sheet = useMemo(() => buildBalanceSheet(balances, assets), [balances, assets]);

  const problem = validateAsset({ name, value });

  const startAdd = (kind: AssetKind) => {
    setAdding(kind);
    setEditing(null);
    setName("");
    setValue("");
    setError(null);
  };

  const startEdit = (a: LedgerAsset) => {
    setEditing(a.id);
    setAdding(null);
    setName(a.name);
    setValue(String(a.value));
    setError(null);
  };

  const handleSave = async () => {
    if (problem || businessId === null) return;
    setBusy(true);
    setError(null);
    try {
      if (editing !== null) {
        await updateAsset(editing, { name, value: Number(value) });
      } else if (adding) {
        await addAsset({ businessId, kind: adding, name, value: Number(value) });
      }
      await refresh();
      setAdding(null);
      setEditing(null);
      setName("");
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (a: LedgerAsset) => {
    setBusy(true);
    setError(null);
    try {
      await deleteAsset(a.id);
      await refresh();
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <div className="order-form">
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        {editing !== null ? "Edit" : adding === "liability" ? "New liability" : "New asset"}
      </div>
      <div className="order-form__fields">
        <label style={{ fontSize: 13 }}>
          <div className="eyebrow">Name</div>
          <input
            className="order-select"
            value={name}
            placeholder={adding === "liability" ? "Equipment loan" : "Tractor"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          <div className="eyebrow">Value</div>
          <input
            className="order-select"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="filled" size="sm" disabled={busy || problem !== null} onClick={() => void handleSave()}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setAdding(null);
            setEditing(null);
          }}
        >
          Cancel
        </Button>
        {problem && <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{problem}</span>}
      </div>
    </div>
  );

  return (
    <OpsShell searchPlaceholder="An asset, a loan…">
      <PageHeader eyebrow={business ? `${business.name} · books` : "Books"} title="Balance sheet" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={money(sheet.assetTotal)} label="Assets" />
            <StatTile value={money(sheet.liabilityTotal)} label="Liabilities" />
            <StatTile value={money(sheet.equity)} label="Equity" />
            <StatTile value={money(sheet.cashTotal)} label="Cash at bank" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}

          {/* ── assets ── */}
          <div className="section__head" style={{ margin: "32px 0 12px" }}>
            <div className="serif" style={{ fontSize: 21 }}>
              Assets
            </div>
            <button type="button" className="link-button mono" onClick={() => startAdd("asset")}>
              + Add asset
            </button>
          </div>

          {adding === "asset" && form}

          <GridRow cols={COLS} as="header">
            <span>What</span>
            <span className="text-right">Value</span>
            <span className="text-right">Actions</span>
          </GridRow>

          {sheet.cash.map((c) => (
            <GridRow key={`cash-${c.account}`} cols={COLS} as="body">
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 15 }}>{c.account}</span>
                <span style={{ fontSize: 13, color: "var(--ink-muted)" }}> · from the ledger</span>
              </span>
              <span className="mono text-right" style={{ color: c.balance < 0 ? "var(--red)" : undefined }}>
                {money(c.balance)}
              </span>
              <span />
            </GridRow>
          ))}

          {sheet.otherAssets.map((a) =>
            editing === a.id ? (
              <div key={a.id}>{form}</div>
            ) : (
              <GridRow key={a.id} cols={COLS} as="body">
                <span style={{ fontSize: 15, minWidth: 0 }}>{a.name}</span>
                <span className="mono text-right">{money(Number(a.value))}</span>
                <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="link-button mono" onClick={() => startEdit(a)}>
                    edit
                  </button>
                  <button type="button" className="link-button mono" disabled={busy} onClick={() => void handleDelete(a)}>
                    remove
                  </button>
                </span>
              </GridRow>
            ),
          )}

          {sheet.cash.length === 0 && sheet.otherAssets.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", padding: "12px 8px" }}>
              Nothing recorded. Cash appears here from <Link to="/books/accounts">Accounts</Link>; add equipment,
              land or livestock with "Add asset".
            </p>
          )}

          <div className="tax-subtotal">
            <span>Total assets</span>
            <span className="mono">{money(sheet.assetTotal)}</span>
          </div>

          {/* ── liabilities ── */}
          <div className="section__head" style={{ margin: "32px 0 12px" }}>
            <div className="serif" style={{ fontSize: 21 }}>
              Liabilities
            </div>
            <button type="button" className="link-button mono" onClick={() => startAdd("liability")}>
              + Add liability
            </button>
          </div>

          {adding === "liability" && form}

          {sheet.liabilities.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", padding: "12px 8px" }}>
              Nothing owed on record. Add a mortgage, an equipment loan or an operating line — enter it as a positive
              amount and it's subtracted for you.
            </p>
          ) : (
            <>
              <GridRow cols={COLS} as="header">
                <span>What</span>
                <span className="text-right">Owed</span>
                <span className="text-right">Actions</span>
              </GridRow>
              {sheet.liabilities.map((a) =>
                editing === a.id ? (
                  <div key={a.id}>{form}</div>
                ) : (
                  <GridRow key={a.id} cols={COLS} as="body">
                    <span style={{ fontSize: 15, minWidth: 0 }}>{a.name}</span>
                    <span className="mono text-right">{money(Number(a.value))}</span>
                    <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" className="link-button mono" onClick={() => startEdit(a)}>
                        edit
                      </button>
                      <button
                        type="button"
                        className="link-button mono"
                        disabled={busy}
                        onClick={() => void handleDelete(a)}
                      >
                        remove
                      </button>
                    </span>
                  </GridRow>
                ),
              )}
            </>
          )}

          <div className="tax-subtotal">
            <span>Total liabilities</span>
            <span className="mono">{money(sheet.liabilityTotal)}</span>
          </div>

          <div className="tax-net">
            <span className="serif" style={{ fontSize: 19 }}>
              Equity
            </span>
            <span className="mono tax-net__value" style={{ color: sheet.equity < 0 ? "var(--red)" : undefined }}>
              {money(sheet.equity)}
            </span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <Callout>
              Assets and liabilities are values you keep current by hand — this isn't a depreciation register, so the
              value of a tractor is whatever you last recorded. Cash is the exception: it's read from the ledger, and
              an account already listed on <Link to="/books/accounts">Accounts</Link> is ignored if you also enter it
              as an asset, so the money can't be counted twice.
            </Callout>
          </div>
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_ASSETS: LedgerAsset[] = [];
const EMPTY_BOOKS: BooksData = {
  businesses: [],
  accounts: [],
  transactions: [],
  types: [],
  typesTableExists: true,
};
