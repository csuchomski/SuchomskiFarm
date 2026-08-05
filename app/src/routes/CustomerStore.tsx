import { CustomerShell } from "../components/shell/CustomerShell";
import { Button, Callout, Pill } from "../components/ui";
import { customerPickups, storeProducts } from "../lib/mockData";
import "./customer-store.css";

export default function CustomerStore() {
  return (
    <CustomerShell>
      <div className="shop-hero">
        <div className="eyebrow">Wednesday 4 August</div>
        <div className="serif shop-hero__title">Fresh today</div>
        <p className="shop-hero__lede text-wrap-pretty">
          Reserve what you want and pick it up at the farm. Pay cash or Venmo when you collect.
        </p>
      </div>

      {storeProducts.map((p) => (
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
                <div className="shop-qty-field">Qty</div>
                <div className="shop-reserve-btn">Reserve</div>
              </div>
              <div className="shop-weekly-link">Want it every week? Set up a weekly pickup →</div>
            </>
          )}
        </div>
      ))}

      <div className="shop-pickups-title serif">Your pickups</div>
      {customerPickups.map((p) => (
        <div className="shop-pickup" key={p.title}>
          <div className="shop-product__top">
            <div>
              <div className="serif shop-product__name">{p.title}</div>
              <div className="mono shop-product__price">{p.schedule}</div>
            </div>
            <div style={{ textAlign: "right", flex: "none" }}>
              {p.weekly && <Pill variant="outline-green">Weekly</Pill>}
              <div className="mono" style={{ fontSize: 15, fontWeight: 500, marginTop: p.weekly ? 6 : 0 }}>
                {p.amount}
              </div>
            </div>
          </div>
          {p.weekly && (
            <div className="shop-product__actions">
              <Button variant="filled" style={{ flex: 1 }}>
                I picked this up
              </Button>
              <Button>Skip</Button>
            </div>
          )}
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
