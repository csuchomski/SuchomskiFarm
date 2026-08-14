import { useCallback, useEffect, useMemo, useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  assumptionsFor,
  boardRows,
  endGrazing,
  fetchForageAvailability,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchLatestWeights,
  fetchPaddocks,
  fetchPlanPaddockTargets,
  fetchActivePlan,
  groupAvgWeightLb,
  groupHeadCount,
  isSwept,
  logMove,
  occupancyDays,
  planStrip,
  prefillFrom,
  readinessDays,
  stockingDensityLbPerAcre,
  sweepBands,
  sweepInWords,
  sweptSoFar,
  whereIs,
  widthForHours,
  type ForageAssumptions,
  type ForageAvailability,
  type ForageRemoval,
  type GrazingPlan,
  type BoardRow,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingGroupMember,
  type Paddock,
  type PlanPaddockTarget,
  type SoilMoisture,
} from "../lib/grazing";
import "./grazing.css";

/**
 * Grazing: the paddock board, and the move that is the reason to open it.
 *
 * Sorted by rest descending, so the next paddock to graze is the top row.
 * Occupied units sort last — they are not candidates.
 *
 * The page warns and never blocks. A paddock grazed before its recovery
 * target is marked in ochre and the move goes through: the standard is a plan
 * the farm wrote, not a rule this app enforces, and a farmer moving cattle at
 * seven in the morning has reasons a form does not know.
 *
 * Nothing here says "compliant". Whether any of it meets 528 is the
 * conservationist's determination.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      paddocks: Paddock[];
      groups: GrazingGroup[];
      events: GrazingEvent[];
      removals: ForageRemoval[];
      availability: ForageAvailability[];
      plan: GrazingPlan | null;
      members: GrazingGroupMember[];
      weights: Map<string, number>;
      targets: PlanPaddockTarget[];
      hasPlan: boolean;
    };

const COLS = "minmax(0, 1fr) 110px 120px 96px";
const COLS_SM = "minmax(0, 1fr) 92px";

/** The fallback, used only where the farm's own records are silent.
 *
 *  These were the figures the strip readout always divided by; they now come
 *  from the plan, the paddock's target and the availability record, and this
 *  is what is left when none of those exists. It stays rather than showing
 *  nothing, because taking the tool away on somebody's first day helps no
 *  one — and the readout names which figures are the farm's and which are
 *  these, so a forecast is never mistaken for a measurement. */
const FALLBACK: ForageAssumptions = {
  standingLbDmPerAcre: 2400,
  utilizationPct: 50,
  intakePctBodyweight: 3,
};

