import { useCallback, useEffect, useMemo, useState } from "react";
import { Pill, Button, StatTile, GridRow, Callout, SaveToast } from "../components/ui";
import { KmlImport } from "../components/herd/KmlImport";
import { useWorkspace } from "../lib/workspace";
import {
  deletePaddock,
  deletePasture,
  drawnSweepLengthFt,
  fetchPaddocks,
  fetchPastures,
  savePaddock,
  savePasture,
  SWEEP_HEADINGS,
  type Paddock,
  type PaddockUnitType,
  type Pasture,
} from "../lib/grazing";
import "./grazing.css";
import "./ground.css";

/**
 * The ground: pastures, and the paddocks on them.
 *
 * Settings rather than Grazing, because this is the farm as it *is* — the
 * shape of the place, set up once and changed when a field is rented or a
 * fence moves. Grazing → Paddocks is the other half: the same units, read as
 * a board, sorted by which one is ready. Nothing is edited there.
 *
 * Four levels, and each one is a real thing:
 *
 *   farm → **pasture** → **paddock** → strip
 *
 * A strip has no row of its own and never will. It is the slice taken behind
 * the wire on one move, recorded on the move — so what a paddock carries here
 * is the *axis* those strips run along: a heading, and how far it is across.
 * Give a paddock a heading and the Move page starts offering a wire position
 * on it; leave it off and the paddock is taken whole.
 *
 * **Removing is not the same as retiring**, and the difference is the record.
 * Ground the herd has been on is named by every move that happened there and
 * printed on the payment record against every strip, so the server refuses to
 * remove it and this page offers to retire it instead. Retired ground leaves
 * the board and the rotation; its history reads back exactly as before.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; pastures: Pasture[]; paddocks: Paddock[] };

const PADDOCK_COLS = "minmax(0, 1fr) 96px 140px 118px";
const PADDOCK_COLS_SM = "minmax(0, 1fr) 96px";

/** Shared with the KML review, so both pickers say the same words. */
const COMPASS = SWEEP_HEADINGS;

const UNIT_TYPES: { value: PaddockUnitType; label: string }[] = [
  { value: "permanent", label: "Permanent fence" },
  { value: "temporary", label: "Temporary wire" },
  { value: "virtual", label: "Virtual fence (collars)" },
];

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const text = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** The column is headed "Strips", so the row says the direction and no more —
 *  "strips west, 400 ft across" wrapped every row onto three lines. */
const headingLabel = (deg: number | null): string => {
  if (deg === null) return "taken whole";
  const named = COMPASS.find((c) => c.deg === deg);
  return named ? named.label : `${deg}°`;
};

/** What the two columns a phone drops would have said, for the line under the
 *  name that replaces them. Dropping them outright would hide the strip setup
 *  on the screen this is most likely to be edited from. */
const strip = (p: Paddock): string =>
  [
    headingLabel(p.sweepHeadingDeg),
    p.sweepHeadingDeg !== null && p.sweepLengthFt !== null ? `${p.sweepLengthFt} ft across` : null,
    p.rotationOrder === null ? "not in the round" : `no. ${p.rotationOrder}`,
  ]
    .filter(Boolean)
    .join(" · ");

interface PastureForm {
  id: string | null;
  name: string;
  code: string;
  acres: string;
  notes: string;
  active: boolean;
}

interface PaddockForm {
  id: string | null;
  /** The row this was opened from, kept for its boundary — the drawing is
   *  what answers "how far across", once a direction is picked. */
  drawn: Paddock | null;
  pastureId: string;
  name: string;
  code: string;
  acresMeasured: string;
  acresGrazable: string;
  unitType: PaddockUnitType;
  rotationOrder: string;
  sweepHeadingDeg: string;
  sweepLengthFt: string;
  fenceType: string;
  notes: string;
  active: boolean;
}

const blankPasture = (): PastureForm => ({
  id: null, name: "", code: "", acres: "", notes: "", active: true,
});

const blankPaddock = (pastureId: string): PaddockForm => ({
  id: null, drawn: null, pastureId, name: "", code: "", acresMeasured: "", acresGrazable: "",
  unitType: "permanent", rotationOrder: "", sweepHeadingDeg: "", sweepLengthFt: "",
  fenceType: "", notes: "", active: true,
});

