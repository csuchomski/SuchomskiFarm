import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  assumptionsFor,
  currentPass,
  fetchActivePlan,
  fetchForageAvailability,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchInfrastructure,
  fetchLatestWeights,
  fetchPaddocks,
  fetchPlanPaddockTargets,
  groupAvgWeightLb,
  groupHeadCount,
  isSwept,
  logMove,
  openEventFor,
  planStrip,
  readinessDays,
  sweepInWords,
  sweptSoFar,
  whereIs,
  widthForHours,
  type ForageAssumptions,
  type ForageAvailability,
  type ForageRemoval,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingGroupMember,
  type GrazingPlan,
  type Infrastructure,
  type Paddock,
  type PlanPaddockTarget,
} from "../lib/grazing";
import {
  asLineCoords,
  asPoint,
  asPolygonRing,
  fitPasture,
  fractionAlong,
  linePathFor,
  localToLonLat,
  pathFor,
  ringCentre,
  scaleBarFeet,
  sweepCutLine,
  sweepSlice,
  toLocal,
  type Local,
  type LonLat,
} from "../lib/pasture-map";
import "./grazing.css";

/**
 * Herd → Pasture map: the units drawn, and the wire placed on them.
 *
 * The standard asks for a map of the management units showing supporting
 * infrastructure, and this is that map — drawn rather than photographed,
 * because there is no basemap: the owner's own KML supplied the boundaries and
 * fences (040), and water and gates are settled as not mapped.
 *
 * **It also logs the move**, which is the reason to open it rather than the
 * board. On the board the wire is a percentage; here it is a line across the
 * shape of your ground, at the place you are looking at. Same record either
 * way — `swept_from` and `swept_to` — but "there, by the corner" is how
 * somebody standing at a gate actually decides, and a slider cannot ask that
 * question.
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
      infrastructure: Infrastructure[];
    };

const WIDTH = 720;

/** The fallback, used only where the farm's own records are silent — the same
 * three figures the board falls back to, and labelled the same way. */
const FALLBACK: ForageAssumptions = {
  standingLbDmPerAcre: 2400,
  utilizationPct: 50,
  intakePctBodyweight: 3,
};

const nowIso = () => new Date().toISOString();

