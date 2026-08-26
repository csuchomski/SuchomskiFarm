import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, EarTag, GridRow, StatTile } from "../components/ui";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import { fetchLactations, openLactation, type RealLactation } from "../lib/lactations";
import {
  enteredEntries,
  fetchMilkProduct,
  fetchProductionRecords,
  recordMilkings,
  totalOf,
  unattributedMilk,
  validateMilkings,
  type MilkProduct,
  type MilkingEntry,
  type RealProductionRecord,
} from "../lib/milkings";
import { useWorkspace } from "../lib/workspace";
import "./milkings.css";

/**
 * Recording a milking, which is where the herd meets the store.
 *
 * One entry per cow for a chosen day. Saving writes a production record
 * each and pools the milk into that day's batch, so the shop has something
 * to sell and the lactation page has something to total.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      animals: RealAnimal[];
      lactations: RealLactation[];
      records: RealProductionRecord[];
      product: MilkProduct | null;
    };

type Save = { state: "idle" } | { state: "saving" } | { state: "saved"; note: string } | { state: "error"; message: string };

const todayIso = () => new Date().toISOString().slice(0, 10);

const COLS = "60px 1fr 120px 100px";
const COLS_SM = "44px 1fr 96px";

const RECENT = "90px 1fr 92px 86px";
const RECENT_SM = "76px 1fr 74px";

export default function Milkings() {
  const { farmId, business, modules } = useWorkspace();
  const businessId = business?.id ?? null;

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [date, setDate] = useState(todayIso);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [save, setSave] = useState<Save>({ state: "idle" });

  const refresh = useCallback(async () => {
    if (!farmId || businessId === null) {
      setLoad({ state: "ok", animals: [], lactations: [], records: [], product: null });
      return;
    }
    const [animals, lactations, records, product] = await Promise.all([
      fetchAnimals(farmId),
      fetchLactations(farmId),
      fetchProductionRecords(farmId),
      fetchMilkProduct(businessId),
    ]);
    setLoad({ state: "ok", animals, lactations, records, product });
  }, [farmId, businessId]);

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

  const animals = load.state === "ok" ? load.animals : [];
  const lactations = load.state === "ok" ? load.lactations : [];
  const records = load.state === "ok" ? load.records : [];

  // Who to show a box for: cows with an open lactation. A dry cow or a
  // heifer has nothing to give, and a row per animal would make the sheet
  // mostly blanks.
  const milking = animals.filter((a) => openLactation(lactations.filter((l) => l.animal_id === a.id)) !== null);
  // Fallback while no lactations exist at all — otherwise the page is empty
  // and gives no hint why.
  const noLactationsYet = lactations.length === 0;

  const sheet: MilkingEntry[] = milking.map((a) => ({ animalId: a.id, quantity: entries[a.id] ?? "" }));
  const problem = validateMilkings(sheet, todayIso(), date);
  const total = totalOf(sheet);

  // Milk already recorded for the chosen day, so a second save is an
  // obvious addition rather than a silent duplicate.
  const alreadyToday = records.filter((r) => r.produced_date === date);
  const alreadyTotal = Math.round(alreadyToday.reduce((s, r) => s + Number(r.quantity), 0) * 1000) / 1000;

  const orphans = unattributedMilk(records, lactations);

  const milkProduct = load.state === "ok" ? load.product : null;
  // Labels only. Every write path is guarded on milkProduct itself, so this
  // never puts a unit on a record — it just keeps the sheet readable while
  // the product is still loading.
  const unit = milkProduct?.unit ?? "";

  const handleSave = async () => {
    if (!farmId || businessId === null || problem || !milkProduct) return;
    setSave({ state: "saving" });
    try {
      const { batchId, batchQuantity } = await recordMilkings({
        farmId,
        businessId,
        productId: milkProduct.id,
        productName: milkProduct.name,
        unit: milkProduct.unit,
        producedDate: date,
        entries: enteredEntries(sheet),
      });
      setEntries({});
      await refresh();
      setSave({
        state: "saved",
        note: `${total} ${milkProduct.name.toLowerCase()} into batch ${batchId}, now ${batchQuantity}.`,
      });
    } catch (err) {
      setSave({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const canSave =
    problem === null &&
    farmId !== null &&
    businessId !== null &&
    milkProduct !== null &&
    save.state !== "saving";

  return (
    <OpsShell searchPlaceholder="A cow, a milking…">
      <PageHeader
        eyebrow={business ? `${business.name} · herd` : "Herd"}
        title="Milkings"
        actions={
          <Button variant="filled" disabled={!canSave} onClick={() => void handleSave()}>
            {save.state === "saving" ? "Saving…" : `Record ${total || ""} ${total ? unit : "milking"}`.trim()}
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
            <StatTile value={milking.length} label="Cows in milk" />
            <StatTile value={total || "—"} label="Entering now" unit={total ? unit : undefined} />
            <StatTile value={alreadyTotal || "—"} label={`Already on ${date}`} />
            <StatTile value={records.length} label="Milkings on record" />
          </div>

          {save.state === "error" && (
            <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{save.message}</p>
          )}
          {save.state === "saved" && (
            <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>Saved — {save.note}</p>
          )}

          <div className="milking-controls">
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Date</div>
              <input
                className="milking-date"
                type="date"
                max={todayIso()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {alreadyTotal > 0 && (
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                {alreadyTotal} {unit} already recorded for this day — saving adds to it.
              </span>
            )}
          </div>

          {milkProduct === null ? (
            <Callout>
              This business has no milk product, so there's nothing to record a milking against. Add one in{" "}
              <Link to="/store/products">Store → Products</Link> — it's matched on its type, falling back to its
              name.
            </Callout>
          ) : noLactationsYet ? (
            <Callout>
              No cow has an open lactation, so there's nobody to record milk against. Record a freshening on a cow's
              record — or from <Link to="/milking?tab=lactations">Lactations</Link> — and she'll appear here.
            </Callout>
          ) : milking.length === 0 ? (
            <Callout>
              Every lactation on record is dried off, so no cow is currently milking.
            </Callout>
          ) : (
            <>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Tag</span>
                <span>Animal</span>
                <span className="text-right">{unit || "qty"}</span>
                <span className="text-right hide-sm">DIM</span>
              </GridRow>

              {milking.map((a) => {
                const open = openLactation(lactations.filter((l) => l.animal_id === a.id));
                const dim =
                  open === null
                    ? null
                    : Math.round(
                        (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${open.fresh_date}T00:00:00Z`)) / 86_400_000,
                      );
                return (
                  <GridRow key={a.id} cols={COLS} mobileCols={COLS_SM} as="body">
                    <EarTag tag={a.ear_tag} accent="herd" />
                    <span className="serif" style={{ fontSize: 17 }}>
                      {a.barn_name ?? `Tag ${a.ear_tag}`}
                    </span>
                    <input
                      className="milking-qty mono"
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="—"
                      aria-label={`Quantity from ${a.barn_name ?? a.ear_tag}`}
                      value={entries[a.id] ?? ""}
                      onChange={(ev) => setEntries((s) => ({ ...s, [a.id]: ev.target.value }))}
                    />
                    <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
                      {dim !== null && dim >= 0 ? dim : "—"}
                    </span>
                  </GridRow>
                );
              })}

              {problem && (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 12 }}>{problem}</p>
              )}
              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 12 }}>
                A blank box means she wasn't milked. Saving pools the milk into that day's batch, which is what the
                store sells.
              </p>
            </>
          )}

          {orphans.length > 0 && (
            <div style={{ paddingTop: 32 }}>
              <div className="serif" style={{ fontSize: 21, marginBottom: 4 }}>
                Milk outside a lactation
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                {orphans.length} record{orphans.length === 1 ? "" : "s"} for a cow with no lactation covering that
                date. The milk still counts for the store; it just isn't part of any lactation's total.
              </p>
              <GridRow cols={RECENT} mobileCols={RECENT_SM} as="header">
                <span>Date</span>
                <span>Animal</span>
                <span className="text-right">Qty</span>
                <span className="text-right hide-sm">Batch</span>
              </GridRow>
              {orphans.slice(0, 10).map((r) => {
                const a = animals.find((x) => x.id === r.animal_id);
                return (
                  <GridRow key={r.id} cols={RECENT} mobileCols={RECENT_SM} as="body">
                    <span className="mono" style={{ fontSize: 13 }}>
                      {r.produced_date}
                    </span>
                    <span>{a?.barn_name ?? (a ? `Tag ${a.ear_tag}` : "Unknown")}</span>
                    <span className="mono text-right">{r.quantity}</span>
                    <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
                      {r.batch_id ?? "—"}
                    </span>
                  </GridRow>
                );
              })}
            </div>
          )}

          {modules.includes("store") && (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 24 }}>
              Milk recorded here appears in <Link to="/store/products">Store → Products</Link>, and counts toward each
              cow's lactation on <Link to="/milking?tab=lactations">Lactations</Link>.
            </p>
          )}
        </>
      )}
    </OpsShell>
  );
}