const nowIso = () => new Date().toISOString();
/** For a datetime-local input, which wants local time with no zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function Grazing() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const [at, setAt] = useState(() => toLocalInput(nowIso()));
  const [paddockId, setPaddockId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [headCount, setHeadCount] = useState("");
  const [avgWeight, setAvgWeight] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [residualOut, setResidualOut] = useState("");
  const [utilization, setUtilization] = useState("");
  const [soil, setSoil] = useState<SoilMoisture | "">("");
  const [notes, setNotes] = useState("");
  /** Where the wire goes, as a fraction along the destination's sweep. */
  const [wireTo, setWireTo] = useState(0.1);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, groups, events, removals, availability, members, weights, plan] = await Promise.all([
      fetchPaddocks(farmId),
      fetchGrazingGroups(farmId),
      fetchGrazingEvents(farmId),
      fetchForageRemovals(farmId),
      fetchForageAvailability(farmId),
      fetchGroupMembers(farmId),
      fetchLatestWeights(farmId),
      fetchActivePlan(farmId),
    ]);
    const targets = plan ? await fetchPlanPaddockTargets(plan.id) : [];
    setLoad({
      state: "ok", paddocks, groups, events, removals, availability, members, weights,
      targets, plan, hasPlan: plan !== null,
    });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const rows = useMemo(() => {
    if (load.state !== "ok") return [] as BoardRow[];
    return boardRows({
      paddocks: load.paddocks,
      events: load.events,
      groups: load.groups,
      targets: load.targets,
      removals: load.removals,
      nowIso: nowIso(),
    });
  }, [load]);

  const group = load.state === "ok" ? (load.groups.find((g) => g.id === groupId) ?? load.groups[0] ?? null) : null;
  const here = group && load.state === "ok" ? whereIs(group.id, load.events) : null;
  const herePaddock = here && load.state === "ok" ? load.paddocks.find((p) => p.id === here.paddockId) : null;

  const openMove = () => {
    if (load.state !== "ok" || !group) return;
    const derivedHead = groupHeadCount(group, load.members);
    const derivedWeight = groupAvgWeightLb(group, load.members, load.weights);
    const fill = prefillFrom(here, derivedHead, derivedWeight);
    setGroupId(group.id);
    setAt(toLocalInput(nowIso()));
    setPaddockId("");
    setHeadCount(fill.headCount === null ? "" : String(fill.headCount));
    setAvgWeight(fill.avgWeightLb === null ? "" : String(Math.round(fill.avgWeightLb)));
    setHeightIn("");
    setResidualOut("");
    setUtilization("");
    setSoil("");
    setNotes("");
    setMoving(true);
  };

  // Moving the destination resets the wire to roughly a day's feed, which is
  // where it lands most days anyway.
  const pickDestination = (id: string) => {
    setPaddockId(id);
    if (load.state !== "ok") return;
    const p = load.paddocks.find((x) => x.id === id);
    if (!p || !isSwept(p)) return;
    const from = here?.paddockId === id ? (here.sweptTo ?? 0) : 0;
    const w = widthForHours({
      paddock: p, hours: 24,
      headCount: num(headCount), avgWeightLb: num(avgWeight),
      assumptions: ASSUMPTIONS,
    });
    setWireTo(Math.min(1, from + (w ?? 0.08)));
  };

  const act = async (what: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await what());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const num = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };

  // The row they are moving into, so the form can warn before it is saved.
  const target = rows.find((r) => r.paddock.id === paddockId) ?? null;
  const early = target?.eligible && !target.eligible.met ? target.eligible : null;

  // The figures the readout divides by, from the farm's records where they
  // exist and the stated fallback where they do not.
  const assumed =
    load.state === "ok" && paddockId !== ""
      ? assumptionsFor({
          paddockId,
          plan: load.plan,
          targets: load.targets,
          availability: load.availability,
          todayIso: nowIso(),
          fallback: FALLBACK,
        })
      : { assumptions: FALLBACK, sources: { standing: "default", utilization: "default", intake: "default" } as const };
  const ASSUMPTIONS = assumed.assumptions;

  // ── the strip ───────────────────────────────────────────────────────
  // Where this strip starts: where the last one in the same unit ended,
  // or the beginning of the sweep when this is a fresh pass.
  const dest = target?.paddock ?? null;
  const stripped = dest !== null && isSwept(dest);
  const wireFrom =
    load.state === "ok" && dest && here?.paddockId === dest.id ? (here.sweptTo ?? 0) : 0;

  const strip =
    stripped && dest
      ? planStrip({
          paddock: dest,
          from: wireFrom,
          to: Math.max(wireTo, wireFrom + 0.005),
          headCount: num(headCount),
          avgWeightLb: num(avgWeight),
          assumptions: ASSUMPTIONS,
        })
      : null;

  // What a day would look like, so the wire has somewhere sensible to start.
  const dayWidth =
    stripped && dest
      ? widthForHours({
          paddock: dest,
          hours: 24,
          headCount: num(headCount),
          avgWeightLb: num(avgWeight),
          assumptions: ASSUMPTIONS,
        })
      : null;

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          load.state === "ok"
            ? `${rows.length} paddock${rows.length === 1 ? "" : "s"} · ${acresOf(load.paddocks).toFixed(2)} grazable acres`
            : "Herd"
        }
        title="Paddocks"
        actions={
          <Button
            variant="filled"
            onClick={() => (moving ? setMoving(false) : openMove())}
            disabled={load.state !== "ok" || load.groups.length === 0}
          >
            {moving ? "Cancel" : "Log a move"}
          </Button>
        }
      />

      {error && (
        <div style={{ paddingTop: 16 }}>
          <Callout tone="dashed">{error}</Callout>
        </div>
      )}
      {note && (
        <div style={{ paddingTop: 16 }}>
          <Callout>{note}</Callout>
        </div>
      )}

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <p className="grz-where">
            {group === null ? (
              "No mob on file."
            ) : here && herePaddock ? (
              <>
                <strong>{group.name}</strong> has been in <strong>{herePaddock.name}</strong> for{" "}
                {occupancyDays(here, nowIso())} day{occupancyDays(here, nowIso()) === 1 ? "" : "s"}
                {densityNote(here, herePaddock)}
              </>
            ) : (
              <>
                <strong>{group.name}</strong> is not on pasture.
              </>
            )}
          </p>

          {moving && group && (
            <div className="grz-form">
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Move to</span>
                  <select value={paddockId} onChange={(e) => pickDestination(e.target.value)} aria-label="Move to">
                    <option value="">Pick a paddock…</option>
                    {rows
                      // The unit they are already in stays on the list when it
                      // is swept — the next strip is the commonest move there
                      // is, and hiding it would be hiding the daily job.
                      .filter((r) => r.paddock.id !== here?.paddockId || isSwept(r.paddock))
                      .map((r) => (
                        <option key={r.paddock.id} value={r.paddock.id}>
                          {r.paddock.name}
                          {r.paddock.id === here?.paddockId
                            ? " — next strip"
                            : ` — ${restLabel(r)}`}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grz-field">
                  <span className="eyebrow">When</span>
                  <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="When" />
                </label>
              </div>

              {/* A warning, never a block. The plan is the farm's, and a
                  farmer moving cattle has reasons a form does not know. */}
              {early && (
                <p className="grz-warn">
                  {target!.paddock.name} is {early.shortBy} day{early.shortBy === 1 ? "" : "s"} short of its recovery
                  target — outside plan target, ready {shortDate(early.readyOn)}. Recording it anyway is fine.
                </p>
              )}

              {stripped && dest && (
                <div className="grz-wire">
                  <div className="grz-wire__head">
                    <span className="eyebrow">
                      Wire across {dest.name} · swept {sweepInWords(dest.sweepHeadingDeg)}
                    </span>
                    <span className="mono grz-wire__pos">
                      {Math.round(wireFrom * 100)}% → {Math.round(wireTo * 100)}%
                    </span>
                  </div>

                  {/* The ground already taken this pass, then the strip about
                      to be opened, then what is left standing. */}
                  <div className="grz-sweep" aria-hidden="true">
                    <span className="grz-sweep__done" style={{ width: `${wireFrom * 100}%` }} />
                    <span className="grz-sweep__strip" style={{ width: `${Math.max(0, wireTo - wireFrom) * 100}%` }} />
                  </div>

                  <input
                    type="range"
                    min={Math.round(wireFrom * 1000) + 5}
                    max={1000}
                    step={5}
                    value={Math.round(wireTo * 1000)}
                    onChange={(e) => setWireTo(Number(e.target.value) / 1000)}
                    aria-label="Wire position"
                    className="grz-wire__range"
                  />

                  {strip && (
                    <div className="grz-strip-stats">
                      <div>
                        <div className="mono grz-strip-stats__v">{strip.acres.toFixed(2)}</div>
                        <div className="eyebrow">Acres</div>
                      </div>
                      <div>
                        <div className="mono grz-strip-stats__v">
                          {strip.hoursOfFeed === null ? "—" : formatFeed(strip.hoursOfFeed)}
                        </div>
                        <div className="eyebrow">Feed</div>
                      </div>
                      <div>
                        <div className="mono grz-strip-stats__v">
                          {strip.lbPerAcre === null ? "—" : `${Math.round(strip.lbPerAcre / 100) / 10}k`}
                        </div>
                        <div className="eyebrow">lb / acre</div>
                      </div>
                      <div>
                        <div className="mono grz-strip-stats__v">
                          {strip.widthFt === null ? "—" : `${Math.round(strip.widthFt)}′`}
                        </div>
                        <div className="eyebrow">Width</div>
                      </div>
                    </div>
                  )}

                  <div className="grz-wire__presets">
                    {dayWidth !== null && (
                      <>
                        <button type="button" className="grz-preset"
                          onClick={() => setWireTo(Math.min(1, wireFrom + dayWidth / 2))}>
                          Half a day
                        </button>
                        <button type="button" className="grz-preset"
                          onClick={() => setWireTo(Math.min(1, wireFrom + dayWidth))}>
                          A day
                        </button>
                      </>
                    )}
                    <button type="button" className="grz-preset" onClick={() => setWireTo(1)}>
                      The rest of it
                    </button>
                  </div>

                  <p className="grz-assume">
                    Feed assumes {ASSUMPTIONS.standingLbDmPerAcre.toLocaleString()} lb DM/acre standing{" "}
                    <em>({sourceWord(assumed.sources.standing)})</em>, {ASSUMPTIONS.utilizationPct}% utilization{" "}
                    <em>({sourceWord(assumed.sources.utilization)})</em> and intake at{" "}
                    {ASSUMPTIONS.intakePctBodyweight}% of body weight{" "}
                    <em>({sourceWord(assumed.sources.intake)})</em>. A forecast, not a measurement.
                  </p>
                </div>
              )}

              <p className="grz-optional">
                Everything below is optional. Fill in what you know at the gate and the rest later.
              </p>

              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Head</span>
                  <input value={headCount} onChange={(e) => setHeadCount(e.target.value)} inputMode="numeric" aria-label="Head" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Avg weight, lb</span>
                  <input value={avgWeight} onChange={(e) => setAvgWeight(e.target.value)} inputMode="decimal" aria-label="Avg weight, lb" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Forage in, in</span>
                  <input value={heightIn} onChange={(e) => setHeightIn(e.target.value)} inputMode="decimal" aria-label="Forage in, in" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Soil</span>
                  <select value={soil} onChange={(e) => setSoil(e.target.value as SoilMoisture | "")} aria-label="Soil">
                    <option value="">—</option>
                    <option value="dry">dry</option>
                    <option value="moist">moist</option>
                    <option value="saturated">saturated</option>
                  </select>
                </label>
              </div>

              {here && herePaddock && (
                <>
                  <p className="grz-optional">
                    Leaving <strong>{herePaddock.name}</strong> — what it looks like on the way out:
                  </p>
                  <div className="grz-form__row">
                    <label className="grz-field">
                      <span className="eyebrow">Residual out, in</span>
                      <input value={residualOut} onChange={(e) => setResidualOut(e.target.value)} inputMode="decimal" aria-label="Residual out, in" />
                    </label>
                    <label className="grz-field">
                      <span className="eyebrow">Utilization, %</span>
                      <input value={utilization} onChange={(e) => setUtilization(e.target.value)} inputMode="decimal" aria-label="Utilization, %" />
                    </label>
                  </div>
                </>
              )}

              <label className="grz-field grz-field--wide">
                <span className="eyebrow">Notes</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
              </label>

              <div className="grz-form__actions">
                {here && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await endGrazing(farmId!, group.id, new Date(at).toISOString(), num(residualOut), num(utilization));
                        setMoving(false);
                        return `${group.name} taken off pasture.`;
                      })
                    }
                  >
                    Off pasture
                  </Button>
                )}
                <Button
                  variant="filled"
                  disabled={busy || paddockId === ""}
                  onClick={() =>
                    act(async () => {
                      await logMove(farmId!, {
                        paddockId,
                        groupId: group.id,
                        at: new Date(at).toISOString(),
                        headCount: num(headCount),
                        avgWeightLb: num(avgWeight),
                        forageHeightInEntry: num(heightIn),
                        soilMoisture: soil === "" ? null : soil,
                        notes,
                        latitude: null,
                        longitude: null,
                        residualHeightInExit: num(residualOut),
                        utilizationPct: num(utilization),
                        sweptFrom: stripped ? wireFrom : null,
                        sweptTo: stripped ? Math.max(wireTo, wireFrom + 0.005) : null,
                      });
                      const to = load.paddocks.find((p) => p.id === paddockId);
                      setMoving(false);
                      return stripped && strip
                        ? `${strip.acres.toFixed(2)} acres of ${to?.name ?? "the paddock"} opened to ${group.name}.`
                        : `${group.name} moved to ${to?.name ?? "the paddock"}.`;
                    })
                  }
                >
                  {busy ? "Saving…" : "Log the move"}
                </Button>
              </div>
            </div>
          )}

          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>Paddock</span>
            <span>Rest</span>
            <span className="hide-sm">Last grazed</span>
            <span className="text-right hide-sm">Residual</span>
          </GridRow>

          {rows.map((r) => (
            <GridRow key={r.paddock.id} cols={COLS} mobileCols={COLS_SM} as="body" highlight={r.occupant !== null}>
              <span style={{ minWidth: 0 }}>
                <span className="serif" style={{ fontSize: 17 }}>
                  {r.paddock.name}
                </span>
                {r.occupant && (
                  <>
                    {" "}
                    <Pill variant="outline-green">{r.occupant.group?.name ?? "occupied"}</Pill>
                  </>
                )}
                <br />
                <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
                  {[
                    r.paddock.acresGrazable !== null ? `${r.paddock.acresGrazable} ac` : null,
                    r.occupant ? `in ${r.occupant.days} day${r.occupant.days === 1 ? "" : "s"}` : null,
                    load.state === "ok" && isSwept(r.paddock)
                      ? sweepNote(r.paddock.id, load.events)
                      : null,
                    // Without this the rest figure looks wrong to anyone who
                    // remembers cattle were last on it in June.
                    r.lastCut ? `cut ${shortDate(r.lastCut.removedOn)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {/* The unit's ground, oldest rest to newest. A swept unit is
                    never one rest figure, and this is the shape a single
                    number could not carry. */}
                {load.state === "ok" && isSwept(r.paddock) && (
                  <SweepBar paddockId={r.paddock.id} events={load.events} removals={load.removals} />
                )}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 15 }}>
                  {load.state === "ok" ? restLabelFor(r, load.events, load.removals) : restLabel(r)}
                </span>
                {r.eligible && (
                  <>
                    <br />
                    <span className={`grz-eligible ${r.eligible.met ? "" : "grz-eligible--early"}`}>
                      {r.eligible.met ? "at target" : `${r.eligible.shortBy}d short`}
                    </span>
                  </>
                )}
              </span>
              <span className="mono hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                {r.lastGrazed ? shortDate(r.lastGrazed) : "—"}
              </span>
              <span className="mono text-right hide-sm" style={{ fontSize: 15 }}>
                {r.lastResidualIn === null ? "—" : `${r.lastResidualIn}″`}
              </span>
            </GridRow>
          ))}

          {rows.length === 0 && (
            <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>
              No paddocks on file.
            </p>
          )}

          {!load.hasPlan && (
            <div style={{ marginTop: 20 }}>
              <Callout>
                No grazing plan is on file, so the board shows rest days without saying whether they are enough.
                Recovery targets are per paddock and come from the plan — this app doesn't supply one, because how
                long a paddock needs is a judgement about your ground, not arithmetic.
              </Callout>
            </div>
          )}
        </>
      )}
    </OpsShell>
  );
}

/**
 * The rest a swept unit is judged on.
 *
 * Not the days since the last strip. With a fixed sweep the mob re-enters
 * where it entered last time, so what governs readiness is the ground at the
 * *start* of the sweep — grazed first, rested longest. Measuring from the
 * last strip would hold a unit back for weeks after it was fit to graze.
 */
function restLabelFor(r: BoardRow, events: GrazingEvent[], removals: ForageRemoval[]): string {
  // While they are standing in it, that is the fact worth showing. Readiness
  // is a question about the *next* pass and only becomes the useful figure
  // once this one is over.
  if (r.occupant) return "occupied";
  if (!isSwept(r.paddock)) return restLabel(r);
  const days = readinessDays(r.paddock.id, events, nowIso(), removals);
  if (days === null) return "never grazed";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** How far through the current pass the mob has got. */
function sweepNote(paddockId: string, events: GrazingEvent[]): string | null {
  const done = sweptSoFar(paddockId, events);
  if (done <= 0) return null;
  if (done >= 0.999) return "pass complete";
  return `${Math.round(done * 100)}% of this pass`;
}

/** Bands of the unit's ground, shaded by rest. Boundaries come from where
 * wires have actually been, so nothing is bucketed onto an arbitrary grid. */
function SweepBar({
  paddockId,
  events,
  removals,
}: {
  paddockId: string;
  events: GrazingEvent[];
  removals: ForageRemoval[];
}) {
  const bands = sweepBands(paddockId, events, nowIso(), removals);
  return (
    <span className="grz-bands" aria-hidden="true">
      {bands.map((b) => (
        <span
          key={b.from}
          style={{ width: `${(b.to - b.from) * 100}%`, background: bandFill(b.restDays, b.occupied) }}
        />
      ))}
    </span>
  );
}

function bandFill(restDays: number | null, occupied: boolean): string {
  if (occupied) return "var(--herd-green)";
  if (restDays === null) return "var(--paper-tint)";
  if (restDays >= 30) return "#77805f";
  if (restDays >= 21) return "#9ba489";
  if (restDays >= 14) return "#b8bfa4";
  if (restDays >= 7) return "#cfd3bd";
  return "#e4e2d5";
}

/** Where a figure came from, in a word. "This app's figure" is the one worth
 * saying plainly — it is the only one nobody chose. */
function sourceWord(source: string): string {
  switch (source) {
    case "measured": return "measured on this unit";
    case "planned": return "your projection";
    case "plan": return "from your plan";
    default: return "this app's figure";
  }
}

function acresOf(paddocks: Paddock[]): number {
  return paddocks
    .filter((p) => p.active)
    .reduce((sum, p) => sum + (p.acresGrazable ?? p.acresMeasured ?? 0), 0);
}

function restLabel(r: BoardRow): string {
  if (r.rest.state === "occupied") return "occupied";
  if (r.rest.state === "never") return "never grazed";
  return `${r.rest.days} day${r.rest.days === 1 ? "" : "s"}`;
}

function densityNote(event: GrazingEvent, paddock: Paddock): string {
  const density = stockingDensityLbPerAcre(event, paddock);
  if (density === null) return ".";
  return ` — ${Math.round(density).toLocaleString()} lb per acre.`;
}

/** Hours below a day, days above it — strips can be half a day, and "0.5
 * days" is not how anybody says that. */
function formatFeed(hours: number): string {
  if (hours < 36) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