export default function Ground() {
  const { farmId, role } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [pastureForm, setPastureForm] = useState<PastureForm | null>(null);
  const [paddockForm, setPaddockForm] = useState<PaddockForm | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** A removal the server refused. Held so the page can offer the way out. */
  const [stuck, setStuck] = useState<{ paddockId: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const readOnly = role !== null && !["owner", "helper", "vet"].includes(role);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [pastures, paddocks] = await Promise.all([fetchPastures(farmId), fetchPaddocks(farmId)]);
    setLoad({ state: "ok", pastures, paddocks });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const pastures = load.state === "ok" ? load.pastures : EMPTY_PASTURES;
  const paddocks = load.state === "ok" ? load.paddocks : EMPTY_PADDOCKS;

  const held = useMemo(() => {
    const by = new Map<string, Paddock[]>();
    for (const p of paddocks) {
      const key = p.pastureId ?? "";
      const list = by.get(key);
      if (list) list.push(p);
      else by.set(key, [p]);
    }
    return by;
  }, [paddocks]);

  const unassigned = held.get("") ?? EMPTY_PADDOCKS;
  const grazable = paddocks
    .filter((p) => p.active)
    .reduce((sum, p) => sum + (p.acresGrazable ?? p.acresMeasured ?? 0), 0);

  const run = async (what: () => Promise<unknown>, said: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    setStuck(null);
    try {
      await what();
      await refresh();
      setNote(said);
      setPastureForm(null);
      setPaddockForm(null);
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const savePastureForm = (form: PastureForm) => {
    if (!farmId) return;
    void run(
      () =>
        savePasture(farmId, form.id, {
          name: form.name,
          code: text(form.code),
          acres: num(form.acres),
          notes: text(form.notes),
          active: form.active,
        }),
      form.id === null ? `${form.name.trim()} added.` : `${form.name.trim()} saved.`,
    );
  };

  const savePaddockForm = (form: PaddockForm) => {
    if (!farmId) return;
    void run(
      () =>
        savePaddock(farmId, form.id, {
          name: form.name,
          pastureId: form.pastureId === "" ? null : form.pastureId,
          code: text(form.code),
          acresMeasured: num(form.acresMeasured),
          acresGrazable: num(form.acresGrazable),
          unitType: form.unitType,
          rotationOrder: num(form.rotationOrder),
          sweepHeadingDeg: num(form.sweepHeadingDeg),
          sweepLengthFt: num(form.sweepLengthFt),
          fenceType: text(form.fenceType),
          notes: text(form.notes),
          active: form.active,
        }),
      form.id === null ? `${form.name.trim()} added.` : `${form.name.trim()} saved.`,
    );
  };

  /** Try to remove it; if the server says it has history, offer to retire. */
  const removePaddock = async (p: Paddock) => {
    if (!farmId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setStuck(null);
    try {
      await deletePaddock(farmId, p.id);
      await refresh();
      setNote(`${p.name} removed.`);
      setConfirming(null);
    } catch (err) {
      setStuck({ paddockId: p.id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const retirePaddock = (p: Paddock) =>
    void run(
      () =>
        savePaddock(farmId!, p.id, {
          name: p.name,
          pastureId: p.pastureId,
          code: p.code,
          acresMeasured: p.acresMeasured,
          acresGrazable: p.acresGrazable,
          unitType: p.unitType,
          rotationOrder: null,
          sweepHeadingDeg: p.sweepHeadingDeg,
          sweepLengthFt: p.sweepLengthFt,
          fenceType: p.fenceType,
          notes: p.notes,
          active: !p.active,
        }),
      p.active
        ? `${p.name} retired. Its moves are still on file.`
        : `${p.name} is back in use — give it a rotation number to put it in the round.`,
    );

  const startEditPaddock = (p: Paddock) => {
    setPaddockForm({
      id: p.id,
      drawn: p,
      pastureId: p.pastureId ?? "",
      name: p.name,
      code: p.code ?? "",
      acresMeasured: p.acresMeasured === null ? "" : String(p.acresMeasured),
      acresGrazable: p.acresGrazable === null ? "" : String(p.acresGrazable),
      unitType: p.unitType,
      rotationOrder: p.rotationOrder === null ? "" : String(p.rotationOrder),
      sweepHeadingDeg: p.sweepHeadingDeg === null ? "" : String(p.sweepHeadingDeg),
      sweepLengthFt: p.sweepLengthFt === null ? "" : String(p.sweepLengthFt),
      fenceType: p.fenceType ?? "",
      notes: p.notes ?? "",
      active: p.active,
    });
    setPastureForm(null);
    setError(null);
    setNote(null);
    setStuck(null);
  };

  const startEditPasture = (p: Pasture) => {
    setPastureForm({
      id: p.id,
      name: p.name,
      code: p.code ?? "",
      acres: p.acres === null ? "" : String(p.acres),
      notes: p.notes ?? "",
      active: p.active,
    });
    setPaddockForm(null);
    setError(null);
    setNote(null);
    setStuck(null);
  };

  return (
    <>
      {load.state === "loading" && <p className="gnd-quiet">Loading…</p>}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load the ground: {load.message}
        </p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={pastures.length || "—"} label="Pastures" />
            <StatTile value={paddocks.filter((p) => p.active).length || "—"} label="Paddocks in use" />
            <StatTile value={grazable > 0 ? grazable.toFixed(2) : "—"} label="Grazable acres" />
          </div>

          {error && <p className="gnd-error">{error}</p>}
          <SaveToast note={note} onDone={() => setNote(null)} />

          <div style={{ margin: "12px 0" }}>
            <Callout>
              A <strong>pasture</strong> is a piece of land — the home place, the rented forty. A{" "}
              <strong>paddock</strong> is a subdivision of one, and it is what a move is recorded against. Give a
              paddock a strip heading and the Move page will offer a wire position across it; leave it off and the
              paddock is grazed whole.
            </Callout>
          </div>

          {!readOnly && pastureForm === null && paddockForm === null && !importing && (
            <div className="gnd-actions">
              <Button variant="filled" onClick={() => setPastureForm(blankPasture())}>
                Add a pasture
              </Button>
              {pastures.length > 0 && (
                <Button onClick={() => setPaddockForm(blankPaddock(pastures[0].id))}>Add a paddock</Button>
              )}
              {/* Second, not first: typing one field beats reading a review
                  screen when there is one field's worth of ground to add. It
                  earns its place on a farm that already has the place drawn. */}
              <Button onClick={() => { setImporting(true); setError(null); setNote(null); }}>
                Import from a KML
              </Button>
            </div>
          )}

          {importing && farmId !== null && (
            <KmlImport
              farmId={farmId}
              pastures={pastures}
              onCancel={() => setImporting(false)}
              onImported={(said) => {
                setImporting(false);
                setNote(said);
                void refresh();
              }}
            />
          )}

          {pastureForm !== null && (
            <PastureEditor
              form={pastureForm}
              busy={busy}
              onChange={setPastureForm}
              onSave={() => savePastureForm(pastureForm)}
              onCancel={() => setPastureForm(null)}
            />
          )}

          {paddockForm !== null && (
            <PaddockEditor
              form={paddockForm}
              pastures={pastures}
              busy={busy}
              onChange={setPaddockForm}
              onSave={() => savePaddockForm(paddockForm)}
              onCancel={() => setPaddockForm(null)}
            />
          )}

          {pastures.length === 0 && unassigned.length === 0 && (
            <p className="gnd-quiet">
              No ground on file yet. Add a pasture first — the piece of land — then the paddocks on it.
            </p>
          )}

          {pastures.map((pasture) => {
            const mine = held.get(pasture.id) ?? EMPTY_PADDOCKS;
            // Counted and totalled on the same basis. The acres have always
            // been of the paddocks in use, so a count of every paddock ever
            // put a "4 paddocks · 5.91 grazable" on the page where the 5.91
            // was three of them.
            const inUse = mine.filter((p) => p.active);
            const retired = mine.length - inUse.length;
            const fenced = inUse.reduce((sum, p) => sum + (p.acresGrazable ?? p.acresMeasured ?? 0), 0);
            return (
              <section key={pasture.id} className="gnd-pasture">
                <div className="gnd-pasture__head">
                  <div style={{ minWidth: 0 }}>
                    <h2 className="serif gnd-pasture__name">
                      {pasture.name}
                      {pasture.code && <span className="mono gnd-code"> {pasture.code}</span>}
                      {!pasture.active && (
                        <>
                          {" "}
                          <Pill>not in use</Pill>
                        </>
                      )}
                    </h2>
                    <p className="gnd-pasture__sub">
                      {[
                        pasture.acres === null ? null : `${pasture.acres} acres deeded`,
                        `${inUse.length} paddock${inUse.length === 1 ? "" : "s"}`,
                        fenced > 0 ? `${fenced.toFixed(2)} grazable` : null,
                        retired > 0 ? `${retired} retired` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {pasture.notes && <p className="gnd-pasture__notes">{pasture.notes}</p>}
                  </div>
                  {!readOnly && (
                    <div className="gnd-pasture__acts">
                      {/* The visible word is short because the row is
                          narrow; the accessible name says which thing it
                          acts on, since a pasture and every paddock under it
                          would otherwise all offer an unqualified "edit". */}
                      <button
                        type="button"
                        className="link-button mono"
                        aria-label={`edit ${pasture.name}`}
                        onClick={() => startEditPasture(pasture)}
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        className="link-button mono"
                        aria-label={`add a paddock to ${pasture.name}`}
                        onClick={() => {
                          setPaddockForm(blankPaddock(pasture.id));
                          setPastureForm(null);
                        }}
                      >
                        add a paddock
                      </button>
                      {confirming === pasture.id ? (
                        <>
                          <button
                            type="button"
                            className="link-button mono gnd-danger"
                            disabled={busy}
                            aria-label={`really remove ${pasture.name}`}
                            onClick={() =>
                              void run(() => deletePasture(farmId!, pasture.id), `${pasture.name} removed.`)
                            }
                          >
                            really remove
                          </button>
                          <button
                            type="button"
                            className="link-button mono"
                            aria-label={`keep ${pasture.name}`}
                            onClick={() => setConfirming(null)}
                          >
                            keep it
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="link-button mono gnd-danger"
                          aria-label={`remove ${pasture.name}`}
                          onClick={() => setConfirming(pasture.id)}
                        >
                          remove
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <PaddockList
                  paddocks={mine}
                  readOnly={readOnly}
                  busy={busy}
                  stuck={stuck}
                  confirming={confirming}
                  onEdit={startEditPaddock}
                  onConfirm={setConfirming}
                  onRemove={removePaddock}
                  onRetire={retirePaddock}
                  empty="Nothing fenced on this pasture yet."
                />
              </section>
            );
          })}

          {unassigned.length > 0 && (
            <section className="gnd-pasture">
              <div className="gnd-pasture__head">
                <div>
                  <h2 className="serif gnd-pasture__name">Not on a pasture yet</h2>
                  <p className="gnd-pasture__sub">
                    {unassigned.length} paddock{unassigned.length === 1 ? "" : "s"} recorded before pastures
                    existed. Edit one to say which piece of land it is on.
                  </p>
                </div>
              </div>
              <PaddockList
                paddocks={unassigned}
                readOnly={readOnly}
                busy={busy}
                stuck={stuck}
                confirming={confirming}
                onEdit={startEditPaddock}
                onConfirm={setConfirming}
                onRemove={removePaddock}
                onRetire={retirePaddock}
                empty=""
              />
            </section>
          )}
        </>
      )}
    </>
  );
}

function PaddockList({
  paddocks,
  readOnly,
  busy,
  stuck,
  confirming,
  onEdit,
  onConfirm,
  onRemove,
  onRetire,
  empty,
}: {
  paddocks: Paddock[];
  readOnly: boolean;
  busy: boolean;
  stuck: { paddockId: string; message: string } | null;
  confirming: string | null;
  onEdit: (p: Paddock) => void;
  onConfirm: (id: string | null) => void;
  onRemove: (p: Paddock) => void;
  onRetire: (p: Paddock) => void;
  empty: string;
}) {
  if (paddocks.length === 0) {
    return empty === "" ? null : <p className="gnd-quiet">{empty}</p>;
  }

  const inOrder = [...paddocks].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const ao = a.rotationOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.rotationOrder ?? Number.MAX_SAFE_INTEGER;
    return ao === bo ? a.name.localeCompare(b.name) : ao - bo;
  });

  return (
    <>
      <GridRow cols={PADDOCK_COLS} mobileCols={PADDOCK_COLS_SM} as="header">
        <span>Paddock</span>
        <span className="text-right">Grazable</span>
        <span className="hide-sm">Strips</span>
        <span className="hide-sm">In the round</span>
      </GridRow>

      {inOrder.map((p) => (
        <div key={p.id}>
          <GridRow cols={PADDOCK_COLS} mobileCols={PADDOCK_COLS_SM} as="body" highlight={!p.active}>
            <span style={{ minWidth: 0 }}>
              <span className="serif" style={{ fontSize: 17 }}>
                {p.name}
              </span>
              {p.code && <span className="mono gnd-code"> {p.code}</span>}
              {!p.active && (
                <>
                  {" "}
                  <Pill>retired</Pill>
                </>
              )}
              <span className="gnd-onsmall gnd-dim">{strip(p)}</span>
              {!readOnly && (
                <>
                  <br />
                  <span className="gnd-row-acts">
                    <button
                      type="button"
                      className="link-button mono"
                      aria-label={`edit ${p.name}`}
                      onClick={() => onEdit(p)}
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      className="link-button mono"
                      aria-label={p.active ? `retire ${p.name}` : `put ${p.name} back in use`}
                      onClick={() => onRetire(p)}
                    >
                      {p.active ? "retire" : "put back in use"}
                    </button>
                    {confirming === p.id ? (
                      <>
                        <button
                          type="button"
                          className="link-button mono gnd-danger"
                          disabled={busy}
                          aria-label={`really remove ${p.name}`}
                          onClick={() => onRemove(p)}
                        >
                          really remove
                        </button>
                        <button
                          type="button"
                          className="link-button mono"
                          aria-label={`keep ${p.name}`}
                          onClick={() => onConfirm(null)}
                        >
                          keep it
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="link-button mono gnd-danger"
                        aria-label={`remove ${p.name}`}
                        onClick={() => onConfirm(p.id)}
                      >
                        remove
                      </button>
                    )}
                  </span>
                </>
              )}
            </span>
            <span className="mono text-right">
              {p.acresGrazable ?? p.acresMeasured ?? "—"}
              {p.acresGrazable !== null || p.acresMeasured !== null ? " ac" : ""}
            </span>
            <span className="hide-sm gnd-dim">
              {headingLabel(p.sweepHeadingDeg)}
              {p.sweepHeadingDeg !== null && p.sweepLengthFt !== null && `, ${p.sweepLengthFt} ft`}
            </span>
            <span className="hide-sm gnd-dim">
              {p.rotationOrder === null ? "not in the round" : `no. ${p.rotationOrder}`}
            </span>
          </GridRow>

          {stuck !== null && stuck.paddockId === p.id && (
            <div className="gnd-stuck">
              <p>{stuck.message}</p>
              <Button size="sm" disabled={busy} onClick={() => onRetire(p)}>
                {`Retire ${p.name} instead`}
              </Button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function PastureEditor({
  form,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  form: PastureForm;
  busy: boolean;
  onChange: (f: PastureForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof PastureForm>(k: K, v: PastureForm[K]) => onChange({ ...form, [k]: v });

  return (
    <div className="grz-form">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {form.id === null ? "A new pasture" : `Editing ${form.name}`}
      </div>
      <div className="grz-form__row">
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Name</span>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            aria-label="Pasture name"
            placeholder="Home place"
          />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Short code</span>
          <input value={form.code} onChange={(e) => set("code", e.target.value)} aria-label="Pasture code" />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Acres (deeded)</span>
          <input
            value={form.acres}
            onChange={(e) => set("acres", e.target.value)}
            inputMode="decimal"
            aria-label="Pasture acres"
          />
        </label>
      </div>
      <p className="grz-optional">
        Deeded acres are what the map says, lanes and woods included. What is actually grazable adds up from the
        paddocks on it, so the two are kept apart rather than one being made to stand for the other.
      </p>
      <div className="grz-form__row">
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Notes</span>
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} aria-label="Pasture notes" />
        </label>
        <label className="grz-field gnd-check">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
            aria-label="Pasture in use"
          />
          <span>In use</span>
        </label>
      </div>
      <div className="grz-form__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="filled" disabled={busy || form.name.trim() === ""} onClick={onSave}>
          {busy ? "Saving…" : form.id === null ? "Add it" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function PaddockEditor({
  form,
  pastures,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  form: PaddockForm;
  pastures: Pasture[];
  busy: boolean;
  onChange: (f: PaddockForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof PaddockForm>(k: K, v: PaddockForm[K]) => onChange({ ...form, [k]: v });

  const heading = num(form.sweepHeadingDeg);
  const offCompass = heading !== null && !COMPASS.some((c) => c.deg === heading);
  // The form opens at the top of the page, which can be a long way from the
  // row that was clicked. It has to say what it is editing.
  const onPasture = pastures.find((p) => p.id === form.pastureId);

  return (
    <div className="grz-form">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {form.id === null
          ? onPasture
            ? `A new paddock on ${onPasture.name}`
            : "A new paddock"
          : `Editing ${form.name}`}
      </div>

      <div className="grz-form__row">
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Name</span>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            aria-label="Paddock name"
            placeholder="North strip"
          />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Short code</span>
          <input value={form.code} onChange={(e) => set("code", e.target.value)} aria-label="Paddock code" />
        </label>
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">On which pasture</span>
          <select
            value={form.pastureId}
            onChange={(e) => set("pastureId", e.target.value)}
            aria-label="On which pasture"
          >
            <option value="">— not said —</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grz-form__row">
        <label className="grz-field">
          <span className="eyebrow">Acres measured</span>
          <input
            value={form.acresMeasured}
            onChange={(e) => set("acresMeasured", e.target.value)}
            inputMode="decimal"
            aria-label="Acres measured"
          />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Acres grazable</span>
          <input
            value={form.acresGrazable}
            onChange={(e) => set("acresGrazable", e.target.value)}
            inputMode="decimal"
            aria-label="Acres grazable"
          />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Number in the round</span>
          <input
            value={form.rotationOrder}
            onChange={(e) => set("rotationOrder", e.target.value)}
            inputMode="numeric"
            aria-label="Number in the round"
          />
        </label>
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">How it is bounded</span>
          <select
            value={form.unitType}
            onChange={(e) => set("unitType", e.target.value as PaddockUnitType)}
            aria-label="How it is bounded"
          >
            {UNIT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="grz-optional">
        Grazable acres are what the herd can actually eat off — measured acres less the pond, the rock and the
        shade. Leave the number in the round blank for ground that is grazed when it suits rather than in order.
      </p>

      <div className="grz-form__row">
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Strips run</span>
          <select
            value={form.sweepHeadingDeg}
            onChange={(e) => {
              const deg = e.target.value;
              // The drawing already knows how far across it is in that
              // direction. Filled in only when the box is empty, so a figure
              // somebody measured with a wheel is never overwritten.
              const measured =
                deg === "" || form.drawn === null ? null : drawnSweepLengthFt(form.drawn, Number(deg));
              onChange({
                ...form,
                sweepHeadingDeg: deg,
                sweepLengthFt:
                  form.sweepLengthFt.trim() === "" && measured !== null
                    ? String(Math.round(measured))
                    : form.sweepLengthFt,
              });
            }}
            aria-label="Strips run"
          >
            <option value="">Not stripped — taken whole</option>
            {COMPASS.map((c) => (
              <option key={c.deg} value={String(c.deg)}>
                {`toward the ${c.label}`}
              </option>
            ))}
            {offCompass && <option value={form.sweepHeadingDeg}>{`at ${heading}° (as measured)`}</option>}
          </select>
        </label>
        <label className="grz-field">
          <span className="eyebrow">Feet across</span>
          <input
            value={form.sweepLengthFt}
            onChange={(e) => set("sweepLengthFt", e.target.value)}
            inputMode="decimal"
            aria-label="Feet across"
            disabled={form.sweepHeadingDeg === ""}
          />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Fence</span>
          <input
            value={form.fenceType}
            onChange={(e) => set("fenceType", e.target.value)}
            aria-label="Fence type"
            placeholder="polywire"
          />
        </label>
      </div>
      <p className="grz-optional">
        The heading is the way the wire advances across this paddock, and it is what makes strips possible here at
        all — the Move page offers a wire position on a paddock that has one, prints its strips on the payment
        record, and measures their acres off the boundary instead of as a flat share of the whole.
        {form.drawn?.boundary != null
          ? " This paddock is drawn, so the feet across are measured from it as soon as you pick a direction."
          : " Feet across lets it say how far in the wire is; without it the same move is recorded as a share of the paddock instead."}
      </p>

      <div className="grz-form__row">
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Notes</span>
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)} aria-label="Paddock notes" />
        </label>
        <label className="grz-field gnd-check">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
            aria-label="Paddock in use"
          />
          <span>In use</span>
        </label>
      </div>

      <div className="grz-form__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="filled" disabled={busy || form.name.trim() === ""} onClick={onSave}>
          {busy ? "Saving…" : form.id === null ? "Add it" : "Save"}
        </Button>
      </div>
    </div>
  );
}

const EMPTY_PASTURES: Pasture[] = [];
const EMPTY_PADDOCKS: Paddock[] = [];
