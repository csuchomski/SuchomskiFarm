import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui";
import { fetchWeighings, recordWeight, type Weighing } from "../../lib/grazing";
import type { RealAnimal } from "../../lib/herd";

/**
 * What she weighs, and what she weighed.
 *
 * One field to fill in, and a dated row behind it. The grazing module needs a
 * weight per animal — the mob's total is what sets daily intake and stocking
 * density, and a mob of mixed sizes cannot be described by one figure on the
 * group. But a weight is a measurement taken on a day, not a property of the
 * animal, so a single overwritable field would quietly lose the spring figure
 * the moment an autumn one arrived.
 *
 * So: it reads as a field and keeps the history. Weighing the same animal
 * twice on one day corrects the figure rather than adding a row (043) —
 * because two rows for one day is a record nobody can act on.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; rows: Weighing[] };

const TYPE_LABEL: Record<string, string> = {
  birth: "at birth",
  weaning: "at weaning",
  yearling: "as a yearling",
  sale: "at sale",
  processing_live: "live, at processing",
  adhoc: "",
};

const today = () => new Date().toISOString().slice(0, 10);

export function WeightSection({ animal, farmId }: { animal: RealAnimal; farmId: string | null }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [weight, setWeight] = useState("");
  const [on, setOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!farmId) return;
    setLoad({ state: "ok", rows: await fetchWeighings(farmId, animal.id) });
  }, [animal.id, farmId]);

  useEffect(() => {
    if (!farmId) return;
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [farmId, refresh]);

  if (!farmId) return null;

  const value = Number(weight.trim());
  const canSave = weight.trim() !== "" && Number.isFinite(value) && value > 0 && on !== "";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordWeight({ farmId, animalId: animal.id, weightLb: value, date: on });
      setWeight("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const latest = load.state === "ok" ? (load.rows[0] ?? null) : null;
  const earlier = load.state === "ok" ? load.rows.slice(1) : [];

  return (
    <div style={{ marginTop: 24 }}>
      <div className="section__head" style={{ marginBottom: 12 }}>
        <div className="serif" style={{ fontSize: 21 }}>
          Weight
        </div>
        {latest && (
          <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
            {shortDate(latest.date)}
          </span>
        )}
      </div>

      {load.state === "loading" && <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Loading…</p>}
      {load.state === "error" && (
        <p style={{ fontSize: 13, color: "var(--red)" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <p className="wt-now mono">
            {latest === null ? (
              <span style={{ color: "var(--ink-muted)", fontSize: 15 }}>Never weighed.</span>
            ) : (
              <>
                {Math.round(latest.weightLb).toLocaleString()}
                <span className="wt-unit"> lb</span>
                {TYPE_LABEL[latest.weightType] ? (
                  <span className="wt-kind"> {TYPE_LABEL[latest.weightType]}</span>
                ) : null}
              </>
            )}
          </p>

          <div className="wt-form">
            <label className="wt-field">
              <span className="eyebrow">Weight, lb</span>
              <input
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                inputMode="decimal"
                aria-label="Weight, lb"
              />
            </label>
            <label className="wt-field">
              <span className="eyebrow">Weighed on</span>
              <input type="date" value={on} onChange={(e) => setOn(e.target.value)} aria-label="Weighed on" />
            </label>
            <Button disabled={busy || !canSave} onClick={save}>
              {busy ? "Saving…" : "Record it"}
            </Button>
          </div>

          {error && (
            <p className="mono" style={{ color: "var(--red)", fontSize: 13 }} role="alert">
              {error}
            </p>
          )}

          <p className="wt-why">
            Grazing uses this. The mob's weights added together are what set how much they eat in a
            day, and so how wide a strip has to be.
          </p>

          {earlier.length > 0 && (
            <div className="wt-history">
              <div className="eyebrow" style={{ marginBottom: 6 }}>Before that</div>
              {earlier.map((w) => (
                <p key={w.id} className="wt-row">
                  <span className="mono">{Math.round(w.weightLb).toLocaleString()} lb</span>
                  <span className="wt-row__when mono">{shortDate(w.date)}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
