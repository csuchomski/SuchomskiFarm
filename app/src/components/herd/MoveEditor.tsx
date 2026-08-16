import { useState } from "react";
import { Button } from "../ui";
import { fromLocalInput, toLocalInput } from "../../lib/local-time";
import {
  deleteEffect,
  type GrazingEvent,
  type MoveEdit,
  type Paddock,
  type SoilMoisture,
} from "../../lib/grazing";

/**
 * Correcting one move.
 *
 * Two things about the shape of this form are load-bearing.
 *
 * **A move has one time.** What you edit here is when they *arrived*; when
 * they left is the next move's arrival, and it is shown but not editable
 * because it belongs to that move. On the last move in the chain there is no
 * next, so the departure becomes editable — and clearing it is how you put
 * the mob back on the grass after ending grazing by mistake.
 *
 * **The wire is a percentage of the sweep.** The record keeps fractions;
 * nobody reads a paddock as 0.38. It is shown and taken as a percentage, and
 * converted at the edge.
 */

const MOISTURE: { value: SoilMoisture | ""; label: string }[] = [
  { value: "", label: "—" },
  { value: "dry", label: "dry" },
  { value: "moist", label: "moist" },
  { value: "saturated", label: "saturated" },
];

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const pct = (f: number | null): string => (f === null ? "" : String(Math.round(f * 1000) / 10));

export function MoveEditor({
  event,
  events,
  paddocks,
  isLast,
  onSave,
  onDelete,
  onCancel,
}: {
  event: GrazingEvent;
  events: GrazingEvent[];
  paddocks: Paddock[];
  /** Nothing follows it in this mob's chain, so its departure is its own. */
  isLast: boolean;
  onSave: (edit: MoveEdit) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [paddockId, setPaddockId] = useState(event.paddockId);
  const [enteredAt, setEnteredAt] = useState(toLocalInput(event.enteredAt));
  const [exitedAt, setExitedAt] = useState(event.exitedAt === null ? "" : toLocalInput(event.exitedAt));
  const [headCount, setHeadCount] = useState(event.headCount === null ? "" : String(event.headCount));
  const [avgWeightLb, setAvgWeightLb] = useState(event.avgWeightLb === null ? "" : String(event.avgWeightLb));
  const [heightIn, setHeightIn] = useState(
    event.forageHeightInEntry === null ? "" : String(event.forageHeightInEntry),
  );
  const [residual, setResidual] = useState(
    event.residualHeightInExit === null ? "" : String(event.residualHeightInExit),
  );
  const [moisture, setMoisture] = useState<SoilMoisture | "">(event.soilMoisture ?? "");
  const [notes, setNotes] = useState(event.notes ?? "");
  const [from, setFrom] = useState(pct(event.sweptFrom));
  const [to, setTo] = useState(pct(event.sweptTo));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const arrived = fromLocalInput(enteredAt);
  const badTime = enteredAt.trim() !== "" && arrived === null;

  const save = async () => {
    if (arrived === null) {
      setError("That move needs a date and time for when they arrived.");
      return;
    }
    const f = num(from);
    const t = num(to);
    if ((f === null) !== (t === null)) {
      setError("A strip needs both ends of the wire, or neither.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        paddockId,
        enteredAt: arrived,
        // Only the last move may state its own departure; elsewhere the value
        // is the next move's arrival and is sent back untouched.
        exitedAt: isLast ? fromLocalInput(exitedAt) : event.exitedAt,
        headCount: num(headCount),
        avgWeightLb: num(avgWeightLb),
        forageHeightInEntry: num(heightIn),
        residualHeightInExit: num(residual),
        utilizationPct: event.utilizationPct,
        soilMoisture: moisture === "" ? null : moisture,
        notes,
        sweptFrom: f === null ? null : f / 100,
        sweptTo: t === null ? null : t / 100,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="grz-form mv-edit">
      <div className="grz-form__row">
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Which paddock</span>
          <select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Which paddock">
            {paddocks
              .filter((p) => p.active || p.id === paddockId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="grz-field">
          <span className="eyebrow">They arrived</span>
          <input
            type="datetime-local"
            value={enteredAt}
            onChange={(e) => setEnteredAt(e.target.value)}
            aria-label="They arrived"
          />
        </label>
        <label className="grz-field">
          <span className="eyebrow">They left</span>
          {isLast ? (
            <input
              type="datetime-local"
              value={exitedAt}
              onChange={(e) => setExitedAt(e.target.value)}
              aria-label="They left"
            />
          ) : (
            <input
              value={
                event.exitedAt === null
                  ? "—"
                  : new Date(event.exitedAt).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })
              }
              readOnly
              aria-label="They left"
              title="This is the next move's arrival. Edit that move to change it."
            />
          )}
        </label>
      </div>

      {!isLast && (
        <p className="grz-optional">
          They left when the next move says they arrived somewhere else — edit that move to change it.
        </p>
      )}
      {isLast && event.exitedAt !== null && (
        <p className="grz-optional">
          Clearing when they left puts them back on this ground, standing here now.
        </p>
      )}

      <div className="grz-form__row">
        <label className="grz-field">
          <span className="eyebrow">Head</span>
          <input value={headCount} onChange={(e) => setHeadCount(e.target.value)} inputMode="numeric" aria-label="Head" />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Average weight, lb</span>
          <input
            value={avgWeightLb}
            onChange={(e) => setAvgWeightLb(e.target.value)}
            inputMode="decimal"
            aria-label="Average weight, lb"
          />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Grass going in, in</span>
          <input value={heightIn} onChange={(e) => setHeightIn(e.target.value)} inputMode="decimal" aria-label="Grass going in, in" />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Grass coming off, in</span>
          <input value={residual} onChange={(e) => setResidual(e.target.value)} inputMode="decimal" aria-label="Grass coming off, in" />
        </label>
      </div>

      <div className="grz-form__row">
        <label className="grz-field">
          <span className="eyebrow">Wire from, %</span>
          <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="decimal" aria-label="Wire from, %" />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Wire to, %</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="decimal" aria-label="Wire to, %" />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Ground</span>
          <select
            value={moisture}
            onChange={(e) => setMoisture(e.target.value as SoilMoisture | "")}
            aria-label="Ground"
          >
            {MOISTURE.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="grz-field grz-field--wide">
        <span className="eyebrow">Notes</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
      </label>

      {error !== null && <p className="grz-warn">{error}</p>}

      {confirming ? (
        <div className="mv-edit__confirm">
          <p className="grz-warn" style={{ margin: "0 0 10px" }}>
            {deleteEffect(event, events)}
          </p>
          <div className="grz-form__actions">
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="filled" disabled={busy} onClick={remove}>
              {busy ? "Deleting…" : "Delete the move"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grz-form__actions">
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => setConfirming(true)}>
            Delete
          </Button>
          <Button variant="filled" disabled={busy || badTime} onClick={save}>
            {busy ? "Saving…" : "Save the correction"}
          </Button>
        </div>
      )}
    </div>
  );
}
