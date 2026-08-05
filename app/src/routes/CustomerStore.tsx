import { useCallback, useEffect, useState } from "react";
import { CustomerShell } from "../components/shell/CustomerShell";
import { CustomerAuth } from "../components/auth/CustomerAuth";
import { Button, Callout, Pill } from "../components/ui";
import { useAuth, signOut } from "../lib/auth";
import {
  cancelOrder,
  fetchMyOrders,
  fetchShop,
  reserve,
  type CustomerOrder,
  type ShopProduct,
} from "../lib/customer";
import "./customer-store.css";

type Fetch =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; products: ShopProduct[]; orders: CustomerOrder[] };

const price = (n: number | null, unit: string) => (n === null ? `— per ${unit}` : `$${Number(n).toFixed(2)} per ${unit}`);

export default function CustomerStore() {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;

  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [qty, setQty] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [products, orders] = await Promise.all([fetchShop(), fetchMyOrders(userId)]);
    setResult({ state: "ok", products, orders });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    load().catch(
      (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [userId, load]);

  if (authLoading) {
    return (
      <CustomerShell>
        <p style={{ padding: 24, fontSize: 14, color: "var(--ink-muted)" }}>Loading…</p>
      </CustomerShell>
    );
  }

  // The storefront needs to know who's collecting, so it asks before showing
  // anything rather than letting someone fill a basket and hit a wall.
  if (!session) return <CustomerAuth />;

  const handleReserve = async (product: ShopProduct) => {
    if (!userId) return;
    const raw = qty[product.id];
    const quantity = raw ? Number(raw) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    setBusyId(product.id);
    setActionError(null);
    setNotice(null);
    try {
      await reserve({ productId: product.id, quantity });
      setQty((q) => ({ ...q, [product.id]: "" }));
      await load();
      setNotice(`Reserved ${quantity} ${product.unit} of ${product.name}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (order: CustomerOrder) => {
    setBusyId(order.id);
    setActionError(null);
    setNotice(null);
    try {
      await cancelOrder(order.id);
      await load();
      setNotice("Reservation cancelled.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const products = result.state === "ok" ? result.products : [];
  const orders = result.state === "ok" ? result.orders : [];
  const open = orders.filter((o) => !o.cancelled_date && !o.picked_up_date);
  const past = orders.filter((o) => o.cancelled_date || o.picked_up_date);
  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? "Item";
  const productUnit = (id: number) => products.find((p) => p.id === id)?.unit ?? "";

  return (
    <CustomerShell>
      <div className="shop-hero">
        <div className="eyebrow">
          {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <div className="serif shop-hero__title">Fresh today</div>
        <p className="shop-hero__lede text-wrap-pretty">
          Reserve what you want and pick it up at the farm. Pay cash or Venmo when you collect.
        </p>
      </div>

      {result.state === "loading" && (
        <p style={{ padding: 24, fontSize: 14, color: "var(--ink-muted)" }}>Loading the store…</p>
      )}
      {result.state === "error" && (
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 14, color: "var(--red)" }}>Couldn't load the store: {result.message}</p>
        </div>
      )}

      {(notice || actionError) && (
        <div style={{ padding: "16px 16px 0" }}>
          {notice && <p style={{ fontSize: 13, color: "var(--herd-green)" }}>{notice}</p>}
          {actionError && (
            <>
              <p style={{ fontSize: 13, color: "var(--red)" }}>{actionError}</p>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 4 }}>
                If this mentions a missing function, migration 011 hasn't been run — reserving goes through
                reserve_product so the stock is actually held.
              </p>
            </>
          )}
        </div>
      )}

      {result.state === "ok" &&
        products.map((p) => {
          const soldOut = p.available <= 0;
          return (
            <div className={`shop-product ${soldOut ? "shop-product--muted" : ""}`} key={p.id}>
              <div className="shop-product__top">
                <div>
                  <div className="serif shop-product__name" style={soldOut ? { color: "var(--ink-muted)" } : undefined}>
                    {p.name}
                  </div>
                  <div className="mono shop-product__price">{price(p.price, p.unit)}</div>
                </div>
                {soldOut ? (
                  <Pill variant="outline">Sold out</Pill>
                ) : (
                  <div className="mono shop-product__qty">
                    <div className="shop-product__qty-num">{p.available}</div>
                    <div className="shop-product__qty-label">{p.unit} left</div>
                  </div>
                )}
              </div>

              {soldOut ? (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
                  Nothing on hand right now — check back after the next batch.
                </p>
              ) : (
                <div className="shop-product__actions">
                  <input
                    className="shop-qty-field"
                    type="number"
                    min="1"
                    max={p.available}
                    placeholder="Qty"
                    value={qty[p.id] ?? ""}
                    onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))}
                    aria-label={`Quantity of ${p.name}`}
                  />
                  <button className="shop-reserve-btn" onClick={() => void handleReserve(p)} disabled={busyId === p.id}>
                    {busyId === p.id ? "Reserving…" : "Reserve"}
                  </button>
                </div>
              )}
            </div>
          );
        })}

      {result.state === "ok" && products.length === 0 && (
        <p style={{ padding: 24, fontSize: 14, color: "var(--ink-muted)" }}>Nothing in the store just now.</p>
      )}

      <div className="shop-pickups-title serif">Your pickups</div>
      {open.length === 0 && (
        <p style={{ padding: "0 16px 16px", fontSize: 14, color: "var(--ink-muted)" }}>
          Nothing reserved yet.
        </p>
      )}
      {open.map((o) => (
        <div className="shop-pickup" key={o.id}>
          <div className="shop-product__top">
            <div>
              <div className="serif shop-product__name">
                {o.quantity} {productUnit(o.product_id)} {productName(o.product_id).toLowerCase()}
              </div>
              <div className="mono shop-product__price">
                {o.reserved_date ? `Reserved ${new Date(o.reserved_date).toLocaleDateString()}` : o.status} · pay at
                pickup
              </div>
            </div>
            <div className="mono" style={{ fontSize: 15, fontWeight: 500, flex: "none" }}>
              {o.total_cost === null ? "—" : `$${Number(o.total_cost).toFixed(2)}`}
            </div>
          </div>
          <div className="shop-product__actions">
            <Button onClick={() => void handleCancel(o)} disabled={busyId === o.id} style={{ flex: 1 }}>
              {busyId === o.id ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        </div>
      ))}

      {past.length > 0 && (
        <>
          <div className="shop-pickups-title serif" style={{ fontSize: 21 }}>
            Earlier
          </div>
          {past.map((o) => (
            <div className="shop-pickup" key={o.id}>
              <div className="shop-product__top">
                <div>
                  <div className="serif shop-product__name" style={{ color: "var(--ink-muted)" }}>
                    {o.quantity} {productUnit(o.product_id)} {productName(o.product_id).toLowerCase()}
                  </div>
                  <div className="mono shop-product__price">
                    {o.cancelled_date ? "Cancelled" : `Collected ${new Date(o.picked_up_date!).toLocaleDateString()}`}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="shop-note">
        <Callout>
          Nothing from an animal under treatment ever reaches a bottle.
        </Callout>
        <button
          onClick={() => void signOut()}
          style={{
            background: "none",
            border: "none",
            color: "var(--herd-green)",
            fontSize: 13,
            marginTop: 16,
            padding: 0,
          }}
        >
          Sign out
        </button>
      </div>
    </CustomerShell>
  );
}
