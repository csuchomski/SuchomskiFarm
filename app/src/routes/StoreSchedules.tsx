import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchStoreData, type ProductWithInventory } from "../lib/store-data";
import { customerName, fetchCustomers, type Customer } from "../lib/orders";
import {
  cancelSchedule,
  createSchedule,
  fetchSchedules,
  fulfilPickup,
  HOLD_DAYS,
  isActive,
  isHeld,
  nextPickup,
  resumeSchedule,
  skipWeek,
  untilLabel,
  validateSchedule,
  WEEKDAYS,
  type Schedule,
  type Weekday,
} from "../lib/schedules";
import { weeklyCommitment } from "../lib/forecast";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";

/**
 * Standing weekly orders — the subscription side of the store.
 *
 * A pickup inside the hold window has already taken its stock out of what
 * the shop can sell, so those rows are marked: that's the difference between
 * "promised eventually" and "spoken for now".
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; schedules: Schedule[]; customers: Customer[]; products: ProductWithInventory[] };

const COLS = "1fr 120px 100px 120px 160px";
const COLS_SM = "1fr 88px 96px";

export default function StoreSchedules() {
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const [adding, setAdding] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [day, setDay] = useState<string>("Thursday");
  const [startDate, setStartDate] = useState("");

  const refresh = useCallback(async () => {
    if (businessId === null) {
      setLoad({ state: "ok", schedules: [], customers: [], products: [] });
      return;
    }
    const [schedules, customers, store] = await Promise.all([
      fetchSchedules(businessId),
      fetchCustomers(businessId),
      fetchStoreData({ businessId, farmId }),
    ]);
    setLoad({ state: "ok", schedules, customers, products: store.products });
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

  const schedules = load.state === "ok" ? load.schedules : EMPTY_SCHEDULES;
  const customers = load.state === "ok" ? load.customers : EMPTY_CUSTOMERS;
  const products = load.state === "ok" ? load.products : EMPTY_PRODUCTS;

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const today = todayIso();

  const active = schedules.filter(isActive);
  const cancelledCount = schedules.length - active.length;
  const visible = showCancelled ? schedules : active;

  const held = active.filter((s) => isHeld(s, today));
  const heldUnits = held.reduce((sum, s) => sum + Number(s.quantity), 0);

  const problem = validateSchedule({ productId, customerId, quantity, day, startDate, todayIso: today });

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      if (message) setNote(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    act(async () => {
      if (businessId === null || problem) return;
      await createSchedule({
        businessId,
        customerId,
        productId: Number(productId),
        quantity: Number(quantity),
        day: day as Weekday,
        startDate: startDate || null,
      });
      setAdding(false);
      setQuantity("");
    }, "Standing order created.");

  return (
    <OpsShell searchPlaceholder="A customer, a day…">
      <PageHeader
        eyebrow={business ? `${business.name} · store` : "Store"}
        title="Schedules"
        actions={
          <Button
            variant="filled"
            disabled={load.state !== "ok" || businessId === null}
            onClick={() => {
              setAdding((v) => !v);
              setError(null);
            }}
          >
            {adding ? "Cancel" : "New standing order"}
          </Button>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={active.length || "—"} label="Standing orders" />
            <StatTile value={held.length || "—"} label={`Due within ${HOLD_DAYS} days`} />
            <StatTile value={heldUnits || "—"} label="Units held back" />
            <StatTile
              value={products.reduce((s, p) => s + weeklyCommitment(active, p.id), 0) || "—"}
              label="Promised weekly"
            />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {adding && (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                New standing order
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Customer</div>
                  <select className="order-select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
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
                  <select className="order-select" value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">Pick a product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Every</div>
                  <select className="order-select" value={day} onChange={(e) => setDay(e.target.value)}>
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
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
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Starting (optional)</div>
                  <input
                    className="order-select"
                    type="date"
                    min={today}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="filled" size="sm" disabled={busy || problem !== null} onClick={() => void handleCreate()}>
                  {busy ? "Saving…" : "Create"}
                </Button>
                {problem && <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{problem}</span>}
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
                This repeats every week until it's cancelled. Stock is only held back once a pickup is within{" "}
                {HOLD_DAYS} days — before that it stays available in the shop.
              </p>
            </div>
          )}

          {active.length === 0 && !adding ? (
            <Callout>
              No standing orders yet. A customer can start one from the <Link to="/shop">shop</Link>, or you can add
              one here on their behalf.
            </Callout>
          ) : (
            <>
              <div className="section__head" style={{ margin: "32px 0 12px" }}>
                <div className="serif" style={{ fontSize: 21 }}>
                  Weekly pickups
                </div>
                {cancelledCount > 0 && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={showCancelled}
                      onChange={(e) => setShowCancelled(e.target.checked)}
                    />
                    Show {cancelledCount} cancelled
                  </label>
                )}
              </div>

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Customer · product</span>
                <span className="hide-sm">Every</span>
                <span className="text-right">Qty</span>
                <span>Next</span>
                <span className="text-right">Actions</span>
              </GridRow>

              {visible.map((s) => {
                const c = customerById.get(s.customer_id);
                const p = productById.get(s.product_id);
                const next = nextPickup(s, today);
                const holding = isHeld(s, today);
                const cancelled = !isActive(s);
                return (
                  <GridRow key={s.id} cols={COLS} mobileCols={COLS_SM} as="body" highlight={cancelled}>
                    <span style={{ minWidth: 0 }}>
                      <span className="serif" style={{ fontSize: 17 }}>
                        {customerName(c)}
                      </span>
                      <br />
                      <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {p?.name ?? `Product ${s.product_id}`}
                        {s.fulfilled_dates.length > 0 && ` · ${s.fulfilled_dates.length} collected`}
                        {s.skipped_dates.length > 0 && ` · ${s.skipped_dates.length} skipped`}
                      </span>
                    </span>
                    <span className="hide-sm" style={{ fontSize: 13 }}>
                      {s.day}
                    </span>
                    <span className="mono text-right">
                      {s.quantity} {p?.unit ?? ""}
                    </span>
                    <span style={{ fontSize: 13, minWidth: 0 }}>
                      {cancelled ? (
                        <Pill variant="outline">cancelled</Pill>
                      ) : (
                        <>
                          <span className="mono">{next ?? "—"}</span>
                          <br />
                          <span style={{ color: "var(--ink-muted)" }}>{untilLabel(next, today)}</span>
                          {holding && (
                            <>
                              {" "}
                              <Pill variant="outline-green">held</Pill>
                            </>
                          )}
                        </>
                      )}
                    </span>
                    <span style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {cancelled ? (
                        <button
                          type="button"
                          className="link-button mono"
                          disabled={busy}
                          onClick={() => void act(() => resumeSchedule(s.id), "Standing order resumed.")}
                        >
                          resume
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="link-button mono"
                            disabled={busy || !next}
                            onClick={() =>
                              void act(
                                () => fulfilPickup({ scheduleId: s.id }),
                                `Collected — ${customerName(c)}'s next pickup moves to the following week.`,
                              )
                            }
                          >
                            collected
                          </button>
                          <button
                            type="button"
                            className="link-button mono"
                            disabled={busy || !next}
                            onClick={() => next && void act(() => skipWeek(s, next), `Skipped ${next}.`)}
                          >
                            skip
                          </button>
                          <button
                            type="button"
                            className="link-button mono"
                            disabled={busy}
                            onClick={() => void act(() => cancelSchedule(s.id), "Standing order cancelled.")}
                          >
                            cancel
                          </button>
                        </>
                      )}
                    </span>
                  </GridRow>
                );
              })}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                "Collected" consumes stock and writes a completed order, the same as any pickup — see{" "}
                <Link to="/store/orders">Orders</Link>. "Skip" moves only that week. Cancelling keeps the history, so
                a resumed standing order still knows what it has collected.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_SCHEDULES: Schedule[] = [];
const EMPTY_CUSTOMERS: Customer[] = [];
const EMPTY_PRODUCTS: ProductWithInventory[] = [];
