import { useState } from "react";
import { Button, Callout, GridRow, Pill } from "../ui";
import {
  KmlError,
  longAxis,
  nearestCompassDeg,
  parseKml,
  proposeGround,
  sweepLengthFtAlong,
  toPayload,
  type ImportRow,
  type KmlShape,
  type Role,
} from "../../lib/kml";
import { importGround, SWEEP_HEADINGS, type Pasture } from "../../lib/grazing";

/**
 * Setting up a pasture from a drawn file.
 *
 * The farmer draws the place in Google Earth — most already have, because
 * that is how you look at your own ground — and this reads the shapes out of
 * it, measures them, and proposes which is the pasture and which are paddocks
 * on it. Migration 040 did exactly this work for this farm by hand, and found
 * that units carrying a flat 1.91 acres each actually run 1.38 to 2.26.
 *
 * **It proposes; the farmer decides.** A KML has folders but nothing that
 * says "these are subdivisions of that", so the nesting is computed from
 * containment and shown as a pre-picked choice with its reason beside it.
 * Every row can be overruled, renamed, or dropped before anything is written.
 *
 * **Nothing is written until the whole thing is agreed**, and then it is
 * written in one transaction — a name clash on the last paddock leaves the
 * farm exactly as it was rather than half a map and an error.
 *
 * **The file never leaves the browser.** It is read with `file.text()` and
 * parsed here. Only the geometry that survives the review is sent.
 */

const COLS = "minmax(0, 1fr) 92px 120px";
const COLS_SM = "minmax(0, 1fr) 92px";

const ROLES: { value: Role; label: string }[] = [
  { value: "pasture", label: "The pasture" },
  { value: "paddock", label: "A paddock" },
  { value: "skip", label: "Leave it out" },
];

type Stage =
  | { at: "picking" }
  | { at: "reviewing"; rows: ImportRow[]; because: Map<string, string>; fileName: string; dropped: number };

const measure = (s: KmlShape): string => {
  if (s.acres !== null) return `${s.acres.toFixed(2)} ac`;
  if (s.lengthFt !== null) return `${Math.round(s.lengthFt)} ft`;
  return "—";
};

const kindLabel: Record<KmlShape["kind"], string> = {
  polygon: "area",
  line: "line",
  point: "marker",
};

const compassName = (deg: number): string =>
  SWEEP_HEADINGS.find((h) => h.deg === nearestCompassDeg(deg))?.label ?? `${deg}°`;

/**
 * Which way the shape runs, in words, for the line under the picker.
 *
 * The axis is geometry and worth saying — a unit is nearly always swept along
 * its long side, so the wire stays short. Which *end* of that axis you start
 * from is not in the drawing, so both are offered and neither is chosen.
 */
const axisNote = (shape: KmlShape): string | null => {
  const axis = longAxis(shape);
  if (axis === null) return null;
  const a = compassName(axis.deg);
  const b = compassName(axis.oppositeDeg);
  return `longest ${a}–${b}, ${Math.round(axis.lengthFt)} ft`;
};

