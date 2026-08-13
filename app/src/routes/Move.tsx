import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  assumptionsFor,
  drawnSliceAcres,
  fetchActivePlan,
  fetchForageAvailability,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchLatestWeights,
  fetchPaddocks,
  fetchPlanPaddockTargets,
  groupHeadCount,
  inRotation,
  isSwept,
  logMove,
  mobWeight,
  openingWire,
  planStrip,
  readinessDays,
  recordRemoval,
  standingOf,
  stripWidthFt,
  sweepInWords,
  widthForHours,
  type ForageAssumptions,
  type ForageAvailability,
  type ForageRemoval,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingGroupMember,
  type GrazingPlan,
  type Paddock,
  type PlanPaddockTarget,
} from "../lib/grazing";
import {
  asPolygonRing,
  fitPasture,
  fractionAlong,
  localToLonLat,
  pathFor,
  ringCentre,
  sweepCutLine,
  sweepSlice,
  toLocal,
  viewBoxPoint,
  type Local,
  type LonLat,
} from "../lib/pasture-map";
import "./grazing.css";

/**
 * Herd → Move: the morning, on one page.
 *
 * You go out to move the cows. The page already knows where they are and
 * where the back line is, because both are in the open grazing event — the
 * back line is simply where yesterday's wire ended. You take the grass height
 * on the ground they are going into, drag the wire until the feed reads
 * right, and log it. Nothing is picked that does not have to be.
 *
 * This replaces two screens that did the same act twice: a percentage slider
 * on the board and a tap-to-place on the map. Same record either way —
 * `swept_from` and `swept_to` — and one place to do it.
 *
 * **The back line is settable.** Ordinarily it looks after itself, but a unit
 * cut for hay or a section skipped needs it moved, and the database has
 * always allowed that — only the app insisted on deriving it.
 *
 * Nothing here says "compliant".
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      paddocks: Paddock[];
      events: GrazingEvent[];
      removals: ForageRemoval[];
      availability: ForageAvailability[];
      groups: GrazingGroup[];
      members: GrazingGroupMember[];
      weights: Map<string, number>;
      targets: PlanPaddockTarget[];
      plan: GrazingPlan | null;
    };

const WIDTH = 720;

/** Used only where the farm's records are silent, and labelled as such. */
const FALLBACK: ForageAssumptions = {
  standingLbDmPerAcre: 2400,
  utilizationPct: 50,
  intakePctBodyweight: 3,
};

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export default function Move() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  /** Null means "wherever they are". Set only when moving on or skipping. */
  const [destId, setDestId] = useState<string | null>(null);
  const [wireTo, setWireTo] = useState<number | null>(null);
  const [backOverride, setBackOverride] = useState<number | null>(null);
  const [movingBack, setMovingBack] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cutting, setCutting] = useState(false);
  const [cutYield, setCutYield] = useState("");
  const [cutOn, setCutOn] = useState(today);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, events, removals, availability, groups, members, weights, plan] = await Promise.all([
      fetchPaddocks(farmId),
      fetchGrazingEvents(farmId),
      fetchForageRemovals(farmId),
      fetchForageAvailability(farmId),
      fetchGrazingGroups(farmId),
      fetchGroupMembers(farmId),
      fetchLatestWeights(farmId),
      fetchActivePlan(farmId),
    ]);
    const targets = plan ? await fetchPlanPaddockTargets(plan.id) : [];
    setLoad({ state: "ok", paddocks, events, removals, availability, groups, members, weights, targets, plan });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  /**
   * How many viewBox units go to a screen pixel, watched rather than
   * assumed. The drawing has a fixed height and the farm's own proportions,
   * so the two only agree by accident; without this the paddock names come
   * out at nine pixels on a desktop and twenty-seven on a tablet.
   */
  const [unitPx, setUnitPx] = useState(1);
  const measureSvg = useCallback((el: SVGSVGElement | null) => {
    if (el === null) return;
    const read = () => {
      const box = el.getBoundingClientRect();
      const vb = el.viewBox?.baseVal;
      if (box.height <= 0 || !vb || vb.width <= 0 || vb.height <= 0) return;
      const scale = Math.min(box.width / vb.width, box.height / vb.height);
      if (scale > 0) setUnitPx(1 / scale);
    };
    read();
    // jsdom has no ResizeObserver, and there is nothing to observe there.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const group = load.state === "ok" ? (load.groups[0] ?? null) : null;

  const standing = useMemo(() => {
    if (load.state !== "ok" || group === null) return null;
    return standingOf({ groupId: group.id, paddocks: load.paddocks, events: load.events });
  }, [load, group]);

  const units = load.state === "ok" ? inRotation(load.paddocks) : [];

  // Where they are, unless they are being moved on.
  const dest: Paddock | null =
    destId !== null ? (units.find((p) => p.id === destId) ?? null) : (standing?.paddock ?? null);

  const movingOn = dest !== null && dest.id !== standing?.paddock?.id;

  /** Yesterday's wire — or the start of a fresh unit, or wherever it has been
   * dragged to. */
  const backLine = backOverride ?? (movingOn ? 0 : (standing?.backLine ?? 0));

  const head = group && load.state === "ok" ? groupHeadCount(group, load.members) : null;
  const mob =
    group && load.state === "ok"
      ? mobWeight(load.members, group.id, load.weights)
      : { totalLb: null, weighed: 0, missing: 0 };

  // Intake follows the mob's actual total, so mixed sizes are handled — the
  // strip maths takes an average, and average × head is that total.
  const avgWeight = mob.totalLb !== null && head ? mob.totalLb / head : null;

  const heightIn = (() => {
    const v = Number(height.trim());
    return height.trim() !== "" && Number.isFinite(v) && v > 0 ? v : null;
  })();

  const assumed =
    load.state === "ok" && dest
      ? assumptionsFor({
          paddockId: dest.id,
          plan: load.plan,
          targets: load.targets,
          availability: load.availability,
          todayIso: nowIso(),
          fallback: FALLBACK,
          swardHeightIn: heightIn,
        })
      : { assumptions: FALLBACK, sources: { standing: "default", utilization: "default", intake: "default" } as const };

  const stripped = dest !== null && isSwept(dest);

  // The wire opens away from the back line, or there is nothing to grab.
  const wire =
    wireTo ??
    (dest === null
      ? 0
      : openingWire({
          paddock: dest, backLine,
          headCount: head, avgWeightLb: avgWeight,
          assumptions: assumed.assumptions,
        }));

  const strip =
    stripped && dest
      ? planStrip({
          paddock: dest, from: backLine, to: Math.max(wire, backLine + 0.005),
          headCount: head, avgWeightLb: avgWeight,
          assumptions: assumed.assumptions,
        })
      : null;

  const dayWidth =
    stripped && dest
      ? widthForHours({
          paddock: dest, hours: 24,
          headCount: head, avgWeightLb: avgWeight,
          assumptions: assumed.assumptions,
        })
      : null;

  // ── the drawing ─────────────────────────────────────────────────────

  const drawn = useMemo(() => {
    if (load.state !== "ok") return null;
    const withRings = units
      .map((p) => ({ paddock: p, ring: asPolygonRing(p.boundary) }))
      .filter((u): u is { paddock: Paddock; ring: LonLat[] } => u.ring !== null);
    const projection = fitPasture(withRings.map((u) => u.ring), { width: WIDTH, padding: 14 });
    return projection === null ? null : { units: withRings, projection };
  }, [load, units]);

  const destRing: Local[] | null =
    drawn && dest
      ? (drawn.units.find((u) => u.paddock.id === dest.id)?.ring.map((p) => toLocal(drawn.projection.frame, p)) ?? null)
      : null;

  const put = (p: Local): [number, number] =>
    drawn!.projection.project(localToLonLat(drawn!.projection.frame, p));

  /** A finger on the drawing, as a position along the sweep. */
  const at = (clientX: number, clientY: number, svg: SVGSVGElement): number | null => {
    if (!drawn || !dest || destRing === null || !stripped) return null;
    const point = viewBoxPoint({
      clientX, clientY, rect: svg.getBoundingClientRect(),
      viewBoxWidth: drawn.projection.width, viewBoxHeight: drawn.projection.height,
    });
    if (point === null) return null;
    const local = toLocal(drawn.projection.frame, drawn.projection.unproject(point[0], point[1]));
    return fractionAlong(destRing, dest.sweepHeadingDeg!, local);
  };

  const touch = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    const f = at(clientX, clientY, svg);
    if (f === null) return;
    if (movingBack) {
      // The back line may go anywhere ahead of itself — that is what skipping
      // a section means — but never back over ground already taken.
      setBackOverride(f);
      if (wireTo !== null && wireTo <= f) setWireTo(null);
    } else {
      setWireTo(Math.max(backLine + 0.005, f));
    }
  };

  const goTo = (paddock: Paddock | null) => {
    setDestId(paddock?.id ?? null);
    setBackOverride(null);
    setWireTo(null);
    setMovingBack(false);
    setError(null);
  };

  const send = async () => {
    if (!dest || !group || !farmId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await logMove(farmId, {
        paddockId: dest.id,
        groupId: group.id,
        at: nowIso(),
        headCount: head,
        avgWeightLb: avgWeight,
        forageHeightInEntry: heightIn,
        soilMoisture: null,
        notes: "",
        latitude: null,
        longitude: null,
        residualHeightInExit: null,
        utilizationPct: null,
        sweptFrom: stripped ? backLine : null,
        sweptTo: stripped ? Math.max(wire, backLine + 0.005) : null,
      });
      setNote(
        strip
          ? `${strip.acres.toFixed(2)} acres of ${dest.name} opened to ${group.name}.`
          : `${group.name} moved to ${dest.name}.`,
      );
      goTo(null);
      setHeight("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveCut = async () => {
    if (!dest || !farmId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const lb = Number(cutYield.trim());
      await recordRemoval(farmId, {
        paddockId: dest.id,
        removedOn: cutOn,
        kind: "hay",
        cuttingNumber: null,
        yieldLb: cutYield.trim() !== "" && Number.isFinite(lb) ? lb : null,
        yieldBasis: null,
        notes: "",
      });
      setCutting(false);
      setCutYield("");
      setNote(`Hay off ${dest.name} recorded. Its rest now counts from ${shortDate(cutOn)}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rest = load.state === "ok" && dest
    ? readinessDays(dest.id, load.events, nowIso(), load.removals)
    : null;

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          load.state === "ok" && group
            ? [
                group.name,
                head === null ? null : `${head} head`,
                mob.totalLb === null ? null : `${Math.round(mob.totalLb).toLocaleString()} lb on grass`,
              ].filter(Boolean).join(" · ")
            : "Herd"
        }
        title="Move"
        actions={<Link to="/grazing" className="rot-back mono">← the board</Link>}
      />

      {error && <div style={{ paddingTop: 16 }}><Callout tone="dashed">{error}</Callout></div>}
      {note && <div style={{ paddingTop: 16 }}><Callout>{note}</Callout></div>}

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && group === null && (
        <div style={{ paddingTop: 8 }}>
          <Callout>No mob on file, so there is nothing to move.</Callout>
        </div>
      )}

      {load.state === "ok" && group !== null && (
        <>
          <p className="mv-where">
            {standing?.paddock ? (
              <>
                <strong>{group.name}</strong> {movingOn ? "is in" : "is in"}{" "}
                <strong>{standing.paddock.name}</strong>
                {movingOn && <> — moving on to <strong>{dest?.name}</strong></>}
                {rest !== null && !movingOn && <span className="mv-rest"> · {rest} days rested</span>}
              </>
            ) : (
              <>
                <strong>{group.name}</strong> is not on pasture
                {dest ? <> — going into <strong>{dest.name}</strong></> : ", so pick where they go"}
              </>
            )}
          </p>

          {/* On a phone this is one column in the order written. On a wide
              screen the stylesheet puts the drawing beside the readings, so
              the wire and the acres it is changing are in view together. */}
          <div className="mv-layout">

          {/* ── the grass, before the wire, because it sets the figures ── */}
          {dest && (
            <div className="mv-height">
              <label className="mv-field">
                <span className="eyebrow">Grass height in {dest.name}, inches</span>
                <input
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  inputMode="decimal"
                  aria-label="Grass height, inches"
                  placeholder="—"
                />
              </label>
              <p className="mv-height__note">
                {load.plan?.lbDmPerAcreInch == null ? (
                  <>
                    Set <Link to="/grazing/plan">pounds per acre-inch</Link> in the plan and this
                    reading becomes the standing forage behind every figure below.
                  </>
                ) : heightIn === null ? (
                  <>At {load.plan.lbDmPerAcreInch} lb DM per acre-inch, from your plan.</>
                ) : (
                  <>
                    {(heightIn * load.plan.lbDmPerAcreInch).toLocaleString()} lb DM/acre standing —{" "}
                    {heightIn}″ × {load.plan.lbDmPerAcreInch} lb, your figures.
                  </>
                )}
              </p>
            </div>
          )}

          {/* ── the drawing ─────────────────────────────────────────── */}
          {drawn !== null && (
            <figure className="pm-figure mv-figure">
              <svg
                ref={measureSvg}
                viewBox={`0 0 ${drawn.projection.width} ${drawn.projection.height}`}
                className="pm-svg pm-svg--moving"
                /* Text inside the drawing is in viewBox units, and the drawing
                   is letterboxed into a fixed height — so a label's size on
                   screen depends on how the farm happens to fit. This carries
                   the ratio out to the stylesheet, which multiplies it back so
                   a 15px label is 15px at every width. */
                style={{
                  touchAction: dest !== null ? "none" : undefined,
                  ["--pm-unit" as string]: unitPx,
                }}
                role="img"
                aria-label="The farm, with the wire on it"
                onPointerMove={(e) => dragging && touch(e.clientX, e.clientY, e.currentTarget)}
                onPointerUp={() => setDragging(false)}
                onPointerLeave={() => setDragging(false)}
              >
                {drawn.units.map(({ paddock, ring }) => {
                  const here = standing?.paddock?.id === paddock.id;
                  const chosen = dest?.id === paddock.id;
                  return (
                    <path
                      key={paddock.id}
                      d={pathFor(ring.map((p) => drawn.projection.project(p)))}
                      fill={here ? "#dfe3d2" : "var(--paper-tint)"}
                      stroke={chosen ? "var(--ink)" : "var(--ink-faint)"}
                      strokeWidth={chosen ? 2.5 : 1}
                      className="pm-unit-hit"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        if (dest?.id === paddock.id) {
                          setDragging(true);
                          touch(e.clientX, e.clientY, e.currentTarget.ownerSVGElement!);
                        } else {
                          goTo(paddock);
                        }
                      }}
                    />
                  );
                })}

                {/* Ground behind the back line: taken, or skipped past. */}
                {dest && destRing && stripped && backLine > 0 && (
                  <SliceShape
                    ring={destRing} headingDeg={dest.sweepHeadingDeg!}
                    from={0} to={backLine} put={put}
                    fill="var(--herd-green)" opacity={0.42}
                  />
                )}

                {/* What is about to be opened. */}
                {dest && destRing && stripped && (
                  <>
                    <SliceShape
                      ring={destRing} headingDeg={dest.sweepHeadingDeg!}
                      from={backLine} to={Math.max(wire, backLine + 0.005)} put={put}
                      className="pm-proposed"
                    />
                    <CutLine
                      ring={destRing} headingDeg={dest.sweepHeadingDeg!} at={backLine}
                      put={put} className="mv-backline"
                    />
                    <CutLine
                      ring={destRing} headingDeg={dest.sweepHeadingDeg!}
                      at={Math.max(wire, backLine + 0.005)} put={put}
                      className="pm-wire" grip
                    />
                  </>
                )}

                {drawn.units.map(({ paddock, ring }) => {
                  const [cx, cy] = ringCentre(ring.map((p) => drawn.projection.project(p)));
                  return (
                    <text key={`${paddock.id}-l`} x={cx} y={cy} className="pm-label" textAnchor="middle" pointerEvents="none">
                      {paddock.code ?? paddock.name}
                    </text>
                  );
                })}
              </svg>
            </figure>
          )}

          <p className="mv-hint">
            {dest === null
              ? "Tap the paddock they are going into."
              : movingBack
                ? `Tap where the back line goes. Everything behind it counts as left behind — that is how a section, or a paddock cut for hay, gets skipped.`
                : stripped
                  ? "Drag the wire. The dashed line behind them is the back line."
                  : `${dest.name} has no sweep direction, so it is taken whole.`}
          </p>

          {/* ── the readout ─────────────────────────────────────────── */}
          {dest && (
            <div className="grz-form mv-panel">
              <div className="grz-wire__head">
                <span className="eyebrow">
                  {dest.name}
                  {stripped ? ` · swept ${sweepInWords(dest.sweepHeadingDeg)}` : " · taken whole"}
                </span>
                {stripped && (
                  <span className="mono grz-wire__pos">
                    {Math.round(backLine * 100)}% → {Math.round(Math.max(wire, backLine + 0.005) * 100)}%
                  </span>
                )}
              </div>

              {strip && (
                <div className="grz-strip-stats">
                  <div>
                    <div className="mono grz-strip-stats__v">{strip.acres.toFixed(2)}</div>
                    <div className="eyebrow">Acres</div>
                  </div>
                  <div>
                    <div className="mono grz-strip-stats__v">
                      {strip.hoursOfFeed === null ? "—" : daysOfFeed(strip.hoursOfFeed)}
                    </div>
                    <div className="eyebrow">Days of feed</div>
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

              {stripped && (
                <div className="grz-wire__presets">
                  {dayWidth !== null && (
                    <>
                      <button type="button" className="grz-preset"
                        onClick={() => setWireTo(Math.min(1, backLine + dayWidth / 2))}>
                        Half a day
                      </button>
                      <button type="button" className="grz-preset"
                        onClick={() => setWireTo(Math.min(1, backLine + dayWidth))}>
                        A day
                      </button>
                    </>
                  )}
                  <button type="button" className="grz-preset" onClick={() => setWireTo(1)}>
                    The rest of it
                  </button>
                  <button
                    type="button"
                    className={`grz-preset${movingBack ? " grz-preset--on" : ""}`}
                    aria-pressed={movingBack}
                    onClick={() => setMovingBack(!movingBack)}
                  >
                    {movingBack ? "Done with the back line" : "Move the back line"}
                  </button>
                </div>
              )}

              {mob.missing > 0 && (
                <p className="grz-warn">
                  {mob.missing} of {mob.weighed + mob.missing} in the mob {mob.missing === 1 ? "has" : "have"} no
                  weight on file, so the feed figure counts only the {mob.weighed} that{" "}
                  {mob.weighed === 1 ? "does" : "do"}. Weights go on each animal's record.
                </p>
              )}

              {stripped && (
                <p className="grz-assume">
                  {assumed.assumptions.standingLbDmPerAcre.toLocaleString()} lb DM/acre standing{" "}
                  <em>({sourceWord(assumed.sources.standing)})</em>, {assumed.assumptions.utilizationPct}%
                  utilization <em>({sourceWord(assumed.sources.utilization)})</em>, intake at{" "}
                  {assumed.assumptions.intakePctBodyweight}% of body weight{" "}
                  <em>({sourceWord(assumed.sources.intake)})</em>. A forecast, not a measurement.
                </p>
              )}

              <div className="grz-form__actions">
                <Button disabled={busy} onClick={() => setCutting(!cutting)}>
                  {cutting ? "Not hay" : "Cut for hay"}
                </Button>
                <Button variant="filled" disabled={busy} onClick={send}>
                  {busy ? "Saving…" : "Log the move"}
                </Button>
              </div>

              {cutting && (
                <div className="mv-cut">
                  <p className="grz-optional">
                    Recording hay off {dest.name} starts its rest from the day it was cut, and takes it
                    out of the feed the mob has ahead of them.
                  </p>
                  <div className="grz-form__row">
                    <label className="grz-field">
                      <span className="eyebrow">Cut on</span>
                      <input type="date" value={cutOn} onChange={(e) => setCutOn(e.target.value)} aria-label="Cut on" />
                    </label>
                    <label className="grz-field">
                      <span className="eyebrow">Yield, lb</span>
                      <input value={cutYield} onChange={(e) => setCutYield(e.target.value)} inputMode="decimal" aria-label="Yield, lb" />
                    </label>
                    <Button variant="filled" disabled={busy} onClick={saveCut}>
                      Record the cutting
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── moving on, and skipping ─────────────────────────────── */}
          <div className="mv-onward">
            {standing?.next && (
              <button type="button" className="grz-preset" onClick={() => goTo(standing.next)}>
                On to {standing.next.name}
              </button>
            )}
            {units
              .filter((p) => p.id !== dest?.id && p.id !== standing?.next?.id)
              .map((p) => (
                <button key={p.id} type="button" className="grz-preset" onClick={() => goTo(p)}>
                  {p.code ?? p.name}
                </button>
              ))}
            {dest !== null && standing?.paddock && dest.id !== standing.paddock.id && (
              <button type="button" className="grz-preset" onClick={() => goTo(null)}>
                Stay in {standing.paddock.name}
              </button>
            )}
          </div>

          </div>

          {drawn === null && (
            <div style={{ marginTop: 18 }}>
              <Callout>
                No boundaries on file, so there is nothing to draw on. The board still logs a move.
              </Callout>
            </div>
          )}
        </>
      )}
    </OpsShell>
  );
}

function SliceShape({
  ring, headingDeg, from, to, put, fill, opacity, className,
}: {
  ring: Local[]; headingDeg: number; from: number; to: number;
  put: (p: Local) => [number, number];
  fill?: string; opacity?: number; className?: string;
}) {
  const slice = sweepSlice(ring, headingDeg, from, to);
  if (slice === null) return null;
  return (
    <path
      d={pathFor(slice.map(put))}
      className={className}
      fill={fill}
      fillOpacity={opacity}
      stroke="none"
      pointerEvents="none"
    />
  );
}

function CutLine({
  ring, headingDeg, at, put, className, grip,
}: {
  ring: Local[]; headingDeg: number; at: number;
  put: (p: Local) => [number, number];
  className: string; grip?: boolean;
}) {
  const cut = sweepCutLine(ring, headingDeg, at);
  if (cut === null) return null;
  const [a, b] = cut.map(put);
  return (
    <g pointerEvents="none">
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={className} />
      {grip && <circle cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} r={9} className="pm-wire-grip" />}
    </g>
  );
}

/** Days, because that is the word used to decide. Below half a day it reads
 * in hours, since "0.3 days" is not how anybody says that. */
function daysOfFeed(hours: number): string {
  if (hours < 12) return `${Math.round(hours)}h`;
  return (hours / 24).toFixed(1);
}

function sourceWord(source: string): string {
  switch (source) {
    case "height": return "from this morning's height";
    case "measured": return "measured on this unit";
    case "planned": return "your projection";
    case "plan": return "from your plan";
    default: return "this app's figure";
  }
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

/** Re-exported for the tests, which check the acreage the page will show
 * matches what the boundary says. */
export { drawnSliceAcres, stripWidthFt };
