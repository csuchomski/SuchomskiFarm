import { useCallback, useEffect, useMemo, useState } from "react";
import { todayLocal } from "../lib/local-time";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchPaddocks,
  fetchPastures,
  fetchProperties,
  isSwept,
  paddocksInPasture,
  pasturesInUse,
  type GrazingEvent,
  type GrazingGroup,
  type Paddock,
  type Pasture,
  type Property,
} from "../lib/grazing";
import { gaps, reportRows, totalAcres, type ReportRow } from "../lib/grazing-report";
import {
  asPolygonRing,
  fitPasture,
  localToLonLat,
  pathFor,
  ringCentre,
  ringEncloses,
  sweepSlice,
  toLocal,
  type LonLat,
} from "../lib/pasture-map";
import { useMapScale } from "../lib/use-map-scale";
import "./grazing.css";

/**
 * Grazing → the grazing record.
 *
 * Named "Payment record" until the farm asked for it to say what it is. The
 * file and the library keep the old name on purpose: the *form* is the NRCS
 * 528 payment record, and that is what a conservationist calls it, so the
 * code goes on saying so while the screen says what a farmer calls it.
 *
 * The conservationist's form, filled from the moves. Its columns — pasture,
 * acres, livestock type and number, date in, forage height in, date out,
 * forage height out — are all things the module has been recording since it
 * was built; this page is only the shape they are asked for.
 *
 * The map is the half a table cannot do. "Pasture or Paddock #" on a
 * strip-grazed farm is not a paddock: the mob was on eight different pieces of
 * Paddock 4 in a fortnight, and a row saying "P4" eight times tells a reviewer
 * nothing about which ground. So every strip in the range is drawn where it
 * actually was and labelled with the number in its row.
 *
 * Nothing here says whether the record satisfies the standard. It says what
 * happened.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      paddocks: Paddock[];
      pastures: Pasture[];
      properties: Property[];
      events: GrazingEvent[];
      groups: GrazingGroup[];
    };

const WIDTH = 720;

/** Today and the first of the month, on the wall calendar rather than in UTC.
 *  Pulled up after seven on a summer evening, `toISOString()` would offer
 *  tomorrow as the end of the range and skip a day at the start of a month. */
const today = () => todayLocal();

const monthStart = () => `${todayLocal().slice(0, 7)}-01`;

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

