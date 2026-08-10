import { useEffect, useState } from "react";
import { Button, Callout, GridRow, Pill } from "../ui";
import {
  byFreshDateDesc,
  daysInMilk,
  fetchLactations,
  nextLactationNumber,
  openLactation,
  recordDryOff,
  recordFreshening,
  statusOf,
  updateFigures,
  validateDryOff,
  validateFreshening,
  type RealLactation,
} from "../../lib/lactations";

/**
 * A cow's milking history, and the two events that change it: freshening
 * and drying off.
 *
 * Only shown for females — a bull has no lactation, and an empty section
 * on his record would imply the data is merely missing.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

const COLS = "48px 100px 100px 64px 92px 1fr";
/** Dry-off date drops on a phone. The last track stays — it carries the
 *  row's actions, and hiding it would take "dry off" with it — but the
 *  figures text inside it is hidden, so the cell narrows to its buttons.
 *  Header and body must keep the same number of visible cells or every
 *  column after the first hidden one shifts. */
const COLS_SM = "32px 82px 42px 74px 1fr";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; rows: RealLactation[] };

const num = (v: string): number | null => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export function LactationSection({
  animalId,
  farmId,
  canWrite,
}: {
  animalId: string;
  farmId: string | null;
  /** False for a male or a calf — history still reads, nothing can be added. */
  canWrite: boolean;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [showFreshen, setShowFreshen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [freshDate, setFreshDate] = useState(todayIso);
  const [parity, setParity] = useState("");

  const [dryingOff, setDryingOff] = useState<string | null>(null);
  const [dryDate, setDryDate] = useState(todayIso);
  const [dryReason, setDryReason] = useState("");

  const [editingFigures, setEditingFigures] = useState<string | null>(null);
  const [peak, setPeak] = useState("");
  const [peakDim, setPeakDim] = useState("");
  const [total, setTotal] = useState("");
  const [me305, setMe305] = useState("");

  useEffect(() => {
    if (!farmId) {
      setLoad({ state: "ok", rows: [] });
      return;
    }
    let cancelled = false;
    setLoad({ state: "loading" });
    fetchLactations(farmId)
      .then((all) => !cancelled && setLoad({ state: "ok", rows: all.filter((l) => l.animal_id === animalId) }))
      .catch(
        (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, [animalId, farmId]);

  const rows = load.state === "ok" ? [...load.rows].sort(byFreshDateDesc) : [];
  const open = openLactation(rows);
  const suggested = nextLactationNumber(rows);

  const parityNum = parity.trim() === "" ? suggested : Number(parity);
  const freshenError = validateFreshening({ animalId, lactationNumber: parityNum, freshDate }, rows);

  const refresh = (updated: RealLactation) =>
    setLoad((s) =>
      s.state === "ok"
        ? { state: "ok", rows: [...s.rows.filter((l) => l.id !== updated.id), updated] }
        : s,
    );

  const handleFreshen = async () => {
    if (!farmId || freshenError) return;
    setBusy(true);
    setActionError(null);
    try {
      const created = await recordFreshening(farmId, { animalId, lactationNumber: parityNum, freshDate });
      setLoad((s) => (s.state === "ok" ? { state: "ok", rows: [...s.rows, created] } : s));
      setShowFreshen(false);
      setParity("");
      setFreshDate(todayIso());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDryOff = async (lactation: RealLactation) => {
    const problem = validateDryOff(lactation, dryDate);
    if (problem) {
      setActionError(problem);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      refresh(await recordDryOff(lactation.id, dryDate, dryReason.trim()));
      setDryingOff(null);
      setDryReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFigures = async (lactation: RealLactation) => {
    setBusy(true);
    setActionError(null);
    try {
      refresh(
        await updateFigures(lactation.id, {
          peakMilkLb: num(peak),
          peakDim: num(peakDim),
          totalYieldLb: num(total),
          me305Lb: num(me305),
        }),
      );
      setEditingFigures(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startFigures = (l: RealLactation) => {
    setEditingFigures(l.id);
    setPeak(l.peak_milk_lb?.toString() ?? "");
    setPeakDim(l.peak_dim?.toString() ?? "");
    setTotal(l.total_yield_lb?.toString() ?? "");
    setMe305(l.me305_lb?.toString() ?? "");
    setActionError(null);
  };

  return (
    <>
      <div className="section__head" style={{ margin: "24px 0 12px" }}>
        <div className="serif" style={{ fontSize: 21 }}>
          Lactations
        </div>
        {canWrite && farmId && !open && !showFreshen && (
          <Button size="sm" onClick={() => setShowFreshen(true)}>
            Record freshening
          </Button>
        )}
      </div>

      {load.state === "loading" && <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>Loading…</p>}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)" }}>Couldn't load lactations: {load.message}</p>
      )}
      {actionError && (
        <p style={{ fontSize: 13, color: "var(--red)", marginBottom: 8 }}>{actionError}</p>
      )}

      {showFreshen && (
        <div style={{ border: "1px solid var(--hairline)", padding: 12, marginBottom: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            New freshening
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Fresh date</div>
              <input type="date" value={freshDate} onChange={(e) => setFreshDate(e.target.value)} />
            </label>
            <label style={{ fontSize: 13 }}>
              <div className="eyebrow">Lactation №</div>
              <input
                type="number"
                min={1}
                style={{ width: 80 }}
                placeholder={String(suggested)}
                value={parity}
                onChange={(e) => setParity(e.target.value)}
              />
            </label>
            <Button variant="filled" size="sm" disabled={busy || freshenError !== null} onClick={() => void handleFreshen()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" onClick={() => { setShowFreshen(false); setActionError(null); }}>
              Cancel
            </Button>
          </div>
          {freshenError && <p style={{ fontSize: 13, color: "var(--red)", marginTop: 8 }}>{freshenError}</p>}
          {!freshenError && parity.trim() === "" && (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
              Recording lactation {suggested}, one past her highest so far.
            </p>
          )}
        </div>
      )}

      {load.state === "ok" && rows.length === 0 && !showFreshen && (
        <Callout>
          No lactations recorded for her yet.{" "}
          {canWrite ? "Record a freshening to start one." : "Only females that have calved have a lactation."}
        </Callout>
      )}

      {rows.length > 0 && (
        <>
          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>№</span>
            <span>Fresh</span>
            <span className="hide-sm">Dry off</span>
            <span className="text-right">DIM</span>
            <span>Status</span>
            <span>
              <span className="hide-sm">Peak · total · ME305</span>
            </span>
          </GridRow>

          {rows.map((l) => {
            const status = statusOf(l);
            const dim = daysInMilk(l);
            return (
              <div key={l.id}>
                <GridRow cols={COLS} mobileCols={COLS_SM} as="body">
                  <span className="mono">{l.lactation_number}</span>
                  <span className="mono" style={{ fontSize: 13 }}>{l.fresh_date}</span>
                  <span
                    className="mono hide-sm"
                    style={{ fontSize: 13, color: l.dry_off_date ? undefined : "var(--ink-faint)" }}
                  >
                    {l.dry_off_date ?? "—"}
                    {/* Where the date was worked out rather than recorded —
                        a lactation closed because a later freshening bounds
                        it — say so. Otherwise a derived date is
                        indistinguishable from one somebody wrote down. */}
                    {l.termination_reason.trim() !== "" && l.termination_reason !== "calved" && (
                      <>
                        <br />
                        <span style={{ fontSize: 11, color: "var(--ink-muted)", whiteSpace: "normal" }}>
                          {l.termination_reason}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="mono text-right">{dim ?? "—"}</span>
                  <span>
                    <Pill variant={status === "in-milk" ? "outline-green" : "neutral"}>
                      {status === "in-milk" ? "In milk" : status === "dry" ? "Dry" : "Scheduled"}
                    </Pill>
                  </span>
                  <span style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span
                      className="mono hide-sm"
                      style={{ color: l.peak_milk_lb === null ? "var(--ink-faint)" : undefined }}
                    >
                      {l.peak_milk_lb !== null ? `${l.peak_milk_lb} lb` : "—"}
                      {l.peak_dim !== null && ` @ ${l.peak_dim}d`}
                      {" · "}
                      {l.total_yield_lb !== null ? `${l.total_yield_lb} lb` : "—"}
                      {" · "}
                      {l.me305_lb !== null ? `${l.me305_lb} lb` : "—"}
                    </span>
                    {canWrite && (
                      <>
                        <button className="mono" style={linkish} onClick={() => startFigures(l)}>
                          figures
                        </button>
                        {status === "in-milk" && (
                          <button
                            className="mono"
                            style={linkish}
                            onClick={() => {
                              setDryingOff(l.id);
                              setDryDate(todayIso());
                              setActionError(null);
                            }}
                          >
                            dry off
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </GridRow>

                {dryingOff === l.id && (
                  <div style={{ padding: "8px 8px 16px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <label style={{ fontSize: 13 }}>
                      <div className="eyebrow">Dry-off date</div>
                      <input type="date" value={dryDate} onChange={(e) => setDryDate(e.target.value)} />
                    </label>
                    <label style={{ fontSize: 13, flex: 1, minWidth: 180 }}>
                      <div className="eyebrow">Reason</div>
                      <input
                        type="text"
                        style={{ width: "100%" }}
                        placeholder="end of lactation, mastitis, sold…"
                        value={dryReason}
                        onChange={(e) => setDryReason(e.target.value)}
                      />
                    </label>
                    <Button variant="filled" size="sm" disabled={busy} onClick={() => void handleDryOff(l)}>
                      {busy ? "Saving…" : "Dry off"}
                    </Button>
                    <Button size="sm" onClick={() => setDryingOff(null)}>
                      Cancel
                    </Button>
                  </div>
                )}

                {editingFigures === l.id && (
                  <div style={{ padding: "8px 8px 16px" }}>
                    <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 8 }}>
                      From your DHIA report. Blank leaves a figure unrecorded rather than storing zero.
                    </p>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <Figure label="Peak lb" value={peak} onChange={setPeak} />
                      <Figure label="Peak DIM" value={peakDim} onChange={setPeakDim} />
                      <Figure label="Total lb" value={total} onChange={setTotal} />
                      <Figure label="ME305 lb" value={me305} onChange={setMe305} />
                      <Button variant="filled" size="sm" disabled={busy} onClick={() => void handleFigures(l)}>
                        {busy ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" onClick={() => setEditingFigures(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

const linkish: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  color: "var(--ink-muted)",
  textDecoration: "underline",
  cursor: "pointer",
};

function Figure({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: 13 }}>
      <div className="eyebrow">{label}</div>
      <input type="number" step="0.1" style={{ width: 90 }} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
