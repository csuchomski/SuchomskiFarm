import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, GridRow, Pill, StatTile } from "../components/ui";
import {
  byCustomer,
  customerName,
  fetchCustomers,
  fetchOrders,
  type Customer,
  type RealOrder,
} from "../lib/orders";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";

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

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    (async () => {
      if (businessId === null) {
        setLoad({ state: "ok", orders: [], customers: [] });
        return;
      }
      const [orders, customers] = await Promise.all([fetchOrders(businessId), fetchCustomers()]);
      if (!cancelled) setLoad({ state: "ok", orders, customers });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const orders = load.state === "ok" ? load.orders : EMPTY_ORDERS;
  const customers = load.state === "ok" ? load.customers : EMPTY_CUSTOMERS;

  const summaries = useMemo(() => byCustomer(orders), [orders]);
  const byId = useMemo(() => new Map(summaries.map((s) => [s.customerId, s])), [summaries]);

  // Everyone with a profile, ordered by spend — then the people who have
  // never ordered, so a new signup is visible rather than absent.
  const rows = useMemo(
    () =>
      [...customers].sort((a, b) => {
        const sa = byId.get(a.id);
        const sb = byId.get(b.id);
        return (sb?.spent ?? -1) - (sa?.spent ?? -1) || customerName(a).localeCompare(customerName(b));
      }),
    [customers, byId],
  );

  const spending = summaries.reduce((s, r) => s + r.spent, 0);
  const buyers = summaries.filter((s) => s.orders > 0).length;

  return (
    <OpsShell searchPlaceholder="A customer…">
      <PageHeader eyebrow={business ? `${business.name} · store` : "Store"} title="Customers" />

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

          {customers.length === 0 ? (
            <Callout>
              No customer accounts yet. Someone signing up through the <Link to="/shop">shop</Link> appears here.
            </Callout>
          ) : (
            <>
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
                      <span className="serif" style={{ fontSize: 17 }}>
                        {shown}
                      </span>
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
                Spend counts what was actually paid, so an order collected without payment shows as an order but not
                as takings. Manage the orders themselves on <Link to="/store/orders">Orders</Link>.
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