export function KmlImport({
  farmId,
  pastures,
  onImported,
  onCancel,
}: {
  farmId: string;
  pastures: Pasture[];
  onImported: (said: string) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ at: "picking" });
  const [existingPastureId, setExistingPastureId] = useState("");
  const [pastureName, setPastureName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    try {
      const shapes = parseKml(await file.text());
      const proposal = proposeGround(shapes);
      const because = new Map(proposal.map((p) => [p.shapeId, p.because]));
      const rows: ImportRow[] = shapes.map((s, i) => ({
        shape: s,
        role: proposal[i].role,
        name: s.name,
        rotationOrder: null,
        // Not pre-picked. See `longAxis`: the drawing knows which way the
        // unit is longest, and nothing about which end the gate is at.
        sweepHeadingDeg: null,
      }));
      const pasture = rows.find((r) => r.role === "pasture");
      setPastureName(pasture?.name ?? "");
      setStage({ at: "reviewing", rows, because, fileName: file.name, dropped: 0 });
    } catch (err) {
      // A KmlError is a sentence written for a farmer; anything else is not,
      // so it gets a sentence of its own rather than being shown raw.
      setError(
        err instanceof KmlError
          ? err.message
          : `That file couldn't be read: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const setRow = (id: string, patch: Partial<ImportRow>) =>
    setStage((s) =>
      s.at !== "reviewing"
        ? s
        : {
            ...s,
            rows: s.rows.map((r) =>
              r.shape.id !== id
                ? // Only one shape can be the pasture, so picking a new one
                  // demotes the old rather than leaving two.
                  patch.role === "pasture" && r.role === "pasture"
                  ? { ...r, role: "paddock" as Role }
                  : r
                : { ...r, ...patch },
            ),
          },
    );

  const doImport = async (rows: ImportRow[]) => {
    const payload = toPayload({
      rows,
      existingPastureId: existingPastureId === "" ? null : existingPastureId,
      pastureName:
        existingPastureId === ""
          ? pastureName
          : (pastures.find((p) => p.id === existingPastureId)?.name ?? ""),
    });
    if ("error" in payload) {
      setError(payload.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { paddocks } = await importGround(farmId, payload);
      onImported(
        `${payload.pasture.name} imported with ${paddocks} paddock${paddocks === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (stage.at === "picking") {
    return (
      <div className="grz-form">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          From a drawn file
        </div>
        <p className="kml-lede">
          If you have drawn this place in Google Earth, that file already knows the shape of every
          field in it. Pick the <code>.kml</code> and this will measure each one and offer to set
          them up — you say which shape is the pasture and which are paddocks before anything is
          saved.
        </p>

        <label className="kml-file">
          <span className="eyebrow">The file</span>
          <input
            type="file"
            accept=".kml,application/vnd.google-earth.kml+xml,text/xml"
            aria-label="KML file"
            onChange={(e) => void take(e.target.files?.[0])}
          />
        </label>

        {error !== null && <p className="gnd-error">{error}</p>}

        <p className="grz-optional">
          The file stays on this device — it is read here and only the boundaries you agree to are
          saved. A <code>.kmz</code> is a zipped <code>.kml</code>; unzip it and use the file
          inside.
        </p>

        <div className="grz-form__actions">
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    );
  }

  const { rows, because, fileName } = stage;
  const asPasture = rows.find((r) => r.role === "pasture") ?? null;
  const asPaddocks = rows.filter((r) => r.role === "paddock");
  const intoExisting = existingPastureId !== "";
  const totalAcres = asPaddocks.reduce((sum, r) => sum + (r.shape.acres ?? 0), 0);

  // Google Earth calls everything "Untitled Polygon", so a file of five
  // fields routinely arrives with five identical names. Both `toPayload` and
  // the server refuse that, but only once Import has been pressed — and by
  // then the farmer has stopped reading the screen. Said here instead, while
  // the names are still under the cursor.
  // Matched case-insensitively, because the database is, but reported as the
  // farmer spelled it — "both called untitled polygon" when they typed
  // "Untitled Polygon" reads like the app renaming things behind them.
  const firstSpelling = new Map<string, string>();
  const repeated: string[] = [];
  for (const r of asPaddocks) {
    const key = r.name.trim().toLowerCase();
    if (key === "") continue;
    const first = firstSpelling.get(key);
    if (first === undefined) firstSpelling.set(key, r.name.trim());
    else if (!repeated.includes(first)) repeated.push(first);
  }

  return (
    <div className="grz-form">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {fileName}
      </div>

      <p className="kml-lede">
        {rows.length} shape{rows.length === 1 ? "" : "s"} in this file. Each one is measured off the
        drawing — check what it made of them before saving.
      </p>

      <div style={{ margin: "12px 0" }}>
        <Callout>
          Acres here are of the shape as drawn, which includes the pond, the rock and the shade.
          They are recorded as <strong>measured</strong> acres; what the herd can actually eat off
          is yours to set afterwards, per paddock.
        </Callout>
      </div>

      <div className="grz-form__row">
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Put these on</span>
          <select
            value={existingPastureId}
            onChange={(e) => setExistingPastureId(e.target.value)}
            aria-label="Put these on"
          >
            <option value="">A new pasture from this file</option>
            {pastures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (already on file)
              </option>
            ))}
          </select>
        </label>
        {!intoExisting && (
          <label className="grz-field grz-field--wide">
            <span className="eyebrow">Call the pasture</span>
            <input
              value={pastureName}
              onChange={(e) => setPastureName(e.target.value)}
              aria-label="Call the pasture"
              placeholder="Home place"
            />
          </label>
        )}
      </div>

      {intoExisting && (
        <p className="grz-optional">
          The paddocks below will be added to it. Whatever shape is marked as the pasture is left
          out — that land is already on file.
        </p>
      )}

      <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
        <span>Shape, and what it is</span>
        <span className="text-right">Measures</span>
        <span className="hide-sm">No. in round</span>
      </GridRow>

      {rows.map((r) => (
        <GridRow
          key={r.shape.id}
          cols={COLS}
          mobileCols={COLS_SM}
          as="body"
          highlight={r.role === "skip"}
        >
          <span style={{ minWidth: 0 }}>
            <input
              className="kml-name"
              value={r.name}
              onChange={(e) => setRow(r.shape.id, { name: e.target.value })}
              aria-label={`Name for ${r.shape.name}`}
              disabled={r.role === "skip"}
            />
            <span className="kml-meta">
              {[kindLabel[r.shape.kind], r.shape.folder, because.get(r.shape.id)]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {/* The decision, directly under the thing being decided, and in
                the one cell no screen width drops — a review with the role
                picker hidden is not a review. One control, not one per
                breakpoint: two selects with the same label is two controls
                to a screen reader however the CSS hides them. */}
            <span className="kml-picks">
              <select
                className="kml-role"
                value={r.role}
                onChange={(e) => setRow(r.shape.id, { role: e.target.value as Role })}
                aria-label={`What ${r.shape.name} is`}
              >
                {ROLES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              {/* Asked here rather than left for afterwards. Without it the
                  unit draws on the map but has no wire on Move, prints no
                  strips on the payment record, and its strip acreage falls
                  back to a flat fraction of the whole — which measured up to
                  94% wrong on this farm's own tapering unit. */}
              {r.role === "paddock" && (
                <select
                  className="kml-role"
                  value={r.sweepHeadingDeg === null ? "" : String(r.sweepHeadingDeg)}
                  onChange={(e) =>
                    setRow(r.shape.id, {
                      sweepHeadingDeg: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  aria-label={`Which way strips run on ${r.shape.name}`}
                >
                  <option value="">Not stripped — taken whole</option>
                  {SWEEP_HEADINGS.map((h) => (
                    <option key={h.deg} value={String(h.deg)}>
                      {`strips toward the ${h.label}`}
                    </option>
                  ))}
                </select>
              )}
            </span>

            {r.role === "paddock" && (
              <span className="kml-meta">
                {r.sweepHeadingDeg === null
                  ? (axisNote(r.shape) ?? "")
                  : `${Math.round(sweepLengthFtAlong(r.shape, r.sweepHeadingDeg) ?? 0)} ft across, off the drawing`}
              </span>
            )}
          </span>

          <span className="mono text-right kml-measure">{measure(r.shape)}</span>

          <span className="hide-sm">
            {r.role === "paddock" ? (
              <input
                className="kml-order"
                value={r.rotationOrder === null ? "" : String(r.rotationOrder)}
                inputMode="numeric"
                aria-label={`Number in the round for ${r.shape.name}`}
                onChange={(e) =>
                  setRow(r.shape.id, {
                    rotationOrder: e.target.value.trim() === "" ? null : Number(e.target.value),
                  })
                }
              />
            ) : (
              <span className="kml-meta">—</span>
            )}
          </span>
        </GridRow>
      ))}

      <p className="kml-tally">
        {asPaddocks.length === 0 ? (
          "Nothing is marked as a paddock yet."
        ) : (
          <>
            <strong>{asPaddocks.length}</strong> paddock{asPaddocks.length === 1 ? "" : "s"},{" "}
            {totalAcres.toFixed(2)} acres between them
            {asPasture && asPasture.shape.acres !== null && !intoExisting && (
              <>
                {" "}
                · <Pill variant="outline-green">{asPasture.shape.acres.toFixed(2)} ac drawn</Pill>
              </>
            )}
          </>
        )}
      </p>

      {repeated.length > 0 && (
        <p className="kml-warn">
          {repeated.length === 1
            ? `Two of these are both called "${repeated[0]}" — give them different names before importing.`
            : `Some of these share a name (${repeated.join(", ")}) — give them different names before importing.`}
        </p>
      )}

      {error !== null && <p className="gnd-error">{error}</p>}

      <div className="grz-form__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={() => setStage({ at: "picking" })}>Pick another file</Button>
        <Button variant="filled" disabled={busy} onClick={() => void doImport(rows)}>
          {busy ? "Importing…" : "Import this ground"}
        </Button>
      </div>
    </div>
  );
}
