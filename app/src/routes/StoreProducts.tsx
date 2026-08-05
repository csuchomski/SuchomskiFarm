import { useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, EarTag, GridRow, Pill } from "../components/ui";
import { milkAttributionToday } from "../lib/mockData";
import { TODAY_LABEL, useAppActions, useAppState } from "../lib/store";
import "./store-products.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-05" -> "5 Aug" — matches the "4 Aug" / "3 Aug" style already
 * seeded on batches, without a timezone-sensitive Date() round-trip. */
function toDateLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export default function StoreProducts() {
  const { products, batches } = useAppState();
  const { addBatch } = useAppActions();

  const [date, setDate] = useState("2026-08-05");
  const [quantity, setQuantity] = useState("18.400");
  const [justAdded, setJustAdded] = useState(false);

  const qtyNum = Number(quantity);
  const canAdd = qtyNum > 0 && date;

  const handleAddBatch = () => {
    if (!canAdd) return;
    addBatch(toDateLabel(date), qtyNum);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2500);
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow="Store · 7 products · 2 sold out"
        title="Products"
        actions={
          <>
            <Button>Forecast</Button>
            <Button variant="filled">New product</Button>
          </>
        }
      />

      <GridRow cols="1fr 96px 96px 108px 108px" as="header" style={{ marginTop: 16 }}>
        <span>Product</span>
        <span className="text-right">On hand</span>
        <span className="text-right">Claimed</span>
        <span className="text-right">Open to shop</span>
        <span className="text-right">Held weekly</span>
      </GridRow>

      {products.map((p) => (
        <GridRow cols="1fr 96px 96px 108px 108px" as="body" key={p.id} highlight={p.id === "raw-milk"}>
          <span>
            <span className="serif" style={{ fontSize: 17 }}>
              {p.name}
            </span>{" "}
            <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
              · {p.unitPrice}
            </span>
            {p.note && (
              <>
                <br />
                <span style={{ fontSize: 13, color: p.noteColor === "ochre" ? "var(--ochre)" : "var(--herd-green)" }}>
                  {p.note}
                </span>
              </>
            )}
          </span>
          <span className="mono text-right" style={{ fontSize: 15, color: p.soldOut ? "var(--ink-muted)" : undefined }}>
            {typeof p.onHand === "number" ? p.onHand.toFixed(p.id === "raw-milk" ? 1 : 0) : p.onHand}
          </span>
          <span className="mono text-right" style={{ fontSize: 15, color: p.soldOut ? "var(--ink-muted)" : undefined }}>
            {p.claimed}
          </span>
          {p.soldOut ? (
            <span className="text-right">
              <Pill variant="neutral">Sold out</Pill>
            </span>
          ) : (
            <span className="mono text-right" style={{ fontSize: 15, fontWeight: 500 }}>
              {typeof p.openToShop === "number" ? p.openToShop.toFixed(p.id === "raw-milk" ? 1 : 0) : p.openToShop}
            </span>
          )}
          <span
            className="mono text-right"
            style={{ fontSize: 15, color: p.noteColor === "ochre" ? "var(--ochre)" : "var(--ink-muted)" }}
          >
            {p.heldWeekly}
          </span>
        </GridRow>
      ))}
      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
        Showing 5 of 7 products — the rest aren't drawn in the mockup yet.
      </p>

      {/* selected product: Raw milk */}
      <div className="product-panel">
        <div className="product-panel__head">
          <div className="serif" style={{ fontSize: 27 }}>
            Raw milk
          </div>
          <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
            gallons · 3 decimal places
          </span>
        </div>
        <p className="product-panel__desc text-wrap-pretty">
          Milk goes in pooled: the day's gallons become one batch, and each cow's share is recorded against her
          lactation in Herd rather than splitting inventory nine ways. Beef is the opposite — keep separate batches
          so a cut stays traceable to the steer.
        </p>

        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Add this morning's milking
        </div>
        <div className="batch-entry">
          <input
            className="batch-entry__field mono batch-entry__input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Milking date"
          />
          <div className="batch-entry__field">
            <input
              className="mono batch-entry__qty-input"
              type="number"
              min="0"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              aria-label="Gallons"
            />
            <span style={{ fontSize: 13, color: "var(--ink-muted)", marginLeft: 8 }}>gallons from 9 animals</span>
          </div>
          <div className="batch-entry__action">Per animal</div>
          <button
            className="batch-entry__action batch-entry__action--filled"
            onClick={handleAddBatch}
            disabled={!canAdd}
          >
            Add batch
          </button>
        </div>
        {justAdded && (
          <p style={{ fontSize: 13, color: "var(--herd-green)", marginTop: -8, marginBottom: 16 }}>
            Batch added — Raw milk's on-hand and open-to-shop numbers above just moved.
          </p>
        )}

        <div className="attribution-grid">
          {milkAttributionToday.map((a) => (
            <div className={`attribution-cell ${a.gallons === null ? "attribution-cell--excluded" : ""}`} key={a.tag}>
              <EarTag tag={a.tag} accent={a.tagAccent} />
              <span style={{ flex: 1, fontSize: 15 }}>{a.name}</span>
              {a.gallons === null ? (
                <span className="eyebrow" style={{ color: "var(--ink)" }}>
                  Excluded
                </span>
              ) : (
                <span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>
                  {a.gallons.toFixed(3)}
                </span>
              )}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 20 }}>
          Four more cows recorded. Hazel's 1.8 gal is held out of the batch and logged as fed to pigs — her
          withdrawal runs to 9 August. This per-animal breakdown is fixed in this preview; only the batch total
          above is live.
        </p>

        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Batches on hand
        </div>
        <GridRow cols="130px 1fr 96px 96px 96px" as="header">
          <span>Produced</span>
          <span>Source</span>
          <span className="text-right">Quantity</span>
          <span className="text-right">Reserved</span>
          <span className="text-right">Available</span>
        </GridRow>
        {batches.map((b, i) => (
          <GridRow
            cols="130px 1fr 96px 96px 96px"
            as="body"
            className="mono"
            key={`${b.produced}-${i}`}
            highlight={b.produced === TODAY_LABEL && i === 0}
            style={i === batches.length - 1 ? { borderBottom: "none" } : undefined}
          >
            <span>{b.produced}</span>
            <span style={{ color: "var(--ink-muted)" }}>{b.source}</span>
            <span className="text-right">{b.quantity.toFixed(3)}</span>
            <span className="text-right">{b.reserved.toFixed(3)}</span>
            <span className="text-right" style={{ fontWeight: b.available > 0 && !b.availableNote ? 500 : undefined, color: b.availableNote ? "var(--ochre)" : b.available === 0 ? "var(--ink-muted)" : undefined }}>
              {b.availableNote ?? b.available.toFixed(3)}
            </span>
          </GridRow>
        ))}
      </div>
    </OpsShell>
  );
}
