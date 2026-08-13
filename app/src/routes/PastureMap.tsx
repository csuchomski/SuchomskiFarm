import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  currentPass,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchInfrastructure,
  fetchPaddocks,
  isSwept,
  openEventFor,
  readinessDays,
  sweepInWords,
  sweptSoFar,
  type ForageRemoval,
  type GrazingEvent,
  type GrazingGroup,
  type Infrastructure,
  type Paddock,
} from "../lib/grazing";
import {
  asLineCoords,
  asPoint,
  asPolygonRing,
  fitPasture,
  linePathFor,
  pathFor,
  ringCentre,
  scaleBarFeet,
  sweepSlice,
  toLocal,
  localToLonLat,
  type LonLat,
} from "../lib/pasture-map";
import "./grazing.css";

/**
 * Herd → Pasture map: the units, drawn, with the fences that make them.
 *
 * The standard asks for a map of the management units showing supporting
 * infrastructure. This is that map — and it is drawn rather than photographed,
 * because there is no basemap: the owner's own KML supplied the boundaries and
 * fences (migration 040), and water and gates are settled as not mapped. Ink
 * on paper is also what the rest of this app looks like.
 *
 * The payoff of the strip model shows up here. A strip was recorded as two
 * fractions along a heading, with no coordinates at all — and because the
 * heading is fixed, that is enough to cut the real polygon and draw exactly
 * the ground the mob has had this pass.
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
      groups: GrazingGroup[];
      infrastructure: Infrastructure[];
    };

const WIDTH = 720;

const nowIso = () => new Date().toISOString();

export default function PastureMap() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, events, removals, groups, infrastructure] = await Promise.all([
      fetchPaddocks(farmId),
      fetchGrazingEvents(farmId),
      fetchForageRemovals(farmId),
      fetchGrazingGroups(farmId),
      fetchInfrastructure(farmId),
    ]);
    setLoad({ state: "ok", paddocks, events, removals, groups, infrastructure });
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

  const withoutGeometry =
    load.state === "ok"
      ? load.paddocks.filter((p) => p.active && asPolygonRing(p.boundary) === null)
      : [];

  const acres =
    load.state === "ok"
      ? load.paddocks
          .filter((p) => p.active)
          .reduce((s, p) => s + (p.acresGrazable ?? p.acresMeasured ?? 0), 0)
      : 0;

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
          <Link to="/grazing" className="rot-back mono">
            ← the board
          </Link>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load: {load.message}
        </p>
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
          <figure className="pm-figure">
            <svg
              viewBox={`0 0 ${drawn.projection.width} ${drawn.projection.height}`}
              className="pm-svg"
              role="img"
              aria-label={`Map of ${drawn.units.length} management units`}
            >
              {/* Units first, so fences and labels sit over them. */}
              {drawn.units.map(({ paddock, ring }) => {
                const pts = ring.map((p) => drawn.projection.project(p));
                const open = openEventFor(paddock.id, load.events);
                const rest = readinessDays(paddock.id, load.events, nowIso(), load.removals);
                return (
                  <path
                    key={paddock.id}
                    d={pathFor(pts)}
                    fill={unitFill(rest, open !== null)}
                    stroke="var(--ink-faint)"
                    strokeWidth={1}
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
                const pts = slice.map((p) =>
                  drawn.projection.project(localToLonLat(drawn.projection.frame, p)),
                );
                return (
                  <path
                    key={`${paddock.id}-taken`}
                    d={pathFor(pts)}
                    fill="var(--herd-green)"
                    fillOpacity={0.5}
                    stroke="none"
                  />
                );
              })}

              {/* The wire itself: the leading edge of the current strip. */}
              {drawn.units.map(({ paddock, ring }) => {
                const open = openEventFor(paddock.id, load.events);
                if (!open || open.sweptTo === null || !isSwept(paddock)) return null;
                const local = ring.map((p) => toLocal(drawn.projection.frame, p));
                const slice = sweepSlice(
                  local,
                  paddock.sweepHeadingDeg!,
                  open.sweptFrom ?? 0,
                  open.sweptTo,
                );
                if (slice === null) return null;
                const pts = slice.map((p) =>
                  drawn.projection.project(localToLonLat(drawn.projection.frame, p)),
                );
                return (
                  <path
                    key={`${paddock.id}-strip`}
                    d={pathFor(pts)}
                    fill="var(--herd-green)"
                    stroke="var(--ink)"
                    strokeWidth={1.5}
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
                  // Planned and existing must not read alike, or a fence that
                  // is only drawn becomes a fence that is there.
                  strokeDasharray={item.status === "planned" ? "5 4" : undefined}
                />
              ))}

              {drawn.points.map(({ item, at }) => {
                const [x, y] = drawn.projection.project(at);
                return <circle key={item.id} cx={x} cy={y} r={4} fill="var(--ink)" />;
              })}

              {drawn.units.map(({ paddock, ring }) => {
                const [cx, cy] = ringCentre(ring.map((p) => drawn.projection.project(p)));
                return (
                  <g key={`${paddock.id}-label`}>
                    <text x={cx} y={cy} className="pm-label" textAnchor="middle">
                      {paddock.code ?? paddock.name}
                    </text>
                    <text x={cx} y={cy + 14} className="pm-sub" textAnchor="middle">
                      {(paddock.acresGrazable ?? paddock.acresMeasured ?? 0).toFixed(2)} ac
                    </text>
                  </g>
                );
              })}

              {/* A drawing without a scale is a picture, not a map. */}
              <ScaleBar projection={drawn.projection} />
            </svg>
          </figure>

          <div className="pm-legend">
            <span>
              <i className="pm-key pm-key--taken" /> taken this pass
            </span>
            <span>
              <i className="pm-key pm-key--strip" /> where they are now
            </span>
            <span>
              <i className="pm-key pm-key--existing" /> fence, existing
            </span>
            <span>
              <i className="pm-key pm-key--planned" /> fence, planned
            </span>
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
                {withoutGeometry.length === 1 ? "it is" : "they are"} not drawn. Everything else on
                the page still counts {withoutGeometry.length === 1 ? "it" : "them"}.
              </Callout>
            </div>
          )}

          <h2 className="pm-h2 serif">The units</h2>
          {drawn.units.map(({ paddock }) => {
            const open = openEventFor(paddock.id, load.events);
            const group = open ? load.groups.find((g) => g.id === open.groupId) : null;
            const done = sweptSoFar(paddock.id, load.events);
            const rest = readinessDays(paddock.id, load.events, nowIso(), load.removals);
            return (
              <p key={paddock.id} className="pm-unit">
                <strong>{paddock.name}</strong>
                {open && (
                  <>
                    {" "}
                    <Pill variant="outline-green">{group?.name ?? "occupied"}</Pill>
                  </>
                )}
                <br />
                <span className="pm-unit__sub">
                  {[
                    `${(paddock.acresGrazable ?? paddock.acresMeasured ?? 0).toFixed(2)} grazable acres`,
                    isSwept(paddock) ? `swept ${sweepInWords(paddock.sweepHeadingDeg)}` : null,
                    paddock.sweepLengthFt === null
                      ? null
                      : `${Math.round(paddock.sweepLengthFt)} ft along the sweep`,
                    done > 0 && done < 0.999 ? `${Math.round(done * 100)}% taken this pass` : null,
                    done >= 0.999 ? "pass complete" : null,
                    rest === null ? "never grazed" : `${rest} days rested`,
                    isSwept(paddock)
                      ? `${currentPass(paddock.id, load.events).length} strips this pass`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
            );
          })}

          <h2 className="pm-h2 serif">Infrastructure</h2>
          {load.infrastructure.filter((i) => i.active).length === 0 && (
            <p className="pm-unit__sub">Nothing on file.</p>
          )}
          {load.infrastructure
            .filter((i) => i.active)
            .map((i) => (
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
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </p>
            ))}
        </>
      )}
    </OpsShell>
  );
}

function ScaleBar({ projection }: { projection: ReturnType<typeof fitPasture> }) {
  if (projection === null) return null;
  const bar = scaleBarFeet(projection);
  const y = projection.height - 10;
  const x = 14;
  return (
    <g>
      <line x1={x} y1={y} x2={x + bar.px} y2={y} stroke="var(--ink)" strokeWidth={1.5} />
      <line x1={x} y1={y - 4} x2={x} y2={y + 2} stroke="var(--ink)" strokeWidth={1.5} />
      <line x1={x + bar.px} y1={y - 4} x2={x + bar.px} y2={y + 2} stroke="var(--ink)" strokeWidth={1.5} />
      <text x={x + bar.px + 6} y={y + 3} className="pm-sub">
        {bar.feet} ft
      </text>
    </g>
  );
}

/**
 * Rest, as a wash over the unit.
 *
 * The same ramp the board's sweep bands use, so a colour means the same thing
 * on both screens. Deliberately not a red-to-green scale: this app does not
 * tell anyone a rest period is good or bad, because how long a paddock needs
 * is a judgement about their ground.
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

function kindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}
