import { useState } from "react";
import { CustomerShell } from "../components/shell/CustomerShell";
import { Button, Callout, Pill } from "../components/ui";
import { customerPickups, storeProducts as seedProducts } from "../lib/mockData";
import type { StoreProduct } from "../lib/types";
import "./customer-store.css";

type PickupStatus = "pending" | "done" | "skipped";

/** Local-only state: a customer's reservations and pickup taps aren't wired
 * to the ops side (there's no backend), so they live in this component and
 * reset on reload — an honest boundary rather than pretending to sync. */
export default function CustomerStore() {
  const [products, setProducts] = useState<StoreProduct[]>(() => seedProducts.map((p) => ({ ...p })));
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [pickupStatus, setPickupStatus] = useState<PickupStatus[]>(() => customerPickups.map(() => "pending"));

  const reserve = (id: string) => {
    const raw = qtyInputs[id];
    const qty = raw ? Number(raw) : 1;
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id || typeof p.quantityLeft !== "number") return p;
        const clamped = Math.max(0, Math.min(qty > 0 ? qty : 1, p.quantityLeft));
        return { ...p, quantityLeft: Math.round((p.quantityLeft - clamped) * 1000) / 1000 };
      }),
    );
    setQtyInputs((prev) => ({ ...prev, [id]: "" }));
    setConfirmedId(id);
    setTimeout(() => setConfirmedId((cur) => (cur === id ? null : cur)), 2500);
  };

  return (
    <CustomerShell>
      <div className="shop-hero">
        <div className="eyebrow">Wednesday 4 August</div>
        <div className="serif shop-hero__title">Fresh today</div>
        <p className="shop-hero__lede text-wrap-pretty">
          Reserve what you want and pick it up at the farm. Pay cash or Venmo when you collect.
        </p>
      </div>

      {products.map((p) => (
        <div className={`shop-product ${p.soldOut ? "shop-product--muted" : ""}`} key={p.id}>
          <div className="shop-product__top">
            <div>
              <div className="serif shop-product__name" style={{ color: p.soldOut ? "var(--ink-muted)" : undefined }}>
                {p.name}
              </div>
              <div className="mono shop-product__price">{p.unitPrice}</div>
            </div>
            {p.soldOut ? (
              <Pill variant="outline">Sold out</Pill>
            ) : (
              <div className="mono shop-product__qty">
                <div className="shop-product__qty-num">{p.quantityLeft}</div>
                <div className="shop-product__qty-label">{p.unitLabel}</div>
              </div>
            )}
          </div>

          {p.soldOut ? (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>{p.soldOutNote}</p>
          ) : (
            <>
              <div className="shop-product__actions">
                <input
                  className="shop-qty-field"
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={qtyInputs[p.id] ?? ""}
                  onChange={(e) => setQtyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  aria-label={`Quantity of ${p.name}`}
                  disabled={p.quantityLeft === 0}
                />
                <button
                  className="shop-reserve-btn"
                  onClick={() => reserve(p.id)}
                  disabled={p.quantityLeft === 0}
                  style={p.quantityLeft === 0 ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                >
                  {p.quantityLeft === 0 ? "None left" : "Reserve"}
                </button>
              </div>
              {confirmedId === p.id ? (
                <div className="shop-weekly-link" style={{ color: "var(--herd-green)" }}>
                  Reserved — see you at pickup.
                </div>
              ) : (
                <div className="shop-weekly-link">Want it every week? Set up a weekly pickup →</div>
              )}
            </>
          )}
        </div>
      ))}

      <div className="shop-pickups-title serif">Your pickups</div>
      {customerPickups.map((p, i) => (
        <div className="shop-pickup" key={p.title}>
          <div className="shop-product__top">
            <div>
              <div
                className="serif shop-product__name"
                style={pickupStatus[i] !== "pending" ? { color: "var(--ink-muted)" } : undefined}
              >
                {p.title}
              </div>
              <div className="mono shop-product__price">{p.schedule}</div>
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              {p.weekly && <Pill variant="outline-green">Weekly</Pill>}
              <div className="mono" style={{ fontSize: 15, fontWeight: 500, marginTop: p.weekly ? 6 : 0 }}>
                {p.amount}
              </div>
            </div>
          </div>
          {p.weekly &&
            (pickupStatus[i] === "pending" ? (
              <div className="shop-product__actions">
                <Button
                  variant="filled"
                  style={{ flex: 1 }}
                  onClick={() => setPickupStatus((s) => s.map((v, j) => (j === i ? "done" : v)))}
                >
                  I picked this up
                </Button>
                <Button onClick={() => setPickupStatus((s) => s.map((v, j) => (j === i ? "skipped" : v)))}>
                  Skip
                </Button>
              </div>
            ) : (
              <div className="shop-weekly-link" style={{ color: pickupStatus[i] === "done" ? "var(--herd-green)" : "var(--ink-muted)" }}>
                {pickupStatus[i] === "done" ? "Marked picked up — thank you!" : "Skipped this week."}
              </div>
            ))}
        </div>
      ))}

      <div className="shop-note">
        <Callout>
          Today's milk came from nine cows, bottled this morning. Nothing from an animal under treatment ever
          reaches a bottle.
        </Callout>
      </div>
    </CustomerShell>
  );
}
