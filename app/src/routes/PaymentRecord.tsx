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
  fetchRounds,
  isSwept,
  paddocksInPasture,
  pasturesInUse,
  roundsFor,
  type GrazingEvent,
  type GrazingGroup,
  type Paddock,
  type Pasture,
  type Property,
  type GrazingRound,
  type RoundView,
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
      rounds: GrazingRound[];
    };

const WIDTH = 720;

/** Today and the first of the month, on the wall calendar rather than in UTC.
 *  Pulled up after seven on a summer evening, `toISOString()` would offer
 *  tomorrow as the end of the range and skip a day at the start of a month. */
const today = () => todayLocal();

const monthStart = () => `${todayLocal().slice(0, 7)}-01`;

/**
 * How a round is named on the page.
 *
 * The mob and the ground come first because a farm running four mobs over six
 * pastures has thirty rounds, and "Round 2" on its own says nothing about
 * which. A named round uses its name; an unnamed one is numbered within its
 * own mob and pasture, which is how it is spoken about.
 */
const roundLabel = (v: RoundView): string => {
  const what = v.round.name ?? `Round ${v.index}`;
  return [v.group?.name, v.pasture?.name, what].filter(Boolean).join(" · ");
};

/** The mob and the ground, which is what the picker groups by. */
const roundScopeLabel = (v: RoundView): string =>
  [v.group?.name, v.pasture?.name].filter(Boolean).join(" · ") || "The whole farm";

/** Which round, and when — everything the heading above it does not say. */
const roundWhen = (v: RoundView): string => {
  const what = v.round.name ?? `Round ${v.index}`;
  if (v.firstEntryAt === null) return `${what} · nothing grazed yet`;
  const from = shortDate(v.firstEntryAt.slice(0, 10));
  const to = v.lastExitAt === null ? "still running" : shortDate(v.lastExitAt.slice(0, 10));
  return `${what} · ${from} → ${to}`;
};

/** Rounds under their mob and ground, each scope keeping the newest-first
 *  order the list arrives in. */
