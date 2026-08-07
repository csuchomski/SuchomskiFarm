import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, EarTag, GridRow, Pill, StatTile } from "../components/ui";
import { fetchAnimals, formatAge, type RealAnimal } from "../lib/herd";
import {
  createReferenceSire,
  createSemenLot,
  drawStraws,
  DRAW_REASONS,
  fetchSemenLots,
  fetchSemenTransactions,
  formatMoney,
  inventoryValueCents,
  lotStatus,
  setLotActive,
  sireName,
  siresIn,
  stockBySire,
  tankLocation,
  UNIT_TYPES,
  validateLot,
  validateSire,
  type LotDraft,
  type SemenLot,
  type SemenTransaction,
  type SireDraft,
  type TxReason,
  type UnitType,
} from "../lib/sires";
import { useWorkspace } from "../lib/workspace";
import "./sires.css";

/**
 * The bulls and what's left of them in the tank.
 *
 * Two kinds of sire share this page: bulls that live here, and AI bulls that
 * exist only as a name on a straw. Both are herd.animals rows — the second
 * carries record_type 'reference', which keeps them out of the herd counts
 * without cutting them out of a pedigree. See lib/sires.ts.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

const COLS = "1fr 110px 90px 130px 110px";
const COLS_SM = "1fr 74px 84px";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; animals: RealAnimal[]; lots: SemenLot[]; transactions: SemenTransaction[] };

const emptyLot = (): LotDraft => ({
  sireId: "",
  naabCode: "",
  unitType: "conventional",
  lotCode: "",
  tank: "",
  canister: "",
  cane: "",
  straws: "",
  costPerStraw: "",
  purchaseDate: todayIso(),
  supplier: "",
  reorderThreshold: "",
});

const emptySire = (): SireDraft => ({
  barnName: "",
  earTag: "",
  naabCode: "",
  registrationNumber: "",
  birthDate: "",
  notes: "",
});

export default function Sires() {
  const { farmId, business } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [addingLot, setAddingLot] = useState(false);
  const [addingSire, setAddingSire] = useState(false);
  const [lotDraft, setLotDraft] = useState<LotDraft>(emptyLot);
  const [sireDraft, setSireDraft] = useState<SireDraft>(emptySire);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const [drawing, setDrawing] = useState<string | null>(null);
  const [drawCount, setDrawCount] = useState("1");
  const [drawReason, setDrawReason] = useState<TxReason>("service");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", animals: [], lots: [], transactions: [] });
      return;
    }
    const [animals, lots] = await Promise.all([fetchAnimals(), fetchSemenLots(farmId)]);
    const transactions = await fetchSemenTransactions(lots.map((l) => l.id));
    setLoad({ state: "ok", animals, lots, transactions });
  }, [farmId]);

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

  const animals = load.state === "ok" ? load.animals : EMPTY_ANIMALS;
  const lots = load.state === "ok" ? load.lots : EMPTY_LOTS;
  const transactions = load.state === "ok" ? load.transactions : EMPTY_TX;

  const sires = useMemo(() => siresIn(animals), [animals]);
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const visibleLots = useMemo(() => lots.filter((l) => showRetired || l.active), [lots, showRetired]);
  const retiredCount = lots.filter((l) => !l.active).length;

  const stock = useMemo(() => stockBySire(lots.filter((l) => l.active)), [lots]);
  const totalStraws = stock.reduce((s, r) => s + r.straws, 0);
  const value = inventoryValueCents(lots.filter((l) => l.active));
  const lowLots = lots.filter((l) => l.active && lotStatus(l) === "low").length;

  const lotProblem = validateLot(lotDraft, todayIso());
  const sireProblem = validateSire(sireDraft, todayIso());

  const handleAddLot = async () => {
    if (!farmId || lotProblem) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createSemenLot(farmId, lotDraft);
      await refresh();
      setAddingLot(false);
      setLotDraft(emptyLot());
      setNote(`${created.straws_initial} straws logged.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAddSire = async () => {
    if (!farmId || sireProblem) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createReferenceSire(farmId, sireDraft);
      await refresh();
      setAddingSire(false);
      setSireDraft(emptySire());
      setNote(`${sireName(created)} added. He'll appear as a sire on any animal's record.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDraw = async (lot: SemenLot) => {
    if (!farmId) return;
    setBusy(true);
    setError(null);
    try {
      const remaining = await drawStraws(farmId, lot, Number(drawCount), drawReason);
      await refresh();
      setDrawing(null);
      setDrawCount("1");
      setNote(`${remaining} straw${remaining === 1 ? "" : "s"} left in that lot.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRetire = async (lot: SemenLot) => {
    setBusy(true);
    setError(null);
    try {
      await setLotActive(lot.id, !lot.active);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OpsShell searchPlaceholder="A bull, a lot…">
      <PageHeader
        eyebrow={business ? `${business.name} · herd` : "Herd"}
        title="Sires"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              disabled={load.state !== "ok" || !farmId}
              onClick={() => {
                setAddingSire((v) => !v);
                setAddingLot(false);
                setError(null);
              }}
            >
              {addingSire ? "Cancel" : "Add sire"}
            </Button>
            <Button
              variant="filled"
              disabled={load.state !== "ok" || !farmId || sires.length === 0}
              onClick={() => {
                setAddingLot((v) => !v);
                setAddingSire(false);
                setError(null);
              }}
            >
              {addingLot ? "Cancel" : "Add semen"}
            </Button>
          </div>
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
            <StatTile value={sires.length || "—"} label="Sires on file" />
            <StatTile value={totalStraws || "—"} label="Straws in the tank" />
            <StatTile value={value ? formatMoney(value) : "—"} label="Inventory value" />
            <StatTile value={lowLots || "—"} label="Lots running low" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {addingSire && (
            <div className="sire-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                New sire
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                For an AI bull you'll never own. He's recorded as a reference animal — usable as a sire anywhere in
                the app, but kept out of the herd's counts. A bull that actually lives here should be added from{" "}
                <Link to="/animals">Animals</Link> instead.
              </p>
              <div className="sire-form__fields">
                <Field label="Name" value={sireDraft.barnName} onChange={(v) => setSireDraft({ ...sireDraft, barnName: v })} placeholder="Chief" />
                <Field label="Tag or code" value={sireDraft.earTag} onChange={(v) => setSireDraft({ ...sireDraft, earTag: v })} placeholder="7JE1234" />
                <Field
                  label="Registration"
                  value={sireDraft.registrationNumber}
                  onChange={(v) => setSireDraft({ ...sireDraft, registrationNumber: v })}
                  placeholder="optional"
                />
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Birth date</div>
                  <input
                    className="gene-select"
                    type="date"
                    max={todayIso()}
                    value={sireDraft.birthDate}
                    onChange={(e) => setSireDraft({ ...sireDraft, birthDate: e.target.value })}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="filled" size="sm" disabled={busy || sireProblem !== null} onClick={() => void handleAddSire()}>
                  {busy ? "Saving…" : "Save sire"}
                </Button>
                {sireProblem && <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{sireProblem}</span>}
              </div>
            </div>
          )}

          {addingLot && (
            <div className="sire-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                New semen lot
              </div>
              <div className="sire-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Sire</div>
                  <select
                    className="gene-select"
                    value={lotDraft.sireId}
                    onChange={(e) => setLotDraft({ ...lotDraft, sireId: e.target.value })}
                  >
                    <option value="">Pick a sire…</option>
                    {sires.map((a) => (
                      <option key={a.id} value={a.id}>
                        {sireName(a)}
                        {a.record_type === "reference" ? " (AI)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="NAAB code" value={lotDraft.naabCode} onChange={(v) => setLotDraft({ ...lotDraft, naabCode: v })} placeholder="7JE1234" />
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Unit type</div>
                  <select
                    className="gene-select"
                    value={lotDraft.unitType}
                    onChange={(e) => setLotDraft({ ...lotDraft, unitType: e.target.value as UnitType })}
                  >
                    {UNIT_TYPES.map((u) => (
                      <option key={u.code} value={u.code}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Straws" value={lotDraft.straws} onChange={(v) => setLotDraft({ ...lotDraft, straws: v })} type="number" placeholder="10" />
                <Field
                  label="Cost per straw"
                  value={lotDraft.costPerStraw}
                  onChange={(v) => setLotDraft({ ...lotDraft, costPerStraw: v })}
                  type="number"
                  placeholder="25.00"
                />
                <Field label="Supplier" value={lotDraft.supplier} onChange={(v) => setLotDraft({ ...lotDraft, supplier: v })} placeholder="Select Sires" />
                <Field label="Tank" value={lotDraft.tank} onChange={(v) => setLotDraft({ ...lotDraft, tank: v })} placeholder="A" />
                <Field label="Canister" value={lotDraft.canister} onChange={(v) => setLotDraft({ ...lotDraft, canister: v })} placeholder="3" />
                <Field label="Cane" value={lotDraft.cane} onChange={(v) => setLotDraft({ ...lotDraft, cane: v })} placeholder="7" />
                <Field
                  label="Reorder at"
                  value={lotDraft.reorderThreshold}
                  onChange={(v) => setLotDraft({ ...lotDraft, reorderThreshold: v })}
                  type="number"
                  placeholder="0"
                />
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Purchased</div>
                  <input
                    className="gene-select"
                    type="date"
                    max={todayIso()}
                    value={lotDraft.purchaseDate}
                    onChange={(e) => setLotDraft({ ...lotDraft, purchaseDate: e.target.value })}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="filled" size="sm" disabled={busy || lotProblem !== null} onClick={() => void handleAddLot()}>
                  {busy ? "Saving…" : "Save lot"}
                </Button>
                {lotProblem && <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{lotProblem}</span>}
              </div>
            </div>
          )}

          {sires.length === 0 ? (
            <Callout>
              No sires on file. Add one to start tracking semen — an AI bull needs only a name and a birth date, and
              once he's here you can record straws against him and name him as a calf's sire.
            </Callout>
          ) : (
            <>
              <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                Sires
              </div>
              {sires.map((a) => {
                const s = stock.find((r) => r.sireId === a.id);
                return (
                  <Link key={a.id} to={`/animals/${a.ear_tag}`} className="sire-row">
                    <EarTag tag={a.ear_tag || "—"} accent="herd" />
                    <span style={{ minWidth: 0 }}>
                      <span className="serif" style={{ fontSize: 17 }}>
                        {sireName(a)}
                      </span>
                      <br />
                      <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {a.record_type === "reference" ? "AI sire · not in the herd" : `${a.class} · ${formatAge(a.birth_date)}`}
                      </span>
                    </span>
                    <span className="mono sire-row__straws">
                      {s ? `${s.straws} straw${s.straws === 1 ? "" : "s"}` : "no semen"}
                    </span>
                    <span className="mono sire-row__value hide-sm">{s && s.valueCents > 0 ? formatMoney(s.valueCents) : ""}</span>
                  </Link>
                );
              })}
            </>
          )}

          {lots.length > 0 && (
            <>
              <div className="section__head" style={{ margin: "32px 0 12px" }}>
                <div className="serif" style={{ fontSize: 21 }}>
                  Semen lots
                </div>
                {retiredCount > 0 && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                    <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
                    Show {retiredCount} retired
                  </label>
                )}
              </div>

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Sire · lot</span>
                <span className="hide-sm">Location</span>
                <span className="text-right">Straws</span>
                <span className="hide-sm">Type</span>
                <span className="text-right">Actions</span>
              </GridRow>

              {visibleLots.map((lot) => {
                const sire = byId.get(lot.sire_id);
                const status = lotStatus(lot);
                const location = tankLocation(lot);
                const used = transactions.filter((t) => t.semen_lot_id === lot.id && t.reason === "service").length;
                return (
                  <div key={lot.id}>
                    <GridRow cols={COLS} mobileCols={COLS_SM} as="body" highlight={!lot.active}>
                      <span style={{ minWidth: 0 }}>
                        <span className="serif" style={{ fontSize: 16 }}>
                          {sire ? sireName(sire) : "Unknown sire"}
                        </span>
                        <br />
                        <span className="mono" style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                          {[lot.naab_code, lot.supplier, used > 0 ? `${used} used` : ""].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="hide-sm" style={{ fontSize: 13, color: location ? undefined : "var(--ink-faint)" }}>
                        {location ?? "not located"}
                      </span>
                      <span className="text-right">
                        <span className="mono" style={{ fontSize: 15 }}>
                          {lot.straws_remaining}
                        </span>
                        {status !== "ok" && (
                          <>
                            <br />
                            <Pill variant="outline">{status === "empty" ? "empty" : "low"}</Pill>
                          </>
                        )}
                      </span>
                      <span className="hide-sm" style={{ fontSize: 13 }}>
                        {UNIT_TYPES.find((u) => u.code === lot.unit_type)?.label ?? lot.unit_type}
                      </span>
                      <span className="text-right" style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {lot.active && lot.straws_remaining > 0 && (
                          <button
                            type="button"
                            className="link-button mono"
                            onClick={() => {
                              setDrawing(drawing === lot.id ? null : lot.id);
                              setDrawCount("1");
                              setError(null);
                            }}
                          >
                            use
                          </button>
                        )}
                        <button type="button" className="link-button mono" disabled={busy} onClick={() => void handleRetire(lot)}>
                          {lot.active ? "retire" : "restore"}
                        </button>
                      </span>
                    </GridRow>

                    {drawing === lot.id && (
                      <div className="draw-row">
                        <label style={{ fontSize: 13 }}>
                          <div className="eyebrow">Straws</div>
                          <input
                            className="gene-select"
                            style={{ width: 80 }}
                            type="number"
                            min="1"
                            max={lot.straws_remaining}
                            value={drawCount}
                            onChange={(e) => setDrawCount(e.target.value)}
                          />
                        </label>
                        <label style={{ fontSize: 13 }}>
                          <div className="eyebrow">Reason</div>
                          <select
                            className="gene-select"
                            value={drawReason}
                            onChange={(e) => setDrawReason(e.target.value as TxReason)}
                          >
                            {DRAW_REASONS.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button variant="filled" size="sm" disabled={busy} onClick={() => void handleDraw(lot)}>
                          {busy ? "Saving…" : "Take out"}
                        </Button>
                        <Button size="sm" onClick={() => setDrawing(null)}>
                          Cancel
                        </Button>
                        <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                          {lot.straws_remaining} on hand.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                Straw counts come from the transaction ledger, not a number kept by hand — every purchase and every
                use is a row, and the count is their sum.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label style={{ fontSize: 13 }}>
      <div className="eyebrow">{label}</div>
      <input
        className="gene-select"
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const EMPTY_ANIMALS: RealAnimal[] = [];
const EMPTY_LOTS: SemenLot[] = [];
const EMPTY_TX: SemenTransaction[] = [];