export default function PaymentRecord() {
  const { business, farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [unitPx, measureSvg] = useMapScale();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  /** Which ground the report covers. Null is the whole farm, which is what a
   *  farm with one piece of ground always gets. */
  const [pastureId, setPastureId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, pastures, properties, events, groups] = await Promise.all([
      fetchPaddocks(farmId),
      fetchPastures(farmId),
      fetchProperties(farmId),
      fetchGrazingEvents(farmId),
      fetchGrazingGroups(farmId),
    ]);
    setLoad({ state: "ok", paddocks, pastures, properties, events, groups });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const rows: ReportRow[] = useMemo(() => {
    if (load.state !== "ok") return [];
    if (from > to) return [];
    return reportRows({
      events: load.events, paddocks: load.paddocks, groups: load.groups, from, to, pastureId,
    });
  }, [load, from, to, pastureId]);

  const total = totalAcres(rows);
  const missing = gaps(rows);

  /**
   * The pastures with ground in them.
   *
   * Derived from the paddocks, so a pasture nobody has fenced is not offered
   * as something to narrow a report to. Empty on a farm whose paddocks carry
   * no pasture, which is what tells the picker not to render at all — the
   * same collapse rule the Move page follows.
   */
  const pastures = useMemo(
    () => (load.state === "ok" ? pasturesInUse(load.paddocks.filter((p) => p.active), load.pastures) : []),
    [load],
  );

  /** Which place each pasture is on, so the picker can group by it. Empty on
   *  a farm that has never named a property. */
  const places = useMemo(() => {
    if (load.state !== "ok") return [];
    const used = new Set(pastures.map((r) => r.pasture.propertyId).filter((id) => id !== null));
    return load.properties.filter((pr) => used.has(pr.id));
  }, [load, pastures]);

  const here = pastures.find((r) => r.pasture.id === pastureId)?.pasture ?? null;

  /** What the report is of, in the words the preamble and the empty state
   *  both need. The picker is hidden on paper, so a printout that did not say
   *  this would be a form silently missing half a farm. */
  const covering = here === null ? "the whole farm" : here.name;

  /**
   * The farm, with this window's strips on it.
   *
   * Each strip is clipped out of its paddock's real boundary — the same
   * arithmetic the acres in the table come from, so the drawing and the
   * numbers cannot disagree.
   */
  const drawn = useMemo(() => {
    if (load.state !== "ok") return null;
    const units = paddocksInPasture(load.paddocks.filter((p) => p.active), pastureId)
      .map((p) => ({ paddock: p, ring: asPolygonRing(p.boundary) }))
      .filter((u): u is { paddock: Paddock; ring: LonLat[] } => u.ring !== null);
    const projection = fitPasture(units.map((u) => u.ring), { width: WIDTH, padding: 14 });
    if (projection === null) return null;

    const byId = new Map(units.map((u) => [u.paddock.id, u]));
    // Neighbouring strips are thin and their centres sit at much the same
    // height, so every other label offers to step down out of its neighbour's
    // way — an offer the drawing refuses when the step would leave the strip.
    const seen = new Map<string, number>();
    const strips = rows.flatMap((r) => {
      const unit = byId.get(r.paddockId);
      if (!unit || r.sweptFrom === null || r.sweptTo === null || !isSwept(unit.paddock)) return [];
      const local = unit.ring.map((p) => toLocal(projection.frame, p));
      const slice = sweepSlice(local, unit.paddock.sweepHeadingDeg!, r.sweptFrom, r.sweptTo);
      if (slice === null) return [];
      const points = slice.map((p): [number, number] =>
        projection.project(localToLonLat(projection.frame, p)));
      const nth = (seen.get(r.paddockId) ?? 0);
      seen.set(r.paddockId, nth + 1);
      return [{ row: r, points, stagger: nth % 2 }];
    });

    // A paddock's code is only drawn where no strip carries it. Every strip
    // label already begins with it, so on grazed ground the standalone code is
    // a duplicate that lands squarely on top of the labels that matter.
    const grazed = new Set(strips.map((s) => s.row.paddockId));
    return { units, projection, strips, grazed };
  }, [load, rows, pastureId]);

  return (
    <OpsShell>
      <PageHeader
        eyebrow={business?.name ?? "Grazing"}
        title="Grazing Records"
        actions={<Button variant="filled" onClick={() => window.print()}>Print</Button>}
      />

      {load.state === "loading" && <p className="grz-where">Loading…</p>}
      {load.state === "error" && (
        <div style={{ paddingTop: 8 }}>
          <Callout>{load.message}</Callout>
        </div>
      )}

      {load.state === "ok" && (
        <>
          <div className="grz-form pr-range">
            <div className="grz-form__row" style={{ marginBottom: 0 }}>
              <label className="grz-field">
                <span className="eyebrow">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              </label>
              <label className="grz-field">
                <span className="eyebrow">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              </label>
              {/* Only on a farm with ground to tell apart. One pasture, or
                  none assigned, and a picker would be a control with one
                  answer — the same rule the Move page's locator follows. */}
              {pastures.length > 1 && (
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Ground</span>
                  <select
                    value={pastureId ?? ""}
                    onChange={(e) => setPastureId(e.target.value === "" ? null : e.target.value)}
                    aria-label="Ground"
                  >
                    <option value="">The whole farm</option>
                    {/* Grouped by place where the farm has named them, so six
                        pastures across three leases read as three lists
                        rather than one of six. */}
                    {places.map((place) => (
                      <optgroup key={place.id} label={place.name}>
                        {pastures
                          .filter((r) => r.pasture.propertyId === place.id)
                          .map(({ pasture, paddocks: n }) => (
                            <option key={pasture.id} value={pasture.id}>
                              {pasture.name} · {n} paddock{n === 1 ? "" : "s"}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                    {pastures
                      .filter((r) => places.every((pl) => pl.id !== r.pasture.propertyId))
                      .map(({ pasture, paddocks: n }) => (
                        <option key={pasture.id} value={pasture.id}>
                          {pasture.name} · {n} paddock{n === 1 ? "" : "s"}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            {from > to && (
              <p className="grz-warn" style={{ margin: "12px 0 0" }}>
                The end of the range is before its start.
              </p>
            )}
          </div>

          {/* The range and the ground both named, because the picker above is
              hidden on paper: a printout headed only by its dates, silently
              covering one pasture out of six, is a worse document than one
              with no filter at all. */}
          <p className="rec-preamble">
            Grazing records for {shortDate(from)} → {shortDate(to)}, covering{" "}
            <strong>{covering}</strong>, from the moves logged on this farm. A strip counts as in
            the range if the mob was on it at any point during it. Whether the record meets the
            standard is the conservationist's determination.
          </p>

          {rows.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <Callout>
                {here === null
                  ? "No grazing recorded in this range."
                  : `No grazing recorded on ${here.name} in this range.`}
              </Callout>
            </div>
          ) : (
            <>
              <StripMap drawn={drawn} unitPx={unitPx} measure={measureSvg} />

              <table className="pr-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Pasture or<br />Paddock #</th>
                    <th rowSpan={2}>Acres</th>
                    <th colSpan={2} className="pr-group">Livestock</th>
                    <th rowSpan={2}>Date In</th>
                    <th rowSpan={2}>Forage Height<br />in Inches</th>
                    <th rowSpan={2}>Date Out</th>
                    <th rowSpan={2}>Forage Height<br />in Inches</th>
                  </tr>
                  <tr>
                    <th className="pr-group">Type</th>
                    <th className="pr-group">Number</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.eventId}>
                      <td className="mono">{r.number}</td>
                      <td className="mono text-right">{r.acres === null ? "" : r.acres.toFixed(2)}</td>
                      <td>{r.livestockType ?? ""}</td>
                      <td className="mono text-right">{r.headCount ?? ""}</td>
                      <td className="mono">{shortDate(r.dateIn)}</td>
                      <td className="mono text-right">{r.heightInEntry ?? ""}</td>
                      <td className="mono">{r.dateOut === null ? "" : shortDate(r.dateOut)}</td>
                      <td className="mono text-right">{r.heightOutExit ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="mono">{rows.length} {rows.length === 1 ? "strip" : "strips"}</td>
                    <td className="mono text-right">{total.acres.toFixed(2)}</td>
                    <td colSpan={6} />
                  </tr>
                </tfoot>
              </table>

              {total.missing > 0 && (
                <p className="grz-warn">
                  {total.missing} {total.missing === 1 ? "strip has" : "strips have"} no acreage —
                  the paddock has no boundary drawn, so {total.missing === 1 ? "it is" : "they are"} left
                  out of the total rather than counted as nothing.
                </p>
              )}

              {missing.length > 0 && (
                <p className="rec-gaps">
                  What the record does not say: {missing.join("; ")}. Blanks are blanks — nothing here
                  is filled in on the farm's behalf.
                </p>
              )}
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

/**
 * The strips, drawn where they were, each carrying the number in its row.
 *
 * The slice comes from the same `sweepSlice` the acreage does, so the shape on
 * the page and the figure in the table cannot disagree about which ground was
 * grazed.
 */
interface Drawing {
  units: { paddock: Paddock; ring: LonLat[] }[];
  projection: NonNullable<ReturnType<typeof fitPasture>>;
  strips: { row: ReportRow; points: [number, number][]; stagger: number }[];
  grazed: Set<string>;
}

function StripMap({
  drawn, unitPx, measure,
}: {
  drawn: Drawing | null;
  unitPx: number;
  measure: (el: SVGSVGElement | null) => void;
}) {
  if (drawn === null) return null;
  const { units, projection, strips, grazed } = drawn;
  return (
    <figure className="pm-figure pr-figure">
      <svg
        ref={measure}
        viewBox={`0 0 ${projection.width} ${projection.height}`}
        className="pm-svg"
        style={{ ["--pm-unit" as string]: unitPx }}
        role="img"
        aria-label="The farm, with this range's strips numbered"
      >
        {units.map(({ paddock, ring }) => (
          <path
            key={paddock.id}
            d={pathFor(ring.map((p) => projection.project(p)))}
            fill="var(--paper-tint)"
            stroke="var(--ink)"
            strokeWidth={1}
          />
        ))}

        {strips.map(({ row, points }) => (
          <path
            key={row.eventId}
            d={pathFor(points)}
            fill="#a9bd9a"
            fillOpacity={0.75}
            stroke="var(--ink)"
            strokeWidth={0.8}
          />
        ))}

        {units
          .filter(({ paddock }) => !grazed.has(paddock.id))
          .map(({ paddock, ring }) => {
            const [cx, cy] = ringCentre(ring.map((p) => projection.project(p)));
            return (
              <text key={`${paddock.id}-n`} x={cx} y={cy} className="pm-label pr-unit-label" textAnchor="middle">
                {paddock.code ?? paddock.name}
              </text>
            );
          })}

        {strips.map(({ row, points, stagger }) => {
          const [cx, cy] = ringCentre(points);
          // Stepping out of a neighbour's way must not step off the strip: a
          // number on the wrong ground is worse than two crowded together.
          const step = stagger * 14 * unitPx;
          const y = step !== 0 && ringEncloses(points, cx, cy + step) ? cy + step : cy;
          return (
            <text
              key={`${row.eventId}-l`}
              x={cx}
              y={y}
              className="pr-strip-label"
              textAnchor="middle"
            >
              {row.number}
            </text>
          );
        })}
      </svg>
      <figcaption className="pr-caption">
        Each strip grazed in the range, numbered as in the table. The paddock code is the ground;
        the number after it is which strip out of it.
      </figcaption>
    </figure>
  );
}
