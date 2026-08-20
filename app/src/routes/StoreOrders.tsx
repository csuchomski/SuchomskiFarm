import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchStoreData, type ProductWithInventory } from "../lib/store-data";
import {
  cancelOrder,
  completePickup,
  customerName,
  customerShort,
  daysWaiting,
  expectedValue,
  fetchCustomers,
  fetchOrders,
  isOpen,
  reserveFor,
  totalsOf,
  validatePickup,
  validateReserve,
  type Customer,
  type RealOrder,
} from "../lib/orders";
import { fetchPaymentMethods, methodCodes, type PaymentMethodOption } from "../lib/payment-methods";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";

/**
 * Orders: what's promised, handing it over, and what came in.
 *
 * Every write goes through a database function rather than an update — see
 * lib/orders.ts. Completing a pickup in particular does five things at once
 * (releases the shortfall, consumes batches oldest-first, prices the order,
 * records payment, splits proceeds across the animals that supplied it), and
 * the customer store already calls the same function.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      orders: RealOrder[];
      customers: Customer[];
      products: ProductWithInventory[];
      methods: PaymentMethodOption[];
    };

const OPEN_COLS = "1fr 130px 96px 110px 150px";
const OPEN_COLS_SM = "1fr 74px 96px";

const DONE_COLS = "100px 1fr 120px 96px 110px 110px";
const DONE_COLS_SM = "84px 1fr 84px";

export default function StoreOrders() {
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // Handing an order over.
  const [pickingUp, setPickingUp] = useState<number | null>(null);
  const [finalQuantity, setFinalQuantity] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [amountPaid, setAmountPaid] = useState("");

  // Reserving on someone's behalf.
  const [reserving, setReserving] = useState(false);
  const [resCustomer, setResCustomer] = useState("");
  const [resProduct, setResProduct] = useState("");
  const [resQuantity, setResQuantity] = useState("");

  const refresh = useCallback(async () => {
    if (businessId === null) {
      setLoad({ state: "ok", orders: [], customers: [], products: [], methods: await fetchPaymentMethods() });
      return;
    }
    const [orders, customers, store, methods] = await Promise.all([
      fetchOrders(businessId),
      fetchCustomers(businessId),
      fetchStoreData({ businessId, farmId }),
      fetchPaymentMethods(),
    ]);
    setLoad({ state: "ok", orders, customers, products: store.products, methods });
  }, [businessId, farmId]);

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
  const products = load.state === "ok" ? load.products : EMPTY_PRODUCTS;
  const methods = load.state === "ok" ? load.methods : EMPTY_METHODS;

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const open = orders.filter(isOpen);
  const done = orders.filter((o) => !isOpen(o));
  const totals = totalsOf(orders);
  const today = todayIso();

  const pickupOrder = open.find((o) => o.id === pickingUp) ?? null;
  const pickupProblem = pickupOrder
    ? validatePickup({ order: pickupOrder, finalQuantity, paymentMethod, amountPaid, allowed: methodCodes(methods) })
    : null;

  const resProductRow = products.find((p) => String(p.id) === resProduct);
  const reserveProblem = validateReserve({
    productId: resProduct,
    quantity: resQuantity,
    customerId: resCustomer,
    available: resProductRow?.openToShop ?? 0,
  });

  const startPickup = (o: RealOrder) => {
    setPickingUp(o.id);
    // Pre-filled with the full order, which is what usually happens; the
    // short-pickup case is a correction, not the default.
    setFinalQuantity(String(o.quantity));
    // First on the list rather than the literal "Cash", so a farm that
    // retires it doesn't get a dropdown pre-set to something the database
    // will refuse.
    setPaymentMethod(methods[0]?.code ?? "");
    const price = productById.get(o.product_id)?.price;
    setAmountPaid(price === null || price === undefined ? "" : String(expectedValue(o, price) ?? ""));
    setError(null);
    setNote(null);
  };

  const handlePickup = async () => {
    if (!pickupOrder || pickupProblem) return;
    setBusy(true);
    setError(null);
    try {
      await completePickup({
        orderId: pickupOrder.id,
        finalQuantity: Number(finalQuantity),
        paymentMethod: paymentMethod === "" ? null : paymentMethod,
        amountPaid: amountPaid.trim() === "" ? null : Number(amountPaid),
      });
      await refresh();
      setPickingUp(null);
      setNote(`Order ${pickupOrder.id} collected.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (o: RealOrder) => {
    setBusy(true);
    setError(null);
    try {
      await cancelOrder(o.id);
      await refresh();
      setPickingUp(null);
      setNote(`Order ${o.id} cancelled — the stock is back on the shelf.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleReserve = async () => {
    if (reserveProblem) return;
    setBusy(true);
    setError(null);
    try {
      const id = await reserveFor({
        productId: Number(resProduct),
        quantity: Number(resQuantity),
        customerId: resCustomer,
      });
      await refresh();
      setReserving(false);
      setResQuantity("");
      setNote(`Order ${id} reserved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OpsShell searchPlaceholder="An order, a customer…">
      <PageHeader
        eyebrow={business ? `${business.name} · store` : "Store"}
        title="Orders"
        actions={
          <Button
            variant="filled"
            disabled={load.state !== "ok" || businessId === null}
            onClick={() => {
              setReserving((v) => !v);
              setPickingUp(null);
              setError(null);
            }}
          >
            {reserving ? "Cancel" : "Reserve for someone"}
          </Button>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load orders: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={totals.open || "—"} label="Waiting for pickup" />
            <StatTile value={totals.openQuantity || "—"} label="Units promised" />
            <StatTile value={totals.takings ? money(totals.takings) : "—"} label="Taken so far" />
            <StatTile value={totals.owed ? money(totals.owed) : "—"} label="Still owed" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {reserving && (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Reserve on a customer's behalf
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Customer</div>
                  <select className="order-select" value={resCustomer} onChange={(e) => setResCustomer(e.target.value)}>
                    <option value="">Pick a customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {customerName(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Product</div>
                  <select className="order-select" value={resProduct} onChange={(e) => setResProduct(e.target.value)}>
                    <option value="">Pick a product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name} — {p.openToShop} {p.unit} free
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Quantity</div>
                  <input
                    className="order-select"
                    type="number"
                    min="0"
                    step="0.001"
                    inputMode="decimal"
                    value={resQuantity}
                    onChange={(e) => setResQuantity(e.target.value)}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="filled" size="sm" disabled={busy || reserveProblem !== null} onClick={() => void handleReserve()}>
                  {busy ? "Reserving…" : "Reserve"}
                </Button>
                {reserveProblem && <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{reserveProblem}</span>}
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
                This holds the stock the same way the shop does — it won't sell what's already promised to a weekly
                schedule.
              </p>
            </div>
          )}

          {/* ── waiting for pickup ── */}
          <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
            Waiting for pickup
          </div>

          {open.length === 0 ? (
            <Callout>
              Nothing is waiting to be collected. Reservations made in the <Link to="/shop">shop</Link> appear here,
              and you can add one yourself with "Reserve for someone".
            </Callout>
          ) : (
            <>
              <GridRow cols={OPEN_COLS} mobileCols={OPEN_COLS_SM} as="header">
                <span>Customer · product</span>
                <span className="hide-sm">Reserved</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Value</span>
                <span className="text-right">Actions</span>
              </GridRow>

              {open.map((o) => {
                const c = customerById.get(o.customer_id);
                const p = productById.get(o.product_id);
                const waiting = daysWaiting(o, today);
                const value = expectedValue(o, p?.price);
                return (
                  <div key={o.id}>
                    <GridRow cols={OPEN_COLS} mobileCols={OPEN_COLS_SM} as="body">
                      <span style={{ minWidth: 0 }}>
                        <span className="serif" style={{ fontSize: 17 }}>
                          {customerName(c)}
                        </span>
                        <br />
                        <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                          {p?.name ?? `Product ${o.product_id}`} · order {o.id}
                        </span>
                      </span>
                      <span className="hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {waiting === null ? "—" : waiting === 0 ? "today" : `${waiting} day${waiting === 1 ? "" : "s"} ago`}
                        {waiting !== null && waiting >= 7 && (
                          <>
                            {" "}
                            <Pill variant="outline">stale</Pill>
                          </>
                        )}
                      </span>
                      <span className="mono text-right">
                        {o.quantity} {p?.unit ?? ""}
                      </span>
                      <span className="mono text-right">{value === null ? "—" : money(value)}</span>
                      <span style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button type="button" className="link-button mono" onClick={() => startPickup(o)}>
                          picked up
                        </button>
                        <button type="button" className="link-button mono" disabled={busy} onClick={() => void handleCancel(o)}>
                          cancel
                        </button>
                      </span>
                    </GridRow>

                    {pickingUp === o.id && (
                      <div className="pickup-row">
                        <label style={{ fontSize: 13 }}>
                          <div className="eyebrow">Collected</div>
                          <input
                            className="order-select"
                            style={{ width: 100 }}
                            type="number"
                            min="0"
                            max={o.quantity}
                            step="0.001"
                            inputMode="decimal"
                            value={finalQuantity}
                            onChange={(e) => setFinalQuantity(e.target.value)}
                          />
                        </label>
                        <label style={{ fontSize: 13 }}>
                          <div className="eyebrow">Paid by</div>
                          <select
                            className="order-select"
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value)}
                          >
                            <option value="">Not paid</option>
                            {methods.map((m) => (
                              <option key={m.code} value={m.code}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ fontSize: 13 }}>
                          <div className="eyebrow">Amount</div>
                          <input
                            className="order-select"
                            style={{ width: 110 }}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="—"
                            value={amountPaid}
                            onChange={(e) => setAmountPaid(e.target.value)}
                          />
                        </label>
                        <Button variant="filled" size="sm" disabled={busy || pickupProblem !== null} onClick={() => void handlePickup()}>
                          {busy ? "Saving…" : "Complete"}
                        </Button>
                        <Button size="sm" onClick={() => setPickingUp(null)}>
                          Cancel
                        </Button>
                        <span style={{ fontSize: 13, color: pickupProblem ? "var(--red)" : "var(--ink-muted)", flexBasis: "100%" }}>
                          {pickupProblem ??
                            (Number(finalQuantity) < Number(o.quantity)
                              ? `Short pickup — ${Math.round((Number(o.quantity) - Number(finalQuantity)) * 1000) / 1000} ${p?.unit ?? ""} goes back on the shelf.`
                              : "Leave the amount blank to record a collection with no payment.")}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* ── history ── */}
          {done.length > 0 && (
            <>
              <div className="section__head" style={{ margin: "32px 0 12px" }}>
                <div className="serif" style={{ fontSize: 21 }}>
                  Finished
                  <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}> · {done.length}</span>
                </div>
                <button type="button" className="link-button mono" onClick={() => setShowDone((v) => !v)}>
                  {showDone ? "hide" : "show"}
                </button>
              </div>

              {showDone && (
                <>
                  <GridRow cols={DONE_COLS} mobileCols={DONE_COLS_SM} as="header">
                    <span>Date</span>
                    <span>Customer · product</span>
                    <span className="hide-sm">Status</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Total</span>
                    <span className="text-right hide-sm">Paid</span>
                  </GridRow>
                  {done.map((o) => {
                    const c = customerById.get(o.customer_id);
                    const p = productById.get(o.product_id);
                    const when = (o.picked_up_date ?? o.cancelled_date ?? o.reserved_date)?.slice(0, 10) ?? "—";
                    return (
                      <GridRow key={o.id} cols={DONE_COLS} mobileCols={DONE_COLS_SM} as="body" highlight={o.status === "cancelled"}>
                        <span className="mono" style={{ fontSize: 13 }}>
                          {when}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 15 }}>{customerShort(c)}</span>
                          <span style={{ fontSize: 13, color: "var(--ink-muted)" }}> · {p?.name ?? o.product_id}</span>
                        </span>
                        <span className="hide-sm">
                          <Pill variant={o.status === "completed" ? "outline-green" : "outline"}>{o.status}</Pill>
                        </span>
                        <span className="mono text-right">{o.quantity}</span>
                        <span className="mono text-right">{o.total_cost === null ? "—" : money(Number(o.total_cost))}</span>
                        <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
                          {o.amount_paid === null ? "—" : `${money(Number(o.amount_paid))}${o.payment_method ? ` ${o.payment_method}` : ""}`}
                        </span>
                      </GridRow>
                    );
                  })}
                </>
              )}
            </>
          )}

          <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 24 }}>
            Stock comes from <Link to="/store/products">Store → Products</Link>. Completing a pickup consumes the
            oldest batches first and prices the order from the product's current price.
          </p>
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_ORDERS: RealOrder[] = [];
const EMPTY_CUSTOMERS: Customer[] = [];
const EMPTY_PRODUCTS: ProductWithInventory[] = [];
const EMPTY_METHODS: PaymentMethodOption[] = [];