export default function PastureMap() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [moving, setMoving] = useState(false);
  const [destId, setDestId] = useState<string | null>(null);
  const [wireTo, setWireTo] = useState(0.1);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, events, removals, availability, groups, members, weights, plan, infrastructure] =
      await Promise.all([
        fetchPaddocks(farmId),
        fetchGrazingEvents(farmId),
        fetchForageRemovals(farmId),
        fetchForageAvailability(farmId),
        fetchGrazingGroups(farmId),
        fetchGroupMembers(farmId),
        fetchLatestWeights(farmId),
        fetchActivePlan(farmId),
        fetchInfrastructure(farmId),
      ]);
    const targets = plan ? await fetchPlanPaddockTargets(plan.id) : [];
    setLoad({
      state: "ok", paddocks, events, removals, availability, groups, members,
      weights, targets, plan, infrastructure,
    });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const drawn = useMemo(() => {
    if (load.state !== "ok") return null;

    const units = load.paddocks
      .filter((p) => p.active)
      .map((p) => ({ paddock: p, ring: asPolygonRing(p.boundary) }))
      .filter((u): u is { paddock: Paddock; ring: LonLat[] } => u.ring !== null);

    const lines = load.infrastructure
      .filter((i) => i.active)
      .map((i) => ({ item: i, coords: asLineCoords(i.geometry) }))
      .filter((l): l is { item: Infrastructure; coords: LonLat[] } => l.coords !== null);

    const points = load.infrastructure
      .filter((i) => i.active)
      .map((i) => ({ item: i, at: asPoint(i.geometry) }))
      .filter((p): p is { item: Infrastructure; at: LonLat } => p.at !== null);

    const everything = [
      ...units.map((u) => u.ring),
      ...lines.map((l) => l.coords),
      ...points.map((p) => [p.at]),
    ];
    const projection = fitPasture(everything, { width: WIDTH, padding: 14 });
    if (projection === null) return null;

    return { units, lines, points, projection };
  }, [load]);

  const group = load.state === "ok" ? (load.groups[0] ?? null) : null;
  const here = group && load.state === "ok" ? whereIs(group.id, load.events) : null;

  const dest = drawn?.units.find((u) => u.paddock.id === destId) ?? null;
  const destLocal: Local[] | null =
    dest && drawn ? dest.ring.map((p) => toLocal(drawn.projection.frame, p)) : null;

  /** Where this strip starts: where the last one in the same unit ended. */
  const wireFrom = dest && here?.paddockId === dest.paddock.id ? (here.sweptTo ?? 0) : 0;
  const stripped = dest !== null && isSwept(dest.paddock);

  const head = group && load.state === "ok" ? groupHeadCount(group, load.members) : null;
  const weight = group && load.state === "ok" ? groupAvgWeightLb(group, load.members, load.weights) : null;

  const assumed =
    load.state === "ok" && dest
      ? assumptionsFor({
          paddockId: dest.paddock.id,
          plan: load.plan,
          targets: load.targets,
          availability: load.availability,
          todayIso: nowIso(),
          fallback: FALLBACK,
        })
      : { assumptions: FALLBACK, sources: { standing: "default", utilization: "default", intake: "default" } as const };

  const strip =
    stripped && dest
      ? planStrip({
          paddock: dest.paddock,
          from: wireFrom,
          to: Math.max(wireTo, wireFrom + 0.005),
          headCount: head,
          avgWeightLb: weight,
          assumptions: assumed.assumptions,
        })
      : null;

  const dayWidth =
    stripped && dest
      ? widthForHours({
          paddock: dest.paddock, hours: 24,
          headCount: head, avgWeightLb: weight,
          assumptions: assumed.assumptions,
        })
      : null;

  const pickUnit = (paddock: Paddock) => {
    setDestId(paddock.id);
    setError(null);
    if (!isSwept(paddock)) return;
    // A day's width to begin with, the same default the board uses — rather
    // than jumping the wire to wherever the selecting tap happened to land.
    const from = here?.paddockId === paddock.id ? (here.sweptTo ?? 0) : 0;
    const w = widthForHours({
      paddock, hours: 24, headCount: head, avgWeightLb: weight,
      assumptions: assumed.assumptions,
    });
    setWireTo(Math.min(1, from + (w ?? 0.08)));
  };

  /**
   * A finger on the drawing, turned into a wire position.
   *
   * The bounding rect rather than `getScreenCTM`: the viewBox fills the
   * element exactly — height is computed from the farm's own proportions —
   * so there is no letterboxing to account for, and this works the same in
   * every browser.
   */
  const wireAt = (clientX: number, clientY: number, svg: SVGSVGElement) => {
    if (!drawn || !dest || destLocal === null || !stripped) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const vx = ((clientX - rect.left) / rect.width) * drawn.projection.width;
    const vy = ((clientY - rect.top) / rect.height) * drawn.projection.height;
    const local = toLocal(drawn.projection.frame, drawn.projection.unproject(vx, vy));
    const f = fractionAlong(destLocal, dest.paddock.sweepHeadingDeg!, local);
    if (f === null) return;

    // Never behind the back fence: the wire only ever advances.
    setWireTo(Math.max(wireFrom + 0.005, f));
  };

  const send = async () => {
    if (!dest || !group || !farmId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await logMove(farmId, {
        paddockId: dest.paddock.id,
        groupId: group.id,
        at: nowIso(),
        headCount: head,
        avgWeightLb: weight,
        forageHeightInEntry: null,
        soilMoisture: null,
        notes: "",
        latitude: null,
        longitude: null,
        residualHeightInExit: null,
        utilizationPct: null,
        sweptFrom: stripped ? wireFrom : null,
        sweptTo: stripped ? Math.max(wireTo, wireFrom + 0.005) : null,
      });
      setMoving(false);
      setDestId(null);
      setNote(
        stripped && strip
          ? `${strip.acres.toFixed(2)} acres of ${dest.paddock.name} opened to ${group.name}.`
          : `${group.name} moved to ${dest.paddock.name}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const withoutGeometry =
    load.state === "ok"
      ? load.paddocks.filter((p) => p.active && asPolygonRing(p.boundary) === null)
      : [];

  const acres =
    load.state === "ok"
      ? load.paddocks.filter((p) => p.active).reduce((s, p) => s + (p.acresGrazable ?? p.acresMeasured ?? 0), 0)
      : 0;

  /** Local metres to a projected point, for anything computed rather than read
   * straight off the boundary. */
  const put = (p: Local): [number, number] =>
    drawn!.projection.project(localToLonLat(drawn!.projection.frame, p));

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          load.state === "ok"
            ? `${load.paddocks.filter((p) => p.active).length} units · ${acres.toFixed(2)} grazable acres`
            : "Herd"
        }
        title="Pasture map"
        actions={
          <>
            <Link to="/grazing" className="rot-back mono">← the board</Link>
            <Button
              variant="filled"
              onClick={() => {
                setMoving(!moving);
                setDestId(null);
                setError(null);
                setNote(null);
              }}
              disabled={load.state !== "ok" || drawn === null || group === null}
            >
              {moving ? "Cancel" : "Log a move"}
            </Button>
          </>
        }
      />

      {error && <div style={{ paddingTop: 16 }}><Callout tone="dashed">{error}</Callout></div>}
      {note && <div style={{ paddingTop: 16 }}><Callout>{note}</Callout></div>}

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && drawn === null && (
        <div style={{ paddingTop: 8 }}>
          <Callout>
            Nothing to draw yet. The map is built from the boundaries on each unit — a KML exported
            from Google Earth is the shortest way to get them, and migration 040 shows the shape it
            takes.
          </Callout>
        </div>
      )}

      {load.state === "ok" && drawn !== null && (
        <>
          {moving && (
            <p className="pm-prompt">
              {group === null
                ? "No mob on file."
                : dest === null
                  ? "Tap the paddock they are going into."
                  : stripped
                    ? `Tap or drag across ${dest.paddock.name} to put the wire where you want it.`
                    : `${dest.paddock.name} is taken whole — it has no sweep direction on file.`}
            </p>
          )}

          <figure className="pm-figure">
            <svg
              viewBox={`0 0 ${drawn.projection.width} ${drawn.projection.height}`}
              className={`pm-svg${moving ? " pm-svg--moving" : ""}`}
              role="img"
              aria-label={`Map of ${drawn.units.length} management units`}
              // Only while placing a wire, or the page cannot be scrolled on
              // a phone.
              style={{ touchAction: moving && dest !== null ? "none" : undefined }}
              onPointerMove={(e) => dragging && wireAt(e.clientX, e.clientY, e.currentTarget)}
              onPointerUp={() => setDragging(false)}
              onPointerLeave={() => setDragging(false)}
            >
              {drawn.units.map(({ paddock, ring }) => {
                const pts = ring.map((p) => drawn.projection.project(p));
                const open = openEventFor(paddock.id, load.events);
                const rest = readinessDays(paddock.id, load.events, nowIso(), load.removals);
                const selected = destId === paddock.id;
                return (
                  <path
                    key={paddock.id}
                    d={pathFor(pts)}
                    fill={unitFill(rest, open !== null)}
                    stroke={selected ? "var(--ink)" : "var(--ink-faint)"}
                    strokeWidth={selected ? 2.5 : 1}
                    className={moving ? "pm-unit-hit" : undefined}
                    onPointerDown={(e) => {
                      if (!moving) return;
                      e.preventDefault();
                      if (destId === paddock.id) {
                        setDragging(true);
                        wireAt(e.clientX, e.clientY, e.currentTarget.ownerSVGElement!);
                      } else {
                        pickUnit(paddock);
                      }
                    }}
                  />
                );
              })}

              {/* The ground taken this pass, cut out of the real polygon from
                  the fractions in the move log. */}
              {drawn.units.map(({ paddock, ring }) => {
                if (!isSwept(paddock)) return null;
                const done = sweptSoFar(paddock.id, load.events);
                if (done <= 0) return null;
                const local = ring.map((p) => toLocal(drawn.projection.frame, p));
                const slice = sweepSlice(local, paddock.sweepHeadingDeg!, 0, done);
                if (slice === null) return null;
                return (
                  <path
                    key={`${paddock.id}-taken`}
                    d={pathFor(slice.map(put))}
                    fill="var(--herd-green)"
                    fillOpacity={0.5}
                    stroke="none"
                    pointerEvents="none"
                  />
                );
              })}

              {/* Where they are now. */}
              {drawn.units.map(({ paddock, ring }) => {
                const open = openEventFor(paddock.id, load.events);
                if (!open || open.sweptTo === null || !isSwept(paddock)) return null;
                const local = ring.map((p) => toLocal(drawn.projection.frame, p));
                const slice = sweepSlice(local, paddock.sweepHeadingDeg!, open.sweptFrom ?? 0, open.sweptTo);
                if (slice === null) return null;
                return (
                  <path
                    key={`${paddock.id}-strip`}
                    d={pathFor(slice.map(put))}
                    fill="var(--herd-green)"
                    stroke="var(--ink)"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                );
              })}

              {drawn.lines.map(({ item, coords }) => (
                <path
                  key={item.id}
                  d={linePathFor(coords.map((p) => drawn.projection.project(p)))}
                  fill="none"
                  stroke={item.status === "planned" ? "var(--ochre)" : "var(--ink)"}
                  strokeWidth={item.kind === "permanent_fence" ? 1.8 : 1.2}
                  strokeDasharray={item.status === "planned" ? "5 4" : undefined}
                  pointerEvents="none"
                />
              ))}

              {drawn.points.map(({ item, at }) => {
                const [x, y] = drawn.projection.project(at);
                return <circle key={item.id} cx={x} cy={y} r={4} fill="var(--ink)" pointerEvents="none" />;
              })}

              {/* The strip about to be opened, and the wire that closes it. */}
              {moving && dest !== null && destLocal !== null && stripped && (
                <ProposedStrip
                  ring={destLocal}
                  headingDeg={dest.paddock.sweepHeadingDeg!}
                  from={wireFrom}
                  to={Math.max(wireTo, wireFrom + 0.005)}
                  put={put}
                />
              )}

              {drawn.units.map(({ paddock, ring }) => {
                const [cx, cy] = ringCentre(ring.map((p) => drawn.projection.project(p)));
                return (
                  <g key={`${paddock.id}-label`} pointerEvents="none">
                    <text x={cx} y={cy} className="pm-label" textAnchor="middle">
                      {paddock.code ?? paddock.name}
                    </text>
                    <text x={cx} y={cy + 14} className="pm-sub" textAnchor="middle">
                      {(paddock.acresGrazable ?? paddock.acresMeasured ?? 0).toFixed(2)} ac
                    </text>
                  </g>
                );
              })}

              <ScaleBar projection={drawn.projection} />
            </svg>
          </figure>

          {moving && dest !== null && (
            <div className="grz-form pm-move">
              <div className="grz-wire__head">
                <span className="eyebrow">
                  {dest.paddock.name}
                  {stripped ? ` · swept ${sweepInWords(dest.paddock.sweepHeadingDeg)}` : " · taken whole"}
                </span>
                {stripped && (
                  <span className="mono grz-wire__pos">
                    {Math.round(wireFrom * 100)}% → {Math.round(wireTo * 100)}%
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

              {stripped && (
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
              )}

              {stripped && (
                <p className="grz-assume">
                  Feed assumes {assumed.assumptions.standingLbDmPerAcre.toLocaleString()} lb DM/acre standing{" "}
                  <em>({sourceWord(assumed.sources.standing)})</em>,{" "}
                  {assumed.assumptions.utilizationPct}% utilization{" "}
                  <em>({sourceWord(assumed.sources.utilization)})</em> and intake at{" "}
                  {assumed.assumptions.intakePctBodyweight}% of body weight{" "}
                  <em>({sourceWord(assumed.sources.intake)})</em>. A forecast, not a measurement.
                </p>
              )}

              <p className="grz-optional">
                Logged as of now, with nothing else filled in. The board's form is where the readings
                at the gate go — forage height, residual on the way out, soil.
              </p>

              <div className="grz-form__actions">
                <Button variant="filled" disabled={busy} onClick={send}>
                  {busy ? "Saving…" : "Log the move"}
                </Button>
              </div>
            </div>
          )}

          <div className="pm-legend">
            <span><i className="pm-key pm-key--taken" /> taken this pass</span>
            <span><i className="pm-key pm-key--strip" /> where they are now</span>
            {moving && <span><i className="pm-key pm-key--proposed" /> about to be opened</span>}
            <span><i className="pm-key pm-key--existing" /> fence, existing</span>
            <span><i className="pm-key pm-key--planned" /> fence, planned</span>
            <span className="pm-legend__rest">
              rest: <i className="pm-key" style={{ background: unitFill(3, false) }} />
              <i className="pm-key" style={{ background: unitFill(10, false) }} />
              <i className="pm-key" style={{ background: unitFill(17, false) }} />
              <i className="pm-key" style={{ background: unitFill(24, false) }} />
              <i className="pm-key" style={{ background: unitFill(40, false) }} /> longer
            </span>
          </div>

          {withoutGeometry.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <Callout>
                {withoutGeometry.map((p) => p.name).join(", ")}{" "}
                {withoutGeometry.length === 1 ? "has" : "have"} no boundary on file, so{" "}
                {withoutGeometry.length === 1 ? "it is" : "they are"} not drawn — and{" "}
                {withoutGeometry.length === 1 ? "it cannot" : "they cannot"} be moved into from here.
                The board still has {withoutGeometry.length === 1 ? "it" : "them"}.
              </Callout>
            </div>
          )}

          <h2 className="pm-h2 serif">The units</h2>
          {drawn.units.map(({ paddock }) => {
            const open = openEventFor(paddock.id, load.events);
            const g = open ? load.groups.find((x) => x.id === open.groupId) : null;
            const done = sweptSoFar(paddock.id, load.events);
            const rest = readinessDays(paddock.id, load.events, nowIso(), load.removals);
            return (
              <p key={paddock.id} className="pm-unit">
                <strong>{paddock.name}</strong>
                {open && <> <Pill variant="outline-green">{g?.name ?? "occupied"}</Pill></>}
                <br />
                <span className="pm-unit__sub">
                  {[
                    `${(paddock.acresGrazable ?? paddock.acresMeasured ?? 0).toFixed(2)} grazable acres`,
                    isSwept(paddock) ? `swept ${sweepInWords(paddock.sweepHeadingDeg)}` : null,
                    paddock.sweepLengthFt === null ? null : `${Math.round(paddock.sweepLengthFt)} ft along the sweep`,
                    done > 0 && done < 0.999 ? `${Math.round(done * 100)}% taken this pass` : null,
                    done >= 0.999 ? "pass complete" : null,
                    rest === null ? "never grazed" : `${rest} days rested`,
                    isSwept(paddock) ? `${currentPass(paddock.id, load.events).length} strips this pass` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </p>
            );
          })}

          <h2 className="pm-h2 serif">Infrastructure</h2>
          {load.infrastructure.filter((i) => i.active).length === 0 && (
            <p className="pm-unit__sub">Nothing on file.</p>
          )}
          {load.infrastructure.filter((i) => i.active).map((i) => (
            <p key={i.id} className="pm-unit">
              <strong>{i.name ?? kindLabel(i.kind)}</strong>{" "}
              {i.status === "planned" && <Pill variant="outline">planned</Pill>}
              <br />
              <span className="pm-unit__sub">
                {[
                  kindLabel(i.kind),
                  i.nrcsPracticeCode ? `practice ${i.nrcsPracticeCode}` : null,
                  i.geometry === null ? "no location on file" : "drawn",
                  i.notes || null,
                ].filter(Boolean).join(" · ")}
              </span>
            </p>
          ))}
        </>
      )}
    </OpsShell>
  );
}

/**
 * The strip about to be opened, with the wire drawn across the unit and a
 * handle on it.
 *
 * The handle is the point of it: a line is hard to grab with a thumb, and a
 * generous circle in the middle of it is not.
 */
function ProposedStrip({
  ring, headingDeg, from, to, put,
}: {
  ring: Local[];
  headingDeg: number;
  from: number;
  to: number;
  put: (p: Local) => [number, number];
}) {
  const slice = sweepSlice(ring, headingDeg, from, to);
  const cut = sweepCutLine(ring, headingDeg, to);
  if (slice === null || cut === null) return null;

  const [a, b] = cut.map(put);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  return (
    <g pointerEvents="none">
      <path d={pathFor(slice.map(put))} className="pm-proposed" />
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="pm-wire" />
      <circle cx={mid[0]} cy={mid[1]} r={9} className="pm-wire-grip" />
    </g>
  );
}

function ScaleBar({ projection }: { projection: ReturnType<typeof fitPasture> }) {
  if (projection === null) return null;
  const bar = scaleBarFeet(projection);
  const y = projection.height - 10;
  const x = 14;
  return (
    <g pointerEvents="none">
      <line x1={x} y1={y} x2={x + bar.px} y2={y} stroke="var(--ink)" strokeWidth={1.5} />
      <line x1={x} y1={y - 4} x2={x} y2={y + 2} stroke="var(--ink)" strokeWidth={1.5} />
      <line x1={x + bar.px} y1={y - 4} x2={x + bar.px} y2={y + 2} stroke="var(--ink)" strokeWidth={1.5} />
      <text x={x + bar.px + 6} y={y + 3} className="pm-sub">{bar.feet} ft</text>
    </g>
  );
}

/**
 * Rest, as a wash over the unit.
 *
 * The same ramp the board's sweep bands use, so a colour means the same thing
 * on both screens. Deliberately not red-to-green: this app does not tell
 * anyone a rest period is good or bad.
 */
function unitFill(restDays: number | null, occupied: boolean): string {
  if (occupied) return "#dfe3d2";
  if (restDays === null) return "var(--paper-tint)";
  if (restDays >= 30) return "#77805f";
  if (restDays >= 21) return "#9ba489";
  if (restDays >= 14) return "#b8bfa4";
  if (restDays >= 7) return "#cfd3bd";
  return "#e4e2d5";
}

/** Where a figure came from, in a word. */
function sourceWord(source: string): string {
  switch (source) {
    case "measured": return "measured on this unit";
    case "planned": return "your projection";
    case "plan": return "from your plan";
    default: return "this app's figure";
  }
}

/** Hours below a day, days above it — strips can be half a day. */
function formatFeed(hours: number): string {
  if (hours < 36) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function kindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}
