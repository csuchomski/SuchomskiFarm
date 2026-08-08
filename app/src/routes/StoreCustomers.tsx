import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import {
  byCustomer,
  customerName,
  fetchCustomers,
  fetchOrders,
  type Customer,
  type RealOrder,
} from "../lib/orders";
import { addCustomer, hasLogin, isArchived, validateCustomer } from "../lib/customers";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";
import "./store-customer.css";

/**
 * Who buys, how much, and when they last came.
 *
 * Everyone with a profile is listed, including the farmer — they place
 * orders for themselves and four of the nine on file are theirs, so
 * filtering to role 'buyer' would hide the most frequent customer.
 */

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; orders: RealOrder[]; customers: Customer[] };

const COLS = "1fr 110px 90px 110px 110px";
const COLS_SM = "1fr 84px 84px";

export default function StoreCustomers() {
  const { business } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // Archived customers are off the list rather than gone. Kept behind a
  // toggle instead of a separate page: the reason to look for one is almost
  // always to put them back.
  const [showArchived, setShowArchived] = useState(false);

  // Adding someone who buys at the gate. They get no login — see
  // docs/migrations/026-customers-without-logins.sql for why that needed a
  // foreign key removed rather than a form.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (businessId === null) {
      setLoad({ state: "ok", orders: [], customers: [] });
      return;
    }
    const [orders, customers] = await Promise.all([fetchOrders(businessId), fetchCustomers()]);
    setLoad({ state: "ok", orders, customers });
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

  const orders = load.state === "ok" ? load.orders : EMPTY_ORDERS;
  const customers = load.state === "ok" ? load.customers : EMPTY_CUSTOMERS;

  const summaries = useMemo(() => byCustomer(orders), [orders]);
  const byId = useMemo(() => new Map(summaries.map((s) => [s.customerId, s])), [summaries]);

  // Everyone with a profile, ordered by spend — then the people who have
  // never ordered, so a new signup is visible rather than absent.
  const rows = useMemo(
    () =>
      customers
        .filter((c) => showArchived || !isArchived(c))
        .sort((a, b) => {
          const sa = byId.get(a.id);
          const sb = byId.get(b.id);
          return (sb?.spent ?? -1) - (sa?.spent ?? -1) || customerName(a).localeCompare(customerName(b));
        }),
    [customers, byId, showArchived],
  );

  const archivedCount = customers.filter(isArchived).length;

  const spending = summaries.reduce((s, r) => s + r.spent, 0);
  const buyers = summaries.filter((s) => s.orders > 0).length;

  return (
    <OpsShell searchPlaceholder="A customer…">
      <PageHeader
        eyebrow={business ? `${business.name} · store` : "Store"}
        title="Customers"
        actions={
          <Button
            variant="filled"
            disabled={load.state !== "ok"}
            onClick={() => {
              setAdding((v) => !v);
              setDraft({ first_name: "", last_name: "", email: "", phone: "" });
              setError(null);
              setNote(null);
            }}
          >
            {adding ? "Cancel" : "New customer"}
          </Button>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load customers: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={customers.length || "—"} label="Accounts" />
            <StatTile value={buyers || "—"} label="Have ordered" />
            <StatTile value={spending ? money(Math.round(spending * 100) / 100) : "—"} label="Lifetime takings" />
            <StatTile value={summaries.reduce((s, r) => s + r.openOrders, 0) || "—"} label="Open orders" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {adding && (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Someone who buys at the farm
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">First name</div>
                  <input
                    className="order-select"
                    value={draft.first_name}
                    aria-label="First name"
                    onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Last name</div>
                  <input
                    className="order-select"
                    value={draft.last_name}
                    aria-label="Last name"
                    onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Email (optional)</div>
                  <input
                    className="order-select"
                    value={draft.email}
                    aria-label="Email"
                    onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Phone (optional)</div>
                  <input
                    className="order-select"
                    value={draft.phone}
                    aria-label="Phone"
                    onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button
                  variant="filled"
                  size="sm"
                  disabled={busy || validateCustomer(draft) !== null}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    addCustomer(draft)
                      .then(async () => {
                        await refresh();
                        setAdding(false);
                        setNote(`Added ${`${draft.first_name} ${draft.last_name}`.trim() || draft.email}.`);
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? "Adding…" : "Add customer"}
                </Button>
                {validateCustomer(draft) && (
                  <span style={{ fontSize: 13, color: "var(--red)" }}>{validateCustomer(draft)}</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
                They won't be able to sign in — this is a name to reserve and record orders against, not an account.
                Someone who wants the shop signs up there themselves.
              </p>
            </div>
          )}

          {customers.length === 0 && !adding ? (
            <Callout>
              No customer accounts yet. Someone signing up through the <Link to="/shop">shop</Link> appears here.
            </Callout>
          ) : (
            <>
              {archivedCount > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 0 8px" }}>
                  <button type="button" className="link-button mono" onClick={() => setShowArchived((v) => !v)}>
                    {showArchived ? "hide archived" : `show ${archivedCount} archived`}
                  </button>
                </div>
              )}

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Customer</span>
                <span className="hide-sm">Role</span>
                <span className="text-right">Orders</span>
                <span className="text-right">Spent</span>
                <span className="text-right hide-sm">Last order</span>
              </GridRow>

              {rows.map((c) => {
                const s = byId.get(c.id);
                const shown = customerName(c);
                // For a customer with no name the heading is already their
                // email, so repeating it underneath just prints it twice.
                const contact = [shown === c.email ? null : c.email, c.phone].filter(Boolean).join(" · ");
                return (
                  <GridRow key={c.id} cols={COLS} mobileCols={COLS_SM} as="body" highlight={!s}>
                    <span style={{ minWidth: 0 }}>
                      <Link className="serif customer-link" style={{ fontSize: 17 }} to={`/store/customers/${c.id}`}>
                        {shown}
                      </Link>
                      {isArchived(c) && (
                        <>
                          {" "}
                          <Pill variant="outline">archived</Pill>
                        </>
                      )}
                      {!hasLogin(c) && (
                        <>
                          {" "}
                          <Pill variant="outline">no login</Pill>
                        </>
                      )}
                      <br />
                      <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {contact || `${c.role} · no other contact details`}
                      </span>
                    </span>
                    <span className="hide-sm">
                      <Pill variant={c.role === "farmer" ? "outline-green" : "outline"}>{c.role}</Pill>
                    </span>
                    <span className="mono text-right">
                      {s ? s.orders : "—"}
                      {s && s.openOrders > 0 && (
                        <span style={{ fontSize: 12, color: "var(--ink-muted)" }}> ({s.openOrders} open)</span>
                      )}
                    </span>
                    <span className="mono text-right">{s && s.spent > 0 ? money(s.spent) : "—"}</span>
                    <span className="mono text-right hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {s?.lastOrder ?? "never"}
                    </span>
                  </GridRow>
                );
              })}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                Click a name to see everything they've bought, edit their details, or take them off the list. Spend
                counts what was actually paid, so an order collected without payment shows as an order but not as
                takings. Manage the orders themselves on <Link to="/store/orders">Orders</Link>.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_ORDERS: RealOrder[] = [];
const EMPTY_CUSTOMERS: Customer[] = [];
