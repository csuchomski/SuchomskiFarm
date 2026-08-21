import { useState } from "react";
import { StatTile } from "../ui";
import { fetchWeighings, recordWeight, type Weighing } from "../../lib/grazing";
import { lifeDate } from "../../lib/animal-life";
import { todayLocal } from "../../lib/local-time";

/**
 * Her weight, read and written in the same place.
 *
 * It had a section of its own halfway down the record — a field, a date and a
 * list of every weighing she has ever had — while the figure a farmer
 * actually wants sat in a tile at the top. Two places for one number, and the
 * one you looked at was not the one you could change.
 *
 * So the tile is the control. The history went with the section: a weight is
 * a measurement on a day and the database keeps every one of them, but the
 * page only ever needed the last.
 *
 * **Weighing her twice on one day corrects the figure** rather than adding a
 * row — migration 043 — so re-recording today's weight after a bad reading
 * does the right thing.
 */
export function WeightTile({
  animal,
  farmId,
  weight,
  onSaved,
}: {
  animal: { id: string };
  farmId: string | null;
  weight: Weighing | null;
  onSaved: (weight: Weighing | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [lb, setLb] = useState("");
  const [on, setOn] = useState(todayLocal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(lb.trim());
  const canSave = lb.trim() !== "" && Number.isFinite(value) && value > 0 && on !== "";

  const save = async () => {
    if (!farmId || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await recordWeight({ farmId, animalId: animal.id, weightLb: value, date: on });
      // Read it back rather than assuming: record_weight overwrites a same-day
      // weighing, so what is on file afterwards is not always a new row.
      const rows = await fetchWeighings(farmId, animal.id);
      onSaved([...rows].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null);
      setLb("");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="weight-tile">
        <StatTile
          size="md"
          value={weight ? weight.weightLb : "—"}
          unit={weight ? "lb" : undefined}
          label={weight ? `Weighed ${lifeDate(weight.date)}` : "No weight on file"}
        />
        {farmId && (
          <button
            type="button"
            className="link-button mono weight-tile__edit"
            aria-label="record a weight"
            onClick={() => {
              setEditing(true);
              setLb(weight ? String(weight.weightLb) : "");
              setOn(todayLocal());
              setError(null);
            }}
          >
            {weight ? "reweigh" : "record"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="weight-tile weight-tile--editing">
      <label className="weight-tile__field">
        <span className="eyebrow">Weight, lb</span>
        <input
          value={lb}
          onChange={(e) => setLb(e.target.value)}
          inputMode="decimal"
          aria-label="Weight, lb"
          autoFocus
        />
      </label>
      <label className="weight-tile__field">
        <span className="eyebrow">Weighed on</span>
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label="Weighed on" />
      </label>
      <div className="weight-tile__acts">
        <button type="button" className="link-button mono" disabled={busy || !canSave} onClick={() => void save()}>
          {busy ? "saving…" : "save"}
        </button>
        <button type="button" className="link-button mono" onClick={() => setEditing(false)}>
          cancel
        </button>
      </div>
      {error && <p className="weight-tile__error">{error}</p>}
    </div>
  );
}
