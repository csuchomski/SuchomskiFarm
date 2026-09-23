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

/**
 * The wire as a percentage, to a tenth. Nobody reads a paddock as 0.38.
 *
 * Lossy on purpose, which is why `asStored` exists below: a fraction of
 * 0.5191121495327102 shows as "51.9", and 51.9 back out is 0.519 — off by
 * more than `edit_grazing_move` allows a wire to move backwards.
 */
const pct = (f: number | null): string => (f === null ? "" : String(Math.round(f * 1000) / 10));

const FT_PER_YD = 3;

/** One decimal, and no "-0" or trailing ".0" noise on a whole number. */
const tidy = (n: number): string => String(Math.round(n * 10) / 10);

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
  // What the boxes were filled with. A box still reading this has not been
  // touched, whatever the fraction behind it looks like.
  const shownFrom = pct(event.sweptFrom);
  const shownTo = pct(event.sweptTo);
  const [from, setFrom] = useState(shownFrom);
  const [to, setTo] = useState(shownTo);

  /**
   * How far the wire moved, in yards.
   *
   * The percentage is what the record keeps, because a fraction of the sweep
   * survives a paddock being remeasured. Yards is what you actually paced
   * out, so it is the figure worth showing and the one worth being able to
   * type — and it only exists where the paddock knows how long its sweep is.
   *
   * It is its own state rather than derived on every render: typing "20"
   * should leave "20" in the box, not the 19.9 that comes back from putting
   * it through a percentage rounded to a tenth.
   */
  const sweepFtOf = (id: string): number | null =>
    paddocks.find((p) => p.id === id)?.sweepLengthFt ?? null;

  const yardsFor = (fromPct: string, toPct: string, ft: number | null): string => {
    if (ft === null || ft <= 0) return "";
    const f = num(fromPct);
    const t = num(toPct);
    if (f === null || t === null) return "";
    return tidy((((t - f) / 100) * ft) / FT_PER_YD);
  };

  const sweepFt = sweepFtOf(paddockId);
  const [yards, setYards] = useState(() => yardsFor(shownFrom, shownTo, sweepFtOf(event.paddockId)));

  // The three fields are one fact said two ways, so each keeps the others
  // honest rather than letting the form show a strip that is not the strip.
  const onFrom = (v: string) => {
    setFrom(v);
    setYards(yardsFor(v, to, sweepFt));
  };
  const onTo = (v: string) => {
    setTo(v);
    setYards(yardsFor(from, v, sweepFt));
  };
  const onPaddock = (id: string) => {
    setPaddockId(id);
    // A different paddock is a different sweep, so the same wire is a
    // different number of yards.
    setYards(yardsFor(from, to, sweepFtOf(id)));
  };
  /** Yards moves the *far* wire. The near one is where the last strip ended
   *  and is not ours to shift. */
  const onYards = (v: string) => {
    setYards(v);
    const y = num(v);
    const f = num(from);
    if (y === null || f === null || sweepFt === null || sweepFt <= 0) return;
    setTo(tidy(f + ((y * FT_PER_YD) / sweepFt) * 100));
  };

  const pastTheEnd = (num(to) ?? 0) > 100;

  /**
   * The fraction to save for a wire.
   *
   * An untouched box sends back the fraction that came out of the database,
   * not one rebuilt from the tenth-of-a-percent it was displayed as. The
   * display loses up to 0.0005 and `edit_grazing_move` refuses a strip that
   * starts more than 0.0001 behind the one before it — so re-deriving turned
   * "I changed the date" into "that strip goes back over ground grazed
   * earlier in the same pass", naming a percentage identical to the one on
   * screen.
   */
  const asStored = (typed: string, shown: string, stored: number | null): number | null => {
    if (typed === shown) return stored;
    const v = num(typed);
    return v === null ? null : v / 100;
  };

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
    const f = asStored(from, shownFrom, event.sweptFrom);
    const t = asStored(to, shownTo, event.sweptTo);
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
        sweptFrom: f,
        sweptTo: t,
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
          <select value={paddockId} onChange={(e) => onPaddock(e.target.value)} aria-label="Which paddock">
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
          <input value={from} onChange={(e) => onFrom(e.target.value)} inputMode="decimal" aria-label="Wire from, %" />
        </label>
        <label className="grz-field">
          <span className="eyebrow">Wire to, %</span>
          <input value={to} onChange={(e) => onTo(e.target.value)} inputMode="decimal" aria-label="Wire to, %" />
        </label>
        {sweepFt !== null && sweepFt > 0 && (
          <label className="grz-field">
            <span className="eyebrow">Strip, yd</span>
            <input value={yards} onChange={(e) => onYards(e.target.value)} inputMode="decimal" aria-label="Strip, yd" />
          </label>
        )}
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

      {sweepFt !== null && sweepFt > 0 ? (
        <p className="grz-optional">
          {paddocks.find((p) => p.id === paddockId)?.name ?? "This paddock"} sweeps{" "}
          <span className="mono">{tidy(sweepFt / FT_PER_YD)} yd</span> end to end. Yards move the
          far wire; the near one is where the last strip finished.
          {pastTheEnd && " That takes the wire past the end of the paddock."}
        </p>
      ) : (
        <p className="grz-optional">
          Yards need this paddock's sweep length, which it has not got — the wire is in
          percentages only. Draw its boundary, or set the sweep on the paddock, and yards appear.
        </p>
      )}

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
