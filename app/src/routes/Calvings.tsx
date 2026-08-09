import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import {
  ASSISTANCE,
  emptyCalf,
  fetchCalfOutcomes,
  fetchCalvings,
  OUTCOMES,
  PRESENTATION,
  recordCalving,
  validateCalving,
  type CalfDraft,
  type CalfOutcome,
  type Calving,
} from "../lib/repro";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";
import "./breedings.css";

/**
 * Calvings, and the calves.
 *
 * Recording one writes the calving, a row per calf, an animal record for
 * each live calf with its dam and sire already filled in, and — for a dairy
 * dam — the lactation it freshens, closing the one before it. All in one
 * database function; see docs/migrations/028-pregnancy-and-calving.sql.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);
const readable = (s: string) => s.replace(/_/g, " ");

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; calvings: Calving[]; outcomes: CalfOutcome[]; animals: RealAnimal[] };

const COLS = "110px 1fr 150px 130px 110px";
const COLS_SM = "92px 1fr 96px";

export default function Calvings() {
  const { business, farmId } = useWorkspace();

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [damId, setDamId] = useState("");
  const [date, setDate] = useState(todayIso);
  const [ease, setEase] = useState(1);
  const [assistance, setAssistance] = useState<string>("unassisted");
  const [presentation, setPresentation] = useState<string>("anterior");
  const [retained, setRetained] = useState(false);
  const [notes, setNotes] = useState("");
  const [calves, setCalves] = useState<CalfDraft[]>([emptyCalf()]);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", calvings: [], outcomes: [], animals: [] });
      return;
    }
    const [calvings, outcomes, animals] = await Promise.all([
      fetchCalvings(farmId),
      fetchCalfOutcomes(farmId),
      fetchAnimals(),
    ]);
    setLoad({ state: "ok", calvings, outcomes, animals });
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

  const calvings = load.state === "ok" ? load.calvings : EMPTY_CALVINGS;
  const outcomes = load.state === "ok" ? load.outcomes : EMPTY_OUTCOMES;
  const animals = load.state === "ok" ? load.animals : EMPTY_ANIMALS;

  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const name = (id: string | null | undefined) => {
    if (!id) return undefined;
    const a = byId.get(id);
    return a ? a.barn_name?.trim() || a.ear_tag : undefined;
  };

  const dams = useMemo(() => animals.filter((a) => a.sex === "female" && a.status === "active"), [animals]);
  const dam = byId.get(damId) ?? null;
  const freshens = dam !== null && (dam.purpose === "dairy" || dam.purpose === "dual");

  const outcomesFor = (calvingId: string) => outcomes.filter((o) => o.calving_id === calvingId);
  const problem = adding ? validateCalving({ damId, date, calves }) : null;

  const liveCalves = outcomes.filter((o) => o.outcome === "live").length;
  const lost = outcomes.length - liveCalves;

  const reset = () => {
    setDamId("");
    setDate(todayIso());
    setEase(1);
    setAssistance("unassisted");
    setPresentation("anterior");
    setRetained(false);
    setNotes("");
    setCalves([emptyCalf()]);
  };

  return (
    <OpsShell searchPlaceholder="A cow, a calf…">
      <PageHeader
        eyebrow={business ? `${business.name} · herd` : "Herd"}
        title="Calvings"
        actions={
          <Button
            variant="filled"
            disabled={load.state !== "ok" || !farmId}
            onClick={() => {
              setAdding((v) => !v);
              reset();
              setError(null);
              setNote(null);
            }}
          >
            {adding ? "Cancel" : "Record a calving"}
          </Button>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load calvings: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={calvings.length || "—"} label="Calvings" />
            <StatTile value={liveCalves || "—"} label="Live calves" />
            <StatTile value={lost || "—"} label="Lost" />
            <StatTile value={calvings.filter((c) => c.is_twin).length || "—"} label="Twinnings" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {adding && (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                The calving
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Dam</div>
                  <select
                    className="order-select"
                    value={damId}
                    aria-label="Dam"
                    onChange={(e) => setDamId(e.target.value)}
                  >
                    <option value="">Pick one…</option>
                    {dams.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.barn_name?.trim() || a.ear_tag} · {a.class}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Date</div>
                  <input
                    className="order-select"
                    type="date"
                    value={date}
                    aria-label="Calving date"
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Ease (1 easy – 5 hard)</div>
                  <select
                    className="order-select"
                    value={String(ease)}
                    aria-label="Calving ease"
                    onChange={(e) => setEase(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Assistance</div>
                  <select
                    className="order-select"
                    value={assistance}
                    aria-label="Assistance"
                    onChange={(e) => setAssistance(e.target.value)}
                  >
                    {ASSISTANCE.map((a) => (
                      <option key={a} value={a}>
                        {readable(a)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Presentation</div>
                  <select
                    className="order-select"
                    value={presentation}
                    aria-label="Presentation"
                    onChange={(e) => setPresentation(e.target.value)}
                  >
                    {PRESENTATION.map((p) => (
                      <option key={p} value={p}>
                        {readable(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, paddingTop: 18 }}>
                  <input
                    type="checkbox"
                    checked={retained}
                    aria-label="Retained placenta"
                    onChange={(e) => setRetained(e.target.checked)}
                  />
                  Retained placenta
                </label>
              </div>

              <div className="eyebrow" style={{ margin: "20px 0 8px" }}>
                The calves
              </div>
              {calves.map((calf, i) => (
                <div className="calf-row" key={i}>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Outcome</div>
                    <select
                      className="order-select"
                      value={calf.outcome}
                      aria-label={`Calf ${i + 1} outcome`}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, outcome: e.target.value } : c)))
                      }
                    >
                      {OUTCOMES.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Sex</div>
                    <select
                      className="order-select"
                      value={calf.sex}
                      aria-label={`Calf ${i + 1} sex`}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, sex: e.target.value } : c)))
                      }
                    >
                      <option value="">Not recorded</option>
                      <option value="female">Heifer</option>
                      <option value="male">Bull</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Ear tag</div>
                    <input
                      className="order-select"
                      value={calf.earTag}
                      aria-label={`Calf ${i + 1} ear tag`}
                      disabled={calf.outcome !== "live"}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, earTag: e.target.value } : c)))
                      }
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Name</div>
                    <input
                      className="order-select"
                      value={calf.barnName}
                      aria-label={`Calf ${i + 1} name`}
                      disabled={calf.outcome !== "live"}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, barnName: e.target.value } : c)))
                      }
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Birth weight</div>
                    <input
                      className="order-select"
                      type="number"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                      value={calf.birthWeight}
                      aria-label={`Calf ${i + 1} birth weight`}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, birthWeight: e.target.value } : c)))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="link-button mono"
                    disabled={calves.length === 1}
                    onClick={() => setCalves((prev) => prev.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="link-button mono"
                onClick={() => setCalves((prev) => [...prev, emptyCalf()])}
              >
                + another calf (twins)
              </button>

              <label style={{ fontSize: 13, display: "block", marginTop: 12 }}>
                <div className="eyebrow">Notes</div>
                <input
                  className="order-select"
                  style={{ width: "100%" }}
                  value={notes}
                  aria-label="Notes"
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button
                  variant="filled"
                  size="sm"
                  disabled={busy || problem !== null}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    recordCalving({
                      damId,
                      date,
                      calves,
                      calvingEase: ease,
                      assistance,
                      presentation,
                      retainedPlacenta: retained,
                      notes,
                    })
                      .then(async () => {
                        await refresh();
                        setAdding(false);
                        setNote(
                          freshens
                            ? "Recorded, and she's freshened — the lactation before it is closed."
                            : "Recorded.",
                        );
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? "Saving…" : "Record it"}
                </Button>
                <span style={{ fontSize: 13, color: problem ? "var(--red)" : "var(--ink-muted)" }}>
                  {problem ?? "A live calf gets its own record, with dam and sire filled in."}
                </span>
              </div>

              {/* Its own line rather than part of the hint above: closing her
                  last lactation is a consequence worth seeing while you fill
                  the form in, not one that disappears behind a validation
                  message. */}
              {freshens && (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                  This also freshens her — a new lactation opens on this date and the one before it is closed.
                </p>
              )}
            </div>
          )}

          <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
            Recorded
          </div>

          {calvings.length === 0 ? (
            <Callout>
              Nothing recorded yet. A calving is what closes out a service logged on{" "}
              <Link to="/breedings">Breedings</Link>.
            </Callout>
          ) : (
            <>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Date</span>
                <span>Dam · calves</span>
                <span className="hide-sm">How it went</span>
                <span className="hide-sm">Weights</span>
                <span className="text-right hide-sm">Ease</span>
              </GridRow>

              {calvings.map((c) => {
                const calfRows = outcomesFor(c.id);
                return (
                  <GridRow key={c.id} cols={COLS} mobileCols={COLS_SM} as="body">
                    <span className="mono" style={{ fontSize: 13 }}>
                      {c.date}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="serif" style={{ fontSize: 17 }}>
                        {name(c.dam_id) ?? "Unknown"}
                      </span>
                      {c.is_twin && (
                        <>
                          {" "}
                          <Pill variant="outline">twins</Pill>
                        </>
                      )}
                      <br />
                      <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {calfRows.length === 0
                          ? "no calves recorded"
                          : calfRows
                              .map((o) => {
                                const who = name(o.calf_animal_id);
                                const what = o.sex === "female" ? "heifer" : o.sex === "male" ? "bull" : "calf";
                                return o.outcome === "live" ? `${who ?? what}` : `${what} ${readable(o.outcome)}`;
                              })
                              .join(", ")}
                      </span>
                    </span>
                    <span className="hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {readable(c.assistance)}
                      {c.presentation !== "anterior" && `, ${readable(c.presentation)}`}
                      {c.retained_placenta && ", retained placenta"}
                    </span>
                    <span className="mono hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {calfRows.every((o) => o.birth_weight_lb === null)
                        ? "—"
                        : calfRows
                            .map((o) => (o.birth_weight_lb === null ? "—" : `${o.birth_weight_lb}lb`))
                            .join(", ")}
                    </span>
                    <span className="mono text-right hide-sm">{c.calving_ease}</span>
                  </GridRow>
                );
              })}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                A live calf becomes an animal on <Link to="/animals">Animals</Link>, born on the farm, with its dam
                and the sire from the breeding behind this calving. A dairy dam's lactation opens here too — see{" "}
                <Link to="/lactations">Lactations</Link>.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_CALVINGS: Calving[] = [];
const EMPTY_OUTCOMES: CalfOutcome[] = [];
const EMPTY_ANIMALS: RealAnimal[] = [];
