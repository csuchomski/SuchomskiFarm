import { useEffect, useState } from "react";
import { Button, Callout, Pill } from "../ui";
import {
  clearConditionStatus,
  clearMarker,
  fetchConditions,
  fetchConditionStatuses,
  fetchMarkers,
  genotypeLabel,
  MARKERS,
  saveConditionStatus,
  saveMarker,
  STATUS_CODES,
  type ConditionStatus,
  type ConditionStatusCode,
  type GeneticCondition,
  type MarkerCode,
  type MarkerGenotype,
} from "../../lib/genetics";
import "./genetics.css";

/**
 * What an animal's test results say: milk-protein and coat markers, plus any
 * genetic condition she's been screened for.
 *
 * Conditions are shown only where there's a result. There are 22 of them
 * seeded and a herd typically has results for a handful — listing every one
 * as "untested" would bury the two that matter under twenty that don't.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; conditions: GeneticCondition[]; statuses: ConditionStatus[]; markers: MarkerGenotype[] };

export function GeneticsSection({
  animalId,
  farmId,
  canWrite = true,
}: {
  animalId: string;
  farmId: string | null;
  canWrite?: boolean;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingCondition, setAddingCondition] = useState(false);
  const [newConditionId, setNewConditionId] = useState("");
  const [newStatus, setNewStatus] = useState<ConditionStatusCode>("free");

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    if (farmId === null) {
      setLoad({ state: "ok", conditions: [], statuses: [], markers: [] });
      return;
    }
    (async () => {
      const [conditions, statuses, markers] = await Promise.all([
        fetchConditions(farmId),
        fetchConditionStatuses([animalId]),
        fetchMarkers([animalId]),
      ]);
      if (!cancelled) setLoad({ state: "ok", conditions, statuses, markers });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [animalId, farmId]);

  if (load.state === "loading") {
    return <Section>{<p style={{ fontSize: 14, color: "var(--ink-muted)" }}>Loading genetics…</p>}</Section>;
  }
  if (load.state === "error") {
    return (
      <Section>
        <p style={{ fontSize: 14, color: "var(--red)" }}>Couldn't load genetics: {load.message}</p>
      </Section>
    );
  }

  const { conditions, statuses, markers } = load;
  const writable = canWrite && farmId !== null;

  const genotypeOf = (code: string) => markers.find((m) => m.marker_code === code) ?? null;

  const handleMarker = async (code: MarkerCode, genotype: string) => {
    if (!farmId) return;
    setBusy(code);
    setError(null);
    try {
      if (genotype === "") {
        const existing = genotypeOf(code);
        if (existing) {
          await clearMarker(existing.id);
          setLoad({ ...load, markers: markers.filter((m) => m.id !== existing.id) });
        }
      } else {
        const saved = await saveMarker(farmId, animalId, code, genotype);
        setLoad({ ...load, markers: [...markers.filter((m) => m.marker_code !== code), saved] });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleCondition = async (conditionId: string, status: ConditionStatusCode) => {
    if (!farmId) return;
    setBusy(conditionId);
    setError(null);
    try {
      const saved = await saveConditionStatus(farmId, animalId, conditionId, status);
      setLoad({ ...load, statuses: [...statuses.filter((s) => s.condition_id !== conditionId), saved] });
      setAddingCondition(false);
      setNewConditionId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveCondition = async (status: ConditionStatus) => {
    setBusy(status.condition_id);
    setError(null);
    try {
      await clearConditionStatus(status.id);
      setLoad({ ...load, statuses: statuses.filter((s) => s.id !== status.id) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const recorded = statuses
    .map((s) => ({ status: s, condition: conditions.find((c) => c.id === s.condition_id) }))
    .filter((r): r is { status: ConditionStatus; condition: GeneticCondition } => Boolean(r.condition))
    .sort((a, b) => STATUS_WEIGHT[a.status.status] - STATUS_WEIGHT[b.status.status] || a.condition.code.localeCompare(b.condition.code));

  const untested = conditions.filter((c) => !statuses.some((s) => s.condition_id === c.id));

  return (
    <Section>
      {error && <p style={{ fontSize: 13, color: "var(--red)", marginBottom: 8 }}>{error}</p>}

      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Markers
      </div>
      <div className="gene-markers">
        {MARKERS.map((m) => {
          const current = genotypeOf(m.code);
          const isDesirable = current && m.desirable && current.genotype === m.desirable;
          return (
            <div className="gene-marker" key={m.code}>
              <div className="gene-marker__label">
                <span style={{ fontSize: 14 }}>{m.label}</span>
                <span className="gene-marker__note">{m.note}</span>
              </div>
              {writable ? (
                <select
                  className="gene-select"
                  value={current?.genotype ?? ""}
                  disabled={busy === m.code}
                  aria-label={m.label}
                  onChange={(e) => void handleMarker(m.code, e.target.value)}
                >
                  <option value="">Not tested</option>
                  {m.genotypes.map((g) => (
                    <option key={g} value={g}>
                      {genotypeLabel(m.code, g)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="mono" style={{ fontSize: 14 }}>
                  {current ? genotypeLabel(m.code, current.genotype) : "—"}
                </span>
              )}
              {isDesirable ? <Pill variant="outline-green">best</Pill> : <span />}
            </div>
          );
        })}
      </div>

      <div className="section__head" style={{ margin: "24px 0 12px" }}>
        <div className="eyebrow">Genetic conditions</div>
        {writable && untested.length > 0 && (
          <button type="button" className="link-button mono" onClick={() => setAddingCondition((v) => !v)}>
            {addingCondition ? "Cancel" : "+ Record a result"}
          </button>
        )}
      </div>

      {addingCondition && (
        <div className="gene-add">
          <select
            className="gene-select"
            value={newConditionId}
            aria-label="Condition"
            onChange={(e) => setNewConditionId(e.target.value)}
          >
            <option value="">Pick a condition…</option>
            {untested.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <select
            className="gene-select"
            value={newStatus}
            aria-label="Result"
            onChange={(e) => setNewStatus(e.target.value as ConditionStatusCode)}
          >
            {STATUS_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="filled"
            disabled={!newConditionId || busy !== null}
            onClick={() => void handleCondition(newConditionId, newStatus)}
          >
            Save
          </Button>
        </div>
      )}

      {recorded.length === 0 ? (
        <Callout>
          No genetic conditions recorded. Results come from a genomic test or the sire's registry — record them here
          and pairings will be checked against them.
        </Callout>
      ) : (
        <div className="gene-conditions">
          {recorded.map(({ status, condition }) => (
            <div className="gene-condition" key={condition.id}>
              <div>
                <span className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
                  {condition.code}
                </span>
                <span className="gene-condition__name">{condition.name}</span>
              </div>
              <span className="gene-condition__inheritance">{condition.inheritance}</span>
              {writable ? (
                <select
                  className="gene-select"
                  value={status.status}
                  disabled={busy === condition.id}
                  aria-label={`${condition.code} result`}
                  onChange={(e) => void handleCondition(condition.id, e.target.value as ConditionStatusCode)}
                >
                  {STATUS_CODES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusPill status={status.status} />
              )}
              {writable && (
                <button
                  type="button"
                  className="link-button mono"
                  disabled={busy === condition.id}
                  onClick={() => void handleRemoveCondition(status)}
                >
                  remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Affected first — it's the one that changes what you do next. */
const STATUS_WEIGHT: Record<ConditionStatusCode, number> = { affected: 0, carrier: 1, untested: 2, free: 3 };

function StatusPill({ status }: { status: ConditionStatusCode }) {
  if (status === "free") return <Pill variant="outline-green">free</Pill>;
  if (status === "carrier") return <Pill variant="outline">carrier</Pill>;
  if (status === "affected") return <Pill variant="outline">affected</Pill>;
  return <Pill variant="neutral">untested</Pill>;
}

/**
 * The wrapper, minus a heading.
 *
 * This lives on a tab called Genetics under a line that says what genetics
 * means here. A third "Genetics" immediately below the other two was the
 * word three times before a single marker.
 */
function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 4 }}>{children}</div>;
}
