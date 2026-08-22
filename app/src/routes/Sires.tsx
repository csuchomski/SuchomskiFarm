import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { EarTag, Pill, Button, StatTile, GridRow, Callout, SaveToast } from "../components/ui";
import { animalPath, fetchAnimals, formatAge, type RealAnimal } from "../lib/herd";
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
  fetchSireDraft,
  sireName,
  updateSire,
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
import { BreedEditor } from "../components/herd/BreedEditor";
import { fetchBreeds as fetchHerdBreeds, fetchComposition, type Breed, type BreedShare } from "../lib/gestation";
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
  | {
      state: "ok";
      animals: RealAnimal[];
      lots: SemenLot[];
      transactions: SemenTransaction[];
      composition: BreedShare[];
      breeds: Breed[];
    };

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
  // Which bull's breeds are being edited. A bull with none leaves every calf
  // he sires with none, because inheritance needs both parents — so this is
  // the field that decides whether the herd's genetics carry forward at all.
  const [composing, setComposing] = useState<string | null>(null);
  // Editing a bull's own details. Held separately from the "new sire" draft
  // so opening one doesn't wipe a half-typed new bull.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<SireDraft | null>(null);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", animals: [], lots: [], transactions: [], composition: [], breeds: [] });
      return;
    }
    const [animals, lots, composition, breeds] = await Promise.all([
      fetchAnimals(),
      fetchSemenLots(farmId),
      fetchComposition(farmId),
      fetchHerdBreeds(farmId),
    ]);
    const transactions = await fetchSemenTransactions(lots.map((l) => l.id));
    setLoad({ state: "ok", animals, lots, transactions, composition, breeds });
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
  const composition = load.state === "ok" ? load.composition : EMPTY_SHARES;
  const breeds = load.state === "ok" ? load.breeds : EMPTY_BREEDS;
  const breedName = (id: string) => breeds.find((b) => b.id === id)?.name ?? "unknown breed";

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
          <SaveToast note={note} onDone={() => setNote(null)} />

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
              <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "-8px 0 12px" }}>
                A calf born here inherits half its breeds from each parent, and only when <em>both</em> have a
                composition on file. A bull with none leaves his calves with none — so his breeds are set here,
                where the bulls are.
              </p>

              {sires.map((a) => {
                const s = stock.find((r) => r.sireId === a.id);
                const mine = composition.filter((c) => c.animal_id === a.id);
                return (
                  <div key={a.id}>
                    {/* Not one big Link any more: a link can't contain a
                        button, and setting his breeds is the reason to be
                        looking at this row. His name still opens his record —
                        for an AI bull with no ear tag there was never a record
                        to open. */}
                    <div className={`sire-row${mine.length === 0 ? " sire-row--needs-breeds" : ""}`}>
                      <EarTag tag={a.ear_tag || "—"} accent="herd" />
                      <span className="sire-row__name" style={{ minWidth: 0 }}>
                        {a.ear_tag ? (
                          <Link to={animalPath(a)} className="serif" style={{ fontSize: 17 }}>
                            {sireName(a)}
                          </Link>
                        ) : (
                          <span className="serif" style={{ fontSize: 17 }}>
                            {sireName(a)}
                          </span>
                        )}
                        <br />
                        <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                          {a.record_type === "reference"
                            ? "AI sire · not in the herd"
                            : `${a.class} · ${formatAge(a.birth_date)}`}
                        </span>
                      </span>
                      <span className="sire-row__breeds" style={{ minWidth: 0, fontSize: 13 }}>
                        {mine.length === 0 ? (
                          <span style={{ color: "var(--ink-faint)" }}>no breeds on file</span>
                        ) : (
                          <>
                            {mine
                              .map((c) =>
                                Number(c.percent) === 100
                                  ? breedName(c.breed_id)
                                  : `${Number(c.percent)}% ${breedName(c.breed_id)}`,
                              )
                              .join(", ")}
                            <span style={{ color: "var(--ink-muted)" }}> · {a.purpose}</span>
                          </>
                        )}
                        <br />
                        <button
                          type="button"
                          className="link-button mono"
                          onClick={() => setComposing(composing === a.id ? null : a.id)}
                        >
                          {composing === a.id ? "cancel" : mine.length === 0 ? "set breeds" : "change"}
                        </button>
                        {" · "}
                        <button
                          type="button"
                          className="link-button mono"
                          onClick={() => {
                            if (editingId === a.id) {
                              setEditingId(null);
                              setEditDraft(null);
                              return;
                            }
                            setComposing(null);
                            setEditingId(a.id);
                            setEditDraft(null);
                            setError(null);
                            // Read fresh: the list doesn't carry his
                            // registration number, and a blank field here
                            // would write a blank over it.
                            void fetchSireDraft(a.id)
                              .then(setEditDraft)
                              .catch((err) => setError(err instanceof Error ? err.message : String(err)));
                          }}
                        >
                          {editingId === a.id ? "cancel" : "edit"}
                        </button>
                      </span>
                      <span className="mono sire-row__straws">
                        {s ? `${s.straws} straw${s.straws === 1 ? "" : "s"}` : "no semen"}
                      </span>
                      <span className="mono sire-row__value hide-sm">
                        {s && s.valueCents > 0 ? formatMoney(s.valueCents) : ""}
                      </span>
                    </div>

                    {editingId === a.id && (
                      <div className="sire-form" style={{ margin: "12px 0" }}>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>
                          Editing {sireName(a)}
                        </div>
                        {editDraft === null ? (
                          <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Reading his record…</p>
                        ) : (
                          <>
                            <div className="sire-form__fields">
                              <Field
                                label="Name"
                                value={editDraft.barnName}
                                onChange={(v) => setEditDraft({ ...editDraft, barnName: v })}
                              />
                              <Field
                                label="Tag or code"
                                value={editDraft.earTag}
                                onChange={(v) => setEditDraft({ ...editDraft, earTag: v })}
                              />
                              <Field
                                label="Registration"
                                value={editDraft.registrationNumber}
                                onChange={(v) => setEditDraft({ ...editDraft, registrationNumber: v })}
                              />
                              <label style={{ fontSize: 13 }}>
                                <div className="eyebrow">Birth date</div>
                                <input
                                  className="gene-select"
                                  type="date"
                                  value={editDraft.birthDate}
                                  aria-label="Birth date"
                                  onChange={(e) => setEditDraft({ ...editDraft, birthDate: e.target.value })}
                                />
                              </label>
                              <Field
                                label="Notes"
                                value={editDraft.notes}
                                onChange={(v) => setEditDraft({ ...editDraft, notes: v })}
                              />
                            </div>
                            <div
                              style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}
                            >
                              <Button
                                variant="filled"
                                size="sm"
                                disabled={busy || validateSire(editDraft, todayIso()) !== null}
                                onClick={() => {
                                  setBusy(true);
                                  setError(null);
                                  updateSire(a.id, editDraft)
                                    .then(() => {
                                      setEditingId(null);
                                      setEditDraft(null);
                                      setNote(`${editDraft.barnName.trim() || "That bull"} updated.`);
                                      return refresh();
                                    })
                                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                                    .finally(() => setBusy(false));
                                }}
                              >
                                {busy ? "Saving…" : "Save"}
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditDraft(null);
                                }}
                              >
                                Cancel
                              </Button>
                              <span style={{ fontSize: 13, color: "var(--red)" }}>
                                {validateSire(editDraft, todayIso())}
                              </span>
                            </div>
                            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                              He's <strong>{a.purpose}</strong>, which follows from his breeds rather than being a
                              field — set them above and this follows. His sex, class and whether he lives here
                              aren't editable either: turning a catalogue bull into a resident one would put him in
                              the herd's counts, a different decision from fixing a typo.
                            </p>
                          </>
                        )}
                      </div>
                    )}

                    {composing === a.id && (
                      <div style={{ padding: "12px 8px" }}>
                        <BreedEditor
                          animalId={a.id}
                          farmId={farmId}
                          current={mine.map((c) => ({ breedId: c.breed_id, percent: Number(c.percent) }))}
                          onCancel={() => setComposing(null)}
                          onSaved={() => {
                            setComposing(null);
                            setNote(`${sireName(a)}'s breeds saved — calves he sires will inherit half from him.`);
                            void refresh();
                          }}
                        />
                      </div>
                    )}
                  </div>
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
const EMPTY_SHARES: BreedShare[] = [];
const EMPTY_BREEDS: Breed[] = [];
