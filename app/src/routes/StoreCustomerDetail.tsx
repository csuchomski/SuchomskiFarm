import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchCustomers, fetchOrders, customerName, type Customer, type RealOrder } from "../lib/orders";
import { deleteCustomer, hasLogin, isArchived, setArchived, updateCustomer, validateCustomer } from "../lib/customers";
import { groupByDate, outstanding, type CustomerOrder } from "../lib/customer";
import { fetchStoreData, type ProductWithInventory } from "../lib/store-data";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";
import "./store-customer.css";

/**
 * One customer: who they are, what they've bought, and the two ways to take
 * them off the list.
 *
 * The purchase history is built with groupByDate and outstanding from
 * lib/customer.ts — the same functions the shop's Account tab uses. A
 * RealOrder carries every field a CustomerOrder needs, so the farmer is
 * looking at the customer's own history rather than a second rendering of it
 * that could drift.
 */

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dayLabel = (isoDay: string): string => {
  const d = new Date(`${isoDay}T12:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: sameYear ? "long" : undefined,
    day: "numeric",
    month: "long",
    year: sameYear ? undefined : "numeric",
  });
};

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; customer: Customer | null; orders: RealOrder[]; products: ProductWithInventory[] };

export default function StoreCustomerDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    if (businessId === null) {
      setLoad({ state: "ok", customer: null, orders: [], products: [] });
      return;
    }
    const [customers, orders, store] = await Promise.all([
      fetchCustomers(),
      fetchOrders(businessId),
      fetchStoreData({ businessId, farmId }),
    ]);
    setLoad({
      state: "ok",
      customer: customers.find((c) => c.id === id) ?? null,
      orders: orders.filter((o) => o.customer_id === id),
      products: store.products,
    });
  }, [businessId, farmId, id]);

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

  const customer = load.state === "ok" ? load.customer : null;
  const orders = load.state === "ok" ? load.orders : EMPTY_ORDERS;
  const products = load.state === "ok" ? load.products : EMPTY_PRODUCTS;

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const productName = (pid: number) => productById.get(pid)?.name ?? `Product ${pid}`;
  const productUnit = (pid: number) => productById.get(pid)?.unit ?? "";

  const collected = orders.filter((o) => o.picked_up_date);
  const open = orders.filter((o) => o.status === "reserved");
  // Lifetime figures: what they were billed, and what actually came in.
  const billed = round2(collected.reduce((s, o) => s + Number(o.total_cost ?? 0), 0));
  const paid = round2(collected.reduce((s, o) => s + Number(o.amount_paid ?? 0), 0));
  const owed = round2(
    collected.reduce((s, o) => {
      const gap = outstanding(o as CustomerOrder);
      return gap !== null && gap > 0 ? s + gap : s;
    }, 0),
  );

  const past = orders.filter((o) => o.picked_up_date || o.cancelled_date);
  const days = useMemo(() => groupByDate(past as CustomerOrder[]), [past]);

  const startEdit = (c: Customer) => {
    setForm({
      first_name: c.first_name ?? "",
      last_name: c.last_name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
    });
    setEditing(true);
    setError(null);
    setNote(null);
  };

  const problem = editing ? validateCustomer(form) : null;

  const handleSave = async () => {
    if (!customer || problem) return;
    setBusy(true);
    setError(null);
    try {
      await updateCustomer(customer.id, form);
      await refresh();
      setEditing(false);
      setNote("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async (archived: boolean) => {
    if (!customer) return;
    setBusy(true);
    setError(null);
    try {
      await setArchived(customer.id, archived);
      await refresh();
      setNote(
        archived
          ? "Archived. Every order they've placed is still on the books."
          : "Back on the active list.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!customer) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCustomer(customer.id);
      navigate("/store/customers");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <OpsShell searchPlaceholder="A customer…">
      <PageHeader
        eyebrow={
          <>
            <Link to="/store/customers">Customers</Link>
            {business ? ` · ${business.name}` : ""}
          </>
        }
        title={customer ? customerName(customer) : "Customer"}
        actions={
          customer && !editing ? (
            <Button variant="filled" onClick={() => startEdit(customer)}>
              Edit
            </Button>
          ) : undefined
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}
      {load.state === "ok" && !customer && (
        <Callout>
          No customer with that id in this business. They may have been removed — back to{" "}
          <Link to="/store/customers">Customers</Link>.
        </Callout>
      )}

      {customer && (
        <>
          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {isArchived(customer) && (
            <div style={{ margin: "12px 0" }}>
              <Callout>
                <strong style={{ fontWeight: 500 }}>Archived.</strong> They're off the active customer list and their
                history is untouched. Restore them below to put them back.
              </Callout>
            </div>
          )}

          <div className="stat-row">
            <StatTile value={collected.length || "—"} label="Orders collected" />
            <StatTile value={billed ? money(billed) : "—"} label="Lifetime purchases" />
            <StatTile value={paid ? money(paid) : "—"} label="Actually paid" />
            <StatTile value={owed ? money(owed) : "—"} label="Still owed" />
          </div>

          {/* ── who they are ── */}
          {editing ? (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Edit customer
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">First name</div>
                  <input
                    className="order-select"
                    value={form.first_name}
                    onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Last name</div>
                  <input
                    className="order-select"
                    value={form.last_name}
                    onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Email</div>
                  <input
                    className="order-select"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Phone</div>
                  <input
                    className="order-select"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="filled" size="sm" disabled={busy || problem !== null} onClick={() => void handleSave()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                {problem && <span style={{ fontSize: 13, color: "var(--red)" }}>{problem}</span>}
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
                {hasLogin(customer)
                  ? "The email here is for contact. It isn't what they sign in with — that lives with their login and can't be changed from the app."
                  : "They have no shop account, so none of this affects a login. A name or an email is enough; both are better."}
              </p>
            </div>
          ) : (
            <div className="customer-facts">
              <Fact label="Email" value={customer.email} />
              <Fact label="Phone" value={customer.phone ?? "—"} />
              <Fact
                label="Role"
                value={<Pill variant={customer.role === "farmer" ? "outline-green" : "outline"}>{customer.role}</Pill>}
              />
              <Fact
                label={hasLogin(customer) ? "Signed up" : "Added"}
                value={customer.created_at ? new Date(customer.created_at).toLocaleDateString() : "—"}
              />
              <Fact
                label="Shop account"
                value={
                  hasLogin(customer) ? (
                    "can sign in"
                  ) : (
                    <span style={{ color: "var(--ink-muted)" }}>none — added at the farm</span>
                  )
                }
              />
              <Fact label="Open orders" value={open.length === 0 ? "none" : String(open.length)} />
            </div>
          )}

          {/* ── what they've bought ── */}
          <div className="serif" style={{ fontSize: 21, margin: "32px 0 4px" }}>
            Purchase history
          </div>

          {days.length === 0 ? (
            <Callout>Nothing collected or cancelled yet.</Callout>
          ) : (
            days.map((day) => (
              <div className="customer-day" key={day.date}>
                <div className="customer-day__heading">
                  <span className="eyebrow">{dayLabel(day.date)}</span>
                  {day.total !== null && <span className="mono customer-day__total">{money(day.total)}</span>}
                </div>
                <GridRow cols={HIST_COLS} mobileCols={HIST_COLS_SM} as="header">
                  <span>Product</span>
                  <span className="text-right">Qty</span>
                  <span className="hide-sm">Paid by</span>
                  <span className="text-right">Total</span>
                </GridRow>
                {day.orders.map((o) => {
                  const gap = outstanding(o);
                  return (
                    <GridRow
                      key={o.id}
                      cols={HIST_COLS}
                      mobileCols={HIST_COLS_SM}
                      as="body"
                      highlight={Boolean(o.cancelled_date)}
                    >
                      <span style={{ minWidth: 0 }}>{productName(o.product_id)}</span>
                      <span className="mono text-right">
                        {o.quantity} {productUnit(o.product_id)}
                      </span>
                      <span className="hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {o.cancelled_date ? "cancelled" : (o.payment_method ?? "—")}
                      </span>
                      <span className="mono text-right">
                        {o.cancelled_date ? "—" : o.total_cost === null ? "—" : money(Number(o.total_cost))}
                        {gap !== null && gap > 0 && (
                          <div style={{ fontSize: 12, color: "var(--red)" }}>{money(gap)} owed</div>
                        )}
                      </span>
                    </GridRow>
                  );
                })}
              </div>
            ))
          )}

          {/* ── taking them off the list ── */}
          <div className="customer-danger">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Remove
            </div>
            {orders.length > 0 ? (
              <>
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                  {customerName(customer)} has {orders.length} order{orders.length === 1 ? "" : "s"} on file, so
                  deleting them would take the books with them. Archiving keeps every order and takes them off the
                  active list.
                </p>
                <Button size="sm" disabled={busy} onClick={() => void handleArchive(!isArchived(customer))}>
                  {isArchived(customer) ? "Restore" : "Archive"}
                </Button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                  They've never ordered, so there's nothing to keep. Deleting removes the profile — their sign-in
                  still exists, and signing in again would create a fresh one.
                </p>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Button size="sm" disabled={busy} onClick={() => void handleArchive(!isArchived(customer))}>
                    {isArchived(customer) ? "Restore" : "Archive"}
                  </Button>
                  {confirmDelete ? (
                    <>
                      <Button variant="filled" size="sm" disabled={busy} onClick={() => void handleDelete()}>
                        {busy ? "Deleting…" : "Yes, delete"}
                      </Button>
                      <Button size="sm" onClick={() => setConfirmDelete(false)}>
                        Keep them
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
                      Delete
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </OpsShell>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="customer-fact">
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 15 }}>{value}</div>
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const HIST_COLS = "1fr 110px 110px 120px";
const HIST_COLS_SM = "1fr 84px 84px";

const EMPTY_ORDERS: RealOrder[] = [];
const EMPTY_PRODUCTS: ProductWithInventory[] = [];
