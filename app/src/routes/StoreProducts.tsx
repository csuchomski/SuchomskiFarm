import { useCallback, useEffect, useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, EarTag, GridRow } from "../components/ui";
import { addInventoryBatch, fetchStoreData, formatUnitPrice, type StoreData } from "../lib/store-data";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import { useWorkspace } from "../lib/workspace";
import "./store-products.css";

type Fetch =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: StoreData; animals: RealAnimal[] };

type Save = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function StoreProducts() {
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;
  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [date, setDate] = useState(todayIso);
  const [quantity, setQuantity] = useState("");
  const [save, setSave] = useState<Save>({ state: "idle" });

  const load = useCallback(async () => {
    if (businessId === null) return;
    const [data, animals] = await Promise.all([fetchStoreData({ businessId, farmId }), fetchAnimals()]);
    setResult({ state: "ok", data, animals });
    // Reset rather than preserve: the previously selected product belongs to
    // the business we just switched away from.
    setSelectedId(data.products.find((p) => p.batches.length > 0)?.id ?? data.products[0]?.id ?? null);
  }, [businessId, farmId]);

  useEffect(() => {
    let cancelled = false;
    setResult({ state: "loading" });
    load().catch(
      (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  const data = result.state === "ok" ? result.data : null;
  const selected = data?.products.find((p) => p.id === selectedId) ?? null;
  const animalsById = new Map((result.state === "ok" ? result.animals : []).map((a) => [a.id, a]));

  const productionForSelected = selected
    ? data!.production.filter((r) => r.product_id === selected.id)
    : [];
  const discardsForSelected = selected ? data!.discards.filter((d) => d.product_id === selected.id) : [];

  const qtyNum = Number(quantity);
  const canSave = selected !== null && date !== "" && quantity.trim() !== "" && !Number.isNaN(qtyNum) && qtyNum > 0;

  const handleAddBatch = async () => {
    if (!canSave || !selected || businessId === null) return;
    setSave({ state: "saving" });
    try {
      await addInventoryBatch({ businessId, productId: selected.id, producedDate: date, quantity: qtyNum });
      setQuantity("");
      await load();
      setSave({ state: "saved" });
      setTimeout(() => setSave((s) => (s.state === "saved" ? { state: "idle" } : s)), 4000);
    } catch (err) {
      setSave({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow={data ? `Store · ${data.products.length} products` : "Store"}
        title="Products"
        actions={
          <>
            <Button>Forecast</Button>
            <Button variant="filled">New product</Button>
          </>
        }
      />

      {result.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading the store…</p>
      )}
      {result.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load the store: {result.message}</p>
      )}

      {data && (
        <>
          <GridRow cols="1fr 96px 96px 108px 108px" as="header" style={{ marginTop: 16 }}>
            <span>Product</span>
            <span className="text-right">On hand</span>
            <span className="text-right">Claimed</span>
            <span className="text-right">Open to shop</span>
            <span className="text-right">Held weekly</span>
          </GridRow>

          {data.products.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedId(p.id)}
            >
              <GridRow cols="1fr 96px 96px 108px 108px" as="body" highlight={p.id === selectedId}>
                <span>
                  <span className="serif" style={{ fontSize: 17 }}>
                    {p.name}
                  </span>{" "}
                  <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                    · {formatUnitPrice(p)}
                  </span>
                </span>
                <span className="mono text-right" style={{ fontSize: 15 }}>
                  {p.onHand}
                </span>
                <span className="mono text-right" style={{ fontSize: 15 }}>
                  {p.claimed}
                </span>
                <span className="mono text-right" style={{ fontSize: 15, fontWeight: 500 }}>
                  {p.openToShop}
                </span>
                {/* Held-weekly comes from public.schedules, which has no rows yet. */}
                <span className="mono text-right" style={{ fontSize: 15, color: "var(--ink-faint)" }}>
                  —
                </span>
              </GridRow>
            </div>
          ))}

          {selected && (
            <div className="product-panel">
              <div className="product-panel__head">
                <div className="serif" style={{ fontSize: 27 }}>
                  {selected.name}
                </div>
                <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                  {selected.unit} · {formatUnitPrice(selected)}
                </span>
              </div>

              <div className="eyebrow" style={{ margin: "16px 0 10px" }}>
                Add a batch of {selected.name.toLowerCase()}
              </div>
              <div className="batch-entry">
                <input
                  className="batch-entry__field mono batch-entry__input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  aria-label="Produced date"
                />
                <div className="batch-entry__field">
                  <input
                    className="mono batch-entry__qty-input"
                    type="number"
                    min="0"
                    step="0.001"
                    placeholder="0.000"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    aria-label="Quantity"
                  />
                  <span style={{ fontSize: 13, color: "var(--ink-muted)", marginLeft: 8 }}>{selected.unit}</span>
                </div>
                <div className="batch-entry__action" style={{ opacity: 0.4 }} title="Per-animal split isn't wired up yet">
                  Per animal
                </div>
                <button
                  className="batch-entry__action batch-entry__action--filled"
                  onClick={() => void handleAddBatch()}
                  disabled={!canSave || save.state === "saving"}
                >
                  {save.state === "saving" ? "Saving…" : "Add batch"}
                </button>
              </div>

              {save.state === "saved" && (
                <p style={{ fontSize: 13, color: "var(--herd-green)", marginTop: -8, marginBottom: 16 }}>
                  Saved to the database — the batch list below is re-read from Supabase, not patched locally.
                </p>
              )}
              {save.state === "error" && (
                <div style={{ marginTop: -8, marginBottom: 16 }}>
                  <p style={{ fontSize: 13, color: "var(--red)", marginBottom: 2 }}>Insert failed:</p>
                  <p className="mono" style={{ fontSize: 13, color: "var(--red)" }}>
                    {save.message}
                  </p>
                  <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 6 }}>
                    If this mentions row-level security, <code>public.inventory_batches</code> needs an INSERT
                    policy — the policies shared so far only covered the <code>herd</code> schema.
                  </p>
                </div>
              )}

              <div className="eyebrow" style={{ margin: "20px 0 10px" }}>
                Attributed to animals
              </div>
              {productionForSelected.length > 0 ? (
                <div className="attribution-grid">
                  {productionForSelected.map((r) => {
                    const animal = animalsById.get(r.animal_id);
                    return (
                      <div className="attribution-cell" key={r.id}>
                        <EarTag tag={animal?.ear_tag ?? "?"} accent="herd" />
                        <span style={{ flex: 1, fontSize: 15 }}>{animal?.barn_name ?? "Unknown animal"}</span>
                        <span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>
                          {r.quantity}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 14 }}>
                  No per-animal production recorded for {selected.name}.
                </p>
              )}

              <div className="eyebrow" style={{ margin: "20px 0 10px" }}>
                Batches on hand
              </div>
              {selected.batches.length > 0 ? (
                <>
                  <GridRow cols="130px 1fr 96px 96px 96px" as="header">
                    <span>Produced</span>
                    <span>Source</span>
                    <span className="text-right">Quantity</span>
                    <span className="text-right">Reserved</span>
                    <span className="text-right">Available</span>
                  </GridRow>
                  {selected.batches.map((b) => {
                    const animal = b.herd_animal_id ? animalsById.get(b.herd_animal_id) : null;
                    const available = Math.round((Number(b.quantity) - Number(b.reserved)) * 1000) / 1000;
                    return (
                      <GridRow cols="130px 1fr 96px 96px 96px" as="body" className="mono" key={b.id}>
                        <span>{b.produced_date}</span>
                        <span style={{ color: "var(--ink-muted)" }}>
                          {animal ? `${animal.barn_name ?? animal.ear_tag} · tag ${animal.ear_tag}` : "pooled"}
                        </span>
                        <span className="text-right">{b.quantity}</span>
                        <span className="text-right">{b.reserved}</span>
                        <span className="text-right" style={{ fontWeight: 500 }}>
                          {available}
                        </span>
                      </GridRow>
                    );
                  })}
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>No batches on hand for {selected.name}.</p>
              )}

              {discardsForSelected.length > 0 && (
                <>
                  <div className="eyebrow" style={{ margin: "20px 0 10px" }}>
                    Discarded
                  </div>
                  <GridRow cols="130px 1fr 96px" as="header">
                    <span>Batch date</span>
                    <span>Reason</span>
                    <span className="text-right">Quantity</span>
                  </GridRow>
                  {discardsForSelected.map((d) => (
                    <GridRow cols="130px 1fr 96px" as="body" className="mono" key={d.id}>
                      <span>{d.batch_produced_date ?? "—"}</span>
                      <span style={{ color: "var(--ochre)" }}>{d.reason}</span>
                      <span className="text-right">{d.quantity}</span>
                    </GridRow>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </OpsShell>
  );
}