const roundGroups = (rounds: RoundView[]): [string, RoundView[]][] => {
  const by = new Map<string, RoundView[]>();
  for (const v of rounds) {
    const key = roundScopeLabel(v);
    const list = by.get(key);
    if (list) list.push(v);
    else by.set(key, [v]);
  }
  return [...by.entries()];
};

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
  /**
   * A round, when the report is of one rather than of a stretch of calendar.
   *
   * The month was never the unit the farm works in — a trip through a pasture
   * is — and a round straddles the turn of a month as often as not. Held
   * beside the dates rather than instead of them because both questions are
   * real: "what did we do in August" for the quarterly return, "how did that
   * round go" for the grazing itself.
   */
  const [roundId, setRoundId] = useState<string | null | "auto">("auto");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, pastures, properties, events, groups, rounds] = await Promise.all([
      fetchPaddocks(farmId),
      fetchPastures(farmId),
      fetchProperties(farmId),
      fetchGrazingEvents(farmId),
      fetchGrazingGroups(farmId),
      fetchRounds(farmId),
    ]);
    setLoad({ state: "ok", paddocks, pastures, properties, events, groups, rounds });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  /** Every round on the farm, with its grazing hung on it. */
  const views: RoundView[] = useMemo(() => {
    if (load.state !== "ok") return [];
    return roundsFor({
      rounds: load.rounds,
      events: load.events,
      paddocks: load.paddocks,
      groups: load.groups,
      pastures: load.pastures,
      nowIso: new Date().toISOString(),
    }).rounds;
  }, [load]);

  /** The rounds worth offering: those on the ground the report is scoped to,
   *  and only ones with grazing under them — a round started this morning
   *  with nothing in it yet is not a report. */
  const rounds = useMemo(
    () => views.filter((v) => v.stays.length > 0 && (pastureId === null || v.round.pastureId === pastureId)),
    [views, pastureId],
  );

  /**
   * The round you are in.
   *
   * A round still running wins — the mob has not come out of it, so it is the
   * one you are living in — and among those, the one most recently walked
   * into. On a farm with four mobs out at once that is a real choice between
   * several, which is why the rule has to be stated rather than left to
   * whatever order the rows arrived in. Falls back to the last round grazed
   * when nothing is running, and to null on a farm that has grazed none.
   */
  const current = useMemo(() => {
    const enteredAt = (v: RoundView) => v.stays[v.stays.length - 1]?.enteredAt ?? "";
    const running = rounds.filter((v) => v.running);
    const pool = running.length > 0 ? running : rounds;
    return pool.reduce<RoundView | null>(
      (best, v) => (best === null || enteredAt(v) > enteredAt(best) ? v : best),
      null,
    );
  }, [rounds]);

  /**
   * The round the report is of.
   *
   * Derived rather than set by an effect. Defaulting in an effect renders the
   * month first and the round a frame later — a visible flash of the wrong
   * report, and the whole date-range table built for nothing. "auto" means
   * nobody has chosen, so the round you are in stands.
   */
  const chosen =
    roundId === "auto"
      ? current
      : roundId === null
        ? null
        : (rounds.find((v) => v.round.id === roundId) ?? null);

  const rows: ReportRow[] = useMemo(() => {
    if (load.state !== "ok") return [];
    // A round's rows are its own moves, not a date range that happens to
    // cover it: two mobs can be out at once, and a window wide enough to hold
    // this round would sweep in the other mob's grazing of other ground.
    if (chosen !== null) {
      const mine = new Set(chosen.stays.flatMap((st) => st.events.map((e) => e.id)));
      return reportRows({
        events: load.events.filter((e) => mine.has(e.id)),
        paddocks: load.paddocks,
        groups: load.groups,
        from: "0000-01-01",
        to: "9999-12-31",
      });
    }
    if (from > to) return [];
    return reportRows({
      events: load.events, paddocks: load.paddocks, groups: load.groups, from, to, pastureId,
    });
  }, [load, from, to, pastureId, chosen]);

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

  /**
   * The ground the report is actually of.
   *
   * A round belongs to one pasture, so choosing one settles the question the
   * Ground picker was asking. Without this the table is one pasture's worth
   * and the map beside it draws the whole farm — two answers to "what is this
   * a record of" on the same sheet.
   */
  const showing: string | null = chosen?.round.pastureId ?? pastureId;

  const here = pastures.find((r) => r.pasture.id === showing)?.pasture ?? null;

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
    const units = paddocksInPasture(load.paddocks.filter((p) => p.active), showing)
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
  }, [load, rows, showing]);

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
              {/* Hidden while a round is chosen rather than left sitting
                  there deciding nothing. A round brings its own dates, and
                  two date boxes that no longer move the report are a lie
                  about what the page is showing. */}
              {chosen === null && (
                <>
                  <label className="grz-field">
                    <span className="eyebrow">From</span>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                  </label>
                  <label className="grz-field">
                    <span className="eyebrow">To</span>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
                  </label>
                </>
              )}
              {/* Only on a farm with ground to tell apart. One pasture, or
                  none assigned, and a picker would be a control with one
                  answer — the same rule the Move page's locator follows. */}
              {pastures.length > 1 && (
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Ground</span>
                  <select
                    value={pastureId ?? ""}
                    onChange={(e) => {
                      setPastureId(e.target.value === "" ? null : e.target.value);
                      // Back to the round you are in on the ground just
                      // picked. Keeping the old one would leave the picker
                      // showing a round that is no longer on offer.
                      setRoundId("auto");
                    }}
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

              {/* The month was never the unit the farm works in. A trip
                  through a pasture is, and it straddles the turn of a month
                  as often as not. Both are offered because both questions
                  are real. */}
              {rounds.length > 0 && (
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Round</span>
                  <select
                    value={chosen?.round.id ?? ""}
                    onChange={(e) => setRoundId(e.target.value === "" ? null : e.target.value)}
                    aria-label="Round"
                  >
                    <option value="">A date range instead</option>
                    {/* Grouped by mob and ground, because a farm running four
                        mobs over six pastures has thirty rounds and a flat
                        list of them is not a picker. The heading carries the
                        mob and the ground, so the option itself only has to
                        say which round and when. */}
                    {roundGroups(rounds).map(([scope, mine]) => (
                      <optgroup key={scope} label={scope}>
                        {mine.map((v) => (
                          <option key={v.round.id} value={v.round.id}>
                            {roundWhen(v)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {chosen === null && from > to && (
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
            {chosen === null ? (
              <>
                Grazing records for {shortDate(from)} → {shortDate(to)}, covering{" "}
                <strong>{covering}</strong>, from the moves logged on this farm. A strip counts as
                in the range if the mob was on it at any point during it.
              </>
            ) : (
              <>
                Grazing records for <strong>{roundLabel(chosen)}</strong>
                {chosen.firstEntryAt !== null && (
                  <>
                    {" "}
                    — {shortDate(chosen.firstEntryAt.slice(0, 10))} →{" "}
                    {chosen.lastExitAt === null
                      ? "still running"
                      : shortDate(chosen.lastExitAt.slice(0, 10))}
                  </>
                )}
                , from the moves logged on this farm. Every strip that mob took on that ground
                during the round, whether or not it fell in one calendar month.
                {chosen.round.derived && (
                  <> This round's start was worked out from the moves, not recorded at the time.</>
                )}
              </>
            )}{" "}
            Whether the record meets the standard is the conservationist's determination.
          </p>

          {rows.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <Callout>
                {chosen !== null
                  ? `No grazing recorded under ${roundLabel(chosen)}.`
                  : here === null
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
