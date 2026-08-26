import { useEffect, useState } from "react";
import { Button } from "../ui";
import {
  fetchBreeds,
  saveComposition,
  speciesMismatch,
  validateComposition,
  type Breed,
  type BreedEntry,
} from "../../lib/genetics";
import "./genetics.css";

/**
 * Editing an animal's breed composition.
 *
 * Shares have to total 100 before this will save — see validateComposition
 * for why. The running total is shown as you type rather than only on save,
 * because "60% Jersey" looks finished until something tells you it isn't.
 */
export function BreedEditor({
  animalId,
  farmId,
  current,
  purpose,
  onCancel,
  onSaved,
}: {
  animalId: string;
  farmId: string | null;
  current: { breedId: string; percent: number }[];
  /** dairy | beef | dual, for the species-mismatch note. Optional so callers
   *  that don't have it keep working; the note is simply not shown. */
  purpose?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [breeds, setBreeds] = useState<Breed[]>([]);
  const [rows, setRows] = useState<{ breedId: string; percent: string }[]>(
    current.length > 0
      ? current.map((c) => ({ breedId: c.breedId, percent: String(c.percent) }))
      : [{ breedId: "", percent: "" }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (farmId !== null) {
      fetchBreeds(farmId)
        .then((b) => !cancelled && setBreeds(b))
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    }
    return () => {
      cancelled = true;
    };
  }, [farmId]);

  const entries: BreedEntry[] = rows
    .filter((r) => r.breedId !== "")
    .map((r) => ({ breedId: r.breedId, percent: Number(r.percent) }));

  const total = Math.round(entries.reduce((s, e) => s + (Number.isFinite(e.percent) ? e.percent : 0), 0) * 100) / 100;
  const problem = validateComposition(entries);
  // A warning, not a refusal — see speciesMismatch. Saving is still allowed.
  const mismatch = purpose ? speciesMismatch(entries, breeds, purpose) : null;

  const setRow = (i: number, patch: Partial<{ breedId: string; percent: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const handleSave = async () => {
    if (!farmId || problem) return;
    setSaving(true);
    setError(null);
    try {
      await saveComposition(farmId, animalId, entries);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /** An even split across the rows that have a breed — the common case is a
   * 50/50 or a 25/25/25/25, and typing those by hand invites a total of 99. */
  const splitEvenly = () => {
    const withBreed = rows.filter((r) => r.breedId !== "");
    if (withBreed.length === 0) return;
    const each = Math.floor((100 / withBreed.length) * 100) / 100;
    // The rounding remainder goes on the first share, so the total is exactly
    // 100 rather than 99.99 for three-way splits.
    const remainder = Math.round((100 - each * withBreed.length) * 100) / 100;
    let first = true;
    setRows((rs) =>
      rs.map((r) => {
        if (r.breedId === "") return r;
        const value = first ? each + remainder : each;
        first = false;
        return { ...r, percent: String(Math.round(value * 100) / 100) };
      }),
    );
  };

  return (
    <div className="gene-add" style={{ display: "block" }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Breed composition
      </div>

      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="gene-select"
            style={{ flex: 1, minWidth: 150, width: "auto" }}
            value={row.breedId}
            aria-label={`Breed ${i + 1}`}
            onChange={(e) => setRow(i, { breedId: e.target.value })}
          >
            <option value="">Pick a breed…</option>
            {breeds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            className="gene-select"
            style={{ width: 90 }}
            type="number"
            min="0"
            max="100"
            step="0.01"
            inputMode="decimal"
            placeholder="%"
            aria-label={`Percent ${i + 1}`}
            value={row.percent}
            onChange={(e) => setRow(i, { percent: e.target.value })}
          />
          <button
            type="button"
            className="link-button mono"
            aria-label={`Remove breed ${i + 1}`}
            onClick={() => setRows((rs) => (rs.length === 1 ? [{ breedId: "", percent: "" }] : rs.filter((_, j) => j !== i)))}
          >
            remove
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <button type="button" className="link-button mono" onClick={() => setRows((rs) => [...rs, { breedId: "", percent: "" }])}>
          + another breed
        </button>
        <button type="button" className="link-button mono" onClick={splitEvenly}>
          split evenly
        </button>
        <span className="mono" style={{ fontSize: 13, color: total === 100 ? "var(--herd-green)" : "var(--ink-muted)" }}>
          {total}%
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="filled" disabled={saving || problem !== null || !farmId} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {problem && <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>{problem}</p>}
      {!problem && mismatch && (
        <p className="gene-mismatch">{mismatch}</p>
      )}
      {error && <p style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }}>{error}</p>}
    </div>
  );
}
