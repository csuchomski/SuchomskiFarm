import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, EarTag, GridRow } from "../components/ui";
import {
  addInventoryBatch,
  createProduct,
  discardInventory,
  DISCARD_REASONS,
  fetchStoreData,
  formatUnitPrice,
  PRODUCT_TYPES,
  updateProduct,
  validateDiscard,
  validateProduct,
  type DiscardReason,
  type ProductDraft,
  type StoreData,
} from "../lib/store-data";
import { fetchSchedules, type Schedule } from "../lib/schedules";
import { weeklyCommitment } from "../lib/forecast";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import { fetchLactations, openLactation, type RealLactation } from "../lib/lactations";
import {
  byAnimal,
  enteredEntries,
  fetchMilkProduct,
  recordMilkings,
  totalOf,
  validateMilkings,
  type MilkingEntry,
} from "../lib/milkings";
import { useWorkspace } from "../lib/workspace";
import "./store-products.css";

type Fetch =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      data: StoreData;
      animals: RealAnimal[];
      lactations: RealLactation[];
      milkProductId: number | null;
    };

type Save = { state: "idle" } | { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

const emptyDraft = (): ProductDraft => ({
  name: "",
  unit: "",
  price: "",
  forecastOverride: "",
  typeCode: "",
});

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function StoreProducts() {
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;
  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [date, setDate] = useState(todayIso);
  const [quantity, setQuantity] = useState("");
  const [save, setSave] = useState<Save>({ state: "idle" });

  // Standing orders, for the "held weekly" column — it read "—" because
  // public.schedules had no rows and no UI. It has both now.
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  // Creating and editing a product. "New product" was a button with no
  // onClick; there was no way to add one, or to change a price that every
  // order is costed from.
  const [productForm, setProductForm] = useState<{ mode: "new" | "edit"; id: number | null } | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);

  // Throwing stock away. discard_inventory has existed all along; the page
  // listed discards without any way to record one.
  const [discarding, setDiscarding] = useState(false);
  const [discardQty, setDiscardQty] = useState("");
  const [discardReason, setDiscardReason] = useState<string>(DISCARD_REASONS[0]);

  // Per-animal attribution. Empty means a plain batch with no animal behind
  // it, which is still valid — eggs and pork have no cow.
  const [showPerAnimal, setShowPerAnimal] = useState(false);
  const [perAnimal, setPerAnimal] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (businessId === null) return;
    const [data, animals, lactations, milkProduct, standing] = await Promise.all([
      fetchStoreData({ businessId, farmId }),
      fetchAnimals(),
      farmId ? fetchLactations(farmId) : Promise.resolve([] as RealLactation[]),
      // Asked for separately because fetchStoreData doesn't select
      // type_code, and matching on the name alone would call "Milk soap"
      // milk. Same lookup the Milkings page uses, so they agree.
      fetchMilkProduct(businessId),
      fetchSchedules(businessId),
    ]);
    setResult({ state: "ok", data, animals, lactations, milkProductId: milkProduct?.id ?? null });
    setSchedules(standing);
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
  const allAnimals = result.state === "ok" ? result.animals : [];
  const lactations = result.state === "ok" ? result.lactations : [];
  const animalsById = new Map(allAnimals.map((a) => [a.id, a]));

  // Per-animal only applies to milk. Attributing eggs to a lactating cow
  // would be nonsense, and "in lactation" has no meaning for pork.
  const milkProductId = result.state === "ok" ? result.milkProductId : null;
  const isMilk = selected !== null && milkProductId !== null && selected.id === milkProductId;

  // Only cows currently milking, which is what was asked for: a dry cow or
  // a heifer can't have produced today's milk.
  const lactatingCows = isMilk
    ? allAnimals.filter((a) => openLactation(lactations.filter((l) => l.animal_id === a.id)) !== null)
    : [];

  const sheet: MilkingEntry[] = lactatingCows.map((a) => ({ animalId: a.id, quantity: perAnimal[a.id] ?? "" }));
  const perAnimalTotal = totalOf(sheet);
  const usingPerAnimal = showPerAnimal && enteredEntries(sheet).length > 0;

  const productionForSelected = selected
    ? data!.production.filter((r) => r.product_id === selected.id)
    : [];
  const discardsForSelected = selected ? data!.discards.filter((d) => d.product_id === selected.id) : [];

  // Totalled per animal, so the list is bounded by the herd rather than by
  // how many times you've milked.
  const perAnimalHistory = byAnimal(productionForSelected);
  const historySpan = (() => {
    if (perAnimalHistory.length === 0) return "";
    const first = perAnimalHistory.reduce((m, r) => (r.first < m ? r.first : m), perAnimalHistory[0].first);
    const last = perAnimalHistory.reduce((m, r) => (r.last > m ? r.last : m), perAnimalHistory[0].last);
    const total = Math.round(perAnimalHistory.reduce((s, r) => s + r.total, 0) * 1000) / 1000;
    return first === last
      ? `${total} ${selected?.unit ?? ""} on ${first}`.trim()
      : `${total} ${selected?.unit ?? ""} between ${first} and ${last}`.trim();
  })();

  const qtyNum = usingPerAnimal ? perAnimalTotal : Number(quantity);
  const perAnimalProblem = usingPerAnimal ? validateMilkings(sheet, todayIso(), date) : null;
  const canSave =
    selected !== null &&
    date !== "" &&
    perAnimalProblem === null &&
    (usingPerAnimal ? perAnimalTotal > 0 : quantity.trim() !== "" && !Number.isNaN(qtyNum) && qtyNum > 0);

  const handleAddBatch = async () => {
    if (!canSave || !selected || businessId === null) return;
    setSave({ state: "saving" });
    try {
      if (usingPerAnimal && farmId) {
        // Goes through the same path as the Milkings page, so a batch
        // entered here and one entered there can't behave differently.
        await recordMilkings({
          farmId,
          businessId,
          productId: selected.id,
          productName: selected.name,
          unit: selected.unit,
          producedDate: date,
          entries: enteredEntries(sheet),
        });
      } else {
        await addInventoryBatch({ businessId, productId: selected.id, producedDate: date, quantity: qtyNum });
      }
      setQuantity("");
      setPerAnimal({});
      await load();
      setSave({ state: "saved" });
      setTimeout(() => setSave((s) => (s.state === "saved" ? { state: "idle" } : s)), 4000);
    } catch (err) {
      setSave({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const productProblem = productForm ? validateProduct(draft) : null;
  const discardProblem = selected
    ? validateDiscard({ quantity: discardQty, reason: discardReason, available: selected.openToShop })
    : null;

  const handleSaveProduct = async () => {
    if (!productForm || productProblem || businessId === null) return;
    setSave({ state: "saving" });
    try {
      if (productForm.mode === "edit" && productForm.id !== null) await updateProduct(productForm.id, draft);
      else await createProduct(businessId, draft);
      await load();
      setProductForm(null);
      setSave({ state: "idle" });
    } catch (err) {
      setSave({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDiscard = async () => {
    if (!selected || discardProblem) return;
    setSave({ state: "saving" });
    try {
      await discardInventory({
        productId: selected.id,
        quantity: Number(discardQty),
        reason: discardReason as DiscardReason,
      });
      await load();
      setDiscarding(false);
      setDiscardQty("");
      setSave({ state: "idle" });
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
            <Link to="/store/forecast">
              <Button>Forecast</Button>
            </Link>
            <Button
              variant="filled"
              disabled={!data || businessId === null}
              onClick={() => {
                setProductForm(productForm ? null : { mode: "new", id: null });
                setDraft(emptyDraft());
                setSave({ state: "idle" });
              }}
            >
              {productForm?.mode === "new" ? "Cancel" : "New product"}
            </Button>
          </>
        }
      />

      {result.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading the store…</p>
      )}
      {result.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load the store: {result.message}</p>
      )}

      {data && productForm && (
        <div className="product-form">
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {productForm.mode === "edit" ? "Edit product" : "New product"}
          </div>
          <div className="product-form__fields">
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Name</div>
              <input
                className="order-select"
                value={draft.name}
                placeholder="Raw milk"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Sold by</div>
              <input
                className="order-select"
                value={draft.unit}
                placeholder="gallon"
                onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Price</div>
              <input
                className="order-select"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="—"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Type</div>
              <select
                className="order-select"
                value={draft.typeCode}
                onChange={(e) => setDraft({ ...draft, typeCode: e.target.value })}
              >
                <option value="">Not set</option>
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Expected weekly</div>
              <input
                className="order-select"
                type="number"
                min="0"
                step="0.001"
                inputMode="decimal"
                placeholder="from history"
                value={draft.forecastOverride}
                onChange={(e) => setDraft({ ...draft, forecastOverride: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              variant="filled"
              size="sm"
              disabled={productProblem !== null || save.state === "saving"}
              onClick={() => void handleSaveProduct()}
            >
              {save.state === "saving" ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" onClick={() => setProductForm(null)}>
              Cancel
            </Button>
            {productProblem && <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{productProblem}</span>}
            {save.state === "error" && <span style={{ fontSize: 13, color: "var(--red)" }}>{save.message}</span>}
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
            The price is what every order is costed from when it's collected. "Expected weekly" overrides the
            forecast's own estimate — leave it blank and it works the rate out from the last fortnight.
          </p>
        </div>
      )}

      {data && (
        <>
          <GridRow
            cols="1fr 96px 96px 108px 108px"
            mobileCols="1fr 66px 84px"
            as="header"
            style={{ marginTop: 16 }}
          >
            <span>Product</span>
            <span className="text-right">On hand</span>
            <span className="text-right hide-sm">Claimed</span>
            <span className="text-right">Open</span>
            <span className="text-right hide-sm">Held weekly</span>
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
              <GridRow cols="1fr 96px 96px 108px 108px" mobileCols="1fr 66px 84px" as="body" highlight={p.id === selectedId}>
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
                <span className="mono text-right hide-sm" style={{ fontSize: 15 }}>
                  {p.claimed}
                </span>
                <span className="mono text-right" style={{ fontSize: 15, fontWeight: 500 }}>
                  {p.openToShop}
                </span>
                {/* Held weekly: what standing orders have promised. This
                    was a hard-coded "—" while public.schedules had no rows. */}
                <span
                  className="mono text-right hide-sm"
                  style={{
                    fontSize: 15,
                    color: weeklyCommitment(schedules, p.id) > 0 ? undefined : "var(--ink-faint)",
                  }}
                >
                  {weeklyCommitment(schedules, p.id) || "—"}
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
                <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="link-button mono"
                    onClick={() => {
                      setProductForm({ mode: "edit", id: selected.id });
                      setDraft({
                        name: selected.name,
                        unit: selected.unit,
                        price: selected.price === null ? "" : String(selected.price),
                        forecastOverride:
                          selected.forecast_override === null ? "" : String(selected.forecast_override),
                        typeCode: "",
                      });
                      setSave({ state: "idle" });
                    }}
                  >
                    edit
                  </button>
                  {selected.openToShop > 0 && (
                    <button
                      type="button"
                      className="link-button mono"
                      onClick={() => {
                        setDiscarding((v) => !v);
                        setDiscardQty("");
                        setSave({ state: "idle" });
                      }}
                    >
                      {discarding ? "cancel" : "discard"}
                    </button>
                  )}
                </span>
              </div>

              {discarding && (
                <div className="product-form" style={{ marginTop: 12 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Throw out {selected.name.toLowerCase()}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ fontSize: 13 }}>
                      <div className="eyebrow">How much</div>
                      <input
                        className="order-select"
                        style={{ width: 110 }}
                        type="number"
                        min="0"
                        max={selected.openToShop}
                        step="0.001"
                        inputMode="decimal"
                        aria-label="Quantity to discard"
                        value={discardQty}
                        onChange={(e) => setDiscardQty(e.target.value)}
                      />
                    </label>
                    <label style={{ fontSize: 13 }}>
                      <div className="eyebrow">Reason</div>
                      <select
                        className="order-select"
                        value={discardReason}
                        onChange={(e) => setDiscardReason(e.target.value)}
                      >
                        {DISCARD_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="filled"
                      size="sm"
                      disabled={discardProblem !== null || save.state === "saving"}
                      onClick={() => void handleDiscard()}
                    >
                      {save.state === "saving" ? "Saving…" : "Discard"}
                    </Button>
                    <span style={{ fontSize: 13, color: "var(--ink-muted)", flexBasis: "100%" }}>
                      {discardProblem ??
                        `${selected.openToShop} ${selected.unit} unreserved. Stock already promised to an order can't be discarded.`}
                    </span>
                    {save.state === "error" && (
                      <span style={{ fontSize: 13, color: "var(--red)", flexBasis: "100%" }}>{save.message}</span>
                    )}
                  </div>
                </div>
              )}

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
                    /* Derived, not typed, once cows are entered — two
                       numbers that could disagree would leave no way to
                       tell which one the batch actually holds. */
                    value={usingPerAnimal ? String(perAnimalTotal) : quantity}
                    readOnly={usingPerAnimal}
                    onChange={(e) => setQuantity(e.target.value)}
                    aria-label="Quantity"
                  />
                  <span style={{ fontSize: 13, color: "var(--ink-muted)", marginLeft: 8 }}>{selected.unit}</span>
                </div>
                {isMilk ? (
                  <button
                    className={`batch-entry__action ${showPerAnimal ? "batch-entry__action--on" : ""}`}
                    onClick={() => setShowPerAnimal((v) => !v)}
                    aria-expanded={showPerAnimal}
                  >
                    {usingPerAnimal ? `${enteredEntries(sheet).length} cow${enteredEntries(sheet).length === 1 ? "" : "s"}` : "Per animal"}
                  </button>
                ) : (
                  <div
                    className="batch-entry__action"
                    style={{ opacity: 0.4 }}
                    title={`Per-animal attribution applies to milk, not ${selected.name.toLowerCase()}`}
                  >
                    Per animal
                  </div>
                )}
                <button
                  className="batch-entry__action batch-entry__action--filled"
                  onClick={() => void handleAddBatch()}
                  disabled={!canSave || save.state === "saving"}
                >
                  {save.state === "saving" ? "Saving…" : "Add batch"}
                </button>
              </div>

              {isMilk && showPerAnimal && (
                <div className="per-animal">
                  <div className="eyebrow" style={{ marginBottom: 8 }}>
                    Milk from each cow
                  </div>
                  {lactatingCows.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      No cow has an open lactation, so there's nobody to attribute this milk to. Record a freshening
                      from <Link to="/milking?tab=lactations">Lactations</Link> and she'll appear here.
                    </p>
                  ) : (
                    <>
                      <div className="per-animal__grid">
                        {lactatingCows.map((a) => (
                          <label key={a.id} className="per-animal__row">
                            <EarTag tag={a.ear_tag} accent="herd" />
                            <span className="per-animal__name">{a.barn_name ?? `Tag ${a.ear_tag}`}</span>
                            <input
                              className="per-animal__qty mono"
                              type="number"
                              min="0"
                              step="0.001"
                              inputMode="decimal"
                              placeholder="—"
                              aria-label={`${selected.unit} from ${a.barn_name ?? a.ear_tag}`}
                              value={perAnimal[a.id] ?? ""}
                              onChange={(ev) => setPerAnimal((m) => ({ ...m, [a.id]: ev.target.value }))}
                            />
                          </label>
                        ))}
                      </div>
                      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 10 }}>
                        {usingPerAnimal
                          ? `${perAnimalTotal} ${selected.unit} across ${enteredEntries(sheet).length} cow${enteredEntries(sheet).length === 1 ? "" : "s"} — the batch quantity above follows this sum.`
                          : `Leave a cow blank if she wasn't milked. Blank is not the same as zero.`}
                      </p>
                      {perAnimalProblem && (
                        <p style={{ fontSize: 13, color: "var(--red)", marginTop: 6 }}>{perAnimalProblem}</p>
                      )}
                    </>
                  )}
                </div>
              )}

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

              {/* History, not input — the form above records new milk, this
                  reports what has already been recorded. Retitled because
                  two stacked ear-tag lists read as the same thing twice.
                  Totalled per animal rather than one cell per record: the
                  latter grows without bound and never answers "how much has
                  she given". */}
              <div className="eyebrow" style={{ margin: "20px 0 4px" }}>
                Where this milk came from
              </div>
              {perAnimalHistory.length > 0 ? (
                <>
                  <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 10 }}>
                    {historySpan}
                  </p>
                  <div className="attribution-grid">
                    {perAnimalHistory.map((row) => {
                      const animal = animalsById.get(row.animalId);
                      return (
                        <div className="attribution-cell" key={row.animalId}>
                          <EarTag tag={animal?.ear_tag ?? "?"} accent="herd" />
                          <span className="attribution-cell__name">
                            {animal?.barn_name ?? "Unknown animal"}
                            <span className="attribution-cell__days">
                              {row.days} day{row.days === 1 ? "" : "s"}
                            </span>
                          </span>
                          <span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>
                            {row.total}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
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
                  <GridRow cols="130px 1fr 96px 96px 96px" mobileCols="86px 1fr 74px" as="header">
                    <span>Produced</span>
                    <span>Source</span>
                    <span className="text-right hide-sm">Quantity</span>
                    <span className="text-right hide-sm">Reserved</span>
                    <span className="text-right">Available</span>
                  </GridRow>
                  {selected.batches.map((b) => {
                    const animal = b.herd_animal_id ? animalsById.get(b.herd_animal_id) : null;
                    const available = Math.round((Number(b.quantity) - Number(b.reserved)) * 1000) / 1000;
                    return (
                      <GridRow cols="130px 1fr 96px 96px 96px" mobileCols="86px 1fr 74px" as="body" className="mono" key={b.id}>
                        <span>{b.produced_date}</span>
                        <span style={{ color: "var(--ink-muted)" }}>
                          {animal ? `${animal.barn_name ?? animal.ear_tag} · tag ${animal.ear_tag}` : "pooled"}
                        </span>
                        <span className="text-right hide-sm">{b.quantity}</span>
                        <span className="text-right hide-sm">{b.reserved}</span>
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
                  <GridRow cols="130px 1fr 96px" mobileCols="86px 1fr 66px" as="header">
                    <span>Batch date</span>
                    <span>Reason</span>
                    <span className="text-right">Quantity</span>
                  </GridRow>
                  {discardsForSelected.map((d) => (
                    <GridRow cols="130px 1fr 96px" mobileCols="86px 1fr 66px" as="body" className="mono" key={d.id}>
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
