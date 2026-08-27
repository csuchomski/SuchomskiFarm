import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, InfoTip, SaveToast } from "../components/ui";
import { DaysOfFeedWorking } from "../components/herd/DaysOfFeedWorking";
import { useWorkspace } from "../lib/workspace";
import {
  assumptionsFor,
  boardRows,
  DEFAULT_UTILIZATION_PCT,
  drawnSliceAcres,
  fetchActivePlan,
  fetchForageAvailability,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchLatestWeights,
  fetchPaddocks,
  fetchPastures,
  fetchPlanPaddockTargets,
  grazeDownTo,
  groupHeadCount,
  inRotation,
  isSwept,
  logMove,
  mobRoster,
  mobWeight,
  paddocksInPasture,
  pasturesInUse,
  openingWire,
  planStrip,
  readinessDays,
  recordRemoval,
  standingOf,
  stripWidthFt,
  sweepInWords,
  sweepToForWidthFt,
  widthForHours,
  FT_PER_YD,
  type BoardRow,
  type ForageAssumptions,
  type ForageAvailability,
  type ForageRemoval,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingGroupMember,
  type GrazingPlan,
  type Paddock,
  type Pasture,
  type PlanPaddockTarget,
} from "../lib/grazing";
import {
  asPolygonRing,
  fitPasture,
  fractionAlong,
  localToLonLat,
  pathFor,
  ringCentre,
  scaleBarFeet,
  sweepCutLine,
  sweepSlice,
  toLocal,
  viewBoxPoint,
  type Local,
  type LonLat,
} from "../lib/pasture-map";
import { useMapScale } from "../lib/use-map-scale";
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
 * The Pasture map page folded into this one. It had three things: this
 * drawing, a list of units, and a list of infrastructure — and the last two
 * were already on the board and in the annual record. The drawing came here
 * and brought a **scale bar**, which is the one thing it had that this page
 * did not.
 *
 * It did **not** bring a fence layer. The farm's four interior fences trace
 * the same lines the units were cut from, so drawing them would put a second
 * line on top of every boundary already here; and the water points were asked
 * to stay off the map. A layer that draws what is already drawn is worse than
 * no layer.
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
      pastures: Pasture[];
      members: GrazingGroupMember[];
      weights: Map<string, number>;
      targets: PlanPaddockTarget[];
      plan: GrazingPlan | null;
    };

const WIDTH = 720;

/** Used only where the farm's records are silent, and labelled as such. */
const FALLBACK: ForageAssumptions = {
  standingLbDmPerAcre: 2400,
  takeDownPct: 50,
  utilizationPct: DEFAULT_UTILIZATION_PCT,
  intakePctBodyweight: 3,
};

/**
 * How long a mob has stood where it is.
 *
 * No colour on it, deliberately. Marking one "overdue" would need a figure
 * for how long a mob may stay in a paddock, and the schema holds no such
 * thing — recovery targets are about how long ground rests once they leave,
 * which is a different question. The row is sorted longest-first, so the
 * order carries the signal without inventing a threshold to colour against.
 */
function daysInWords(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "in today";
  return days === 1 ? "1 day in" : `${days} days in`;
}

/**
 * How long a candidate has been sitting.
 *
 * "Never grazed" rather than a dash, because on a farm that has just added
 * ground the difference between "no record" and "no rest" is the whole
 * decision.
 */
function restWords(r: BoardRow): string {
  if (r.rest.state === "occupied") return "occupied";
  if (r.rest.state === "never") return "never grazed";
  return `${r.rest.days}d`;
}

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

/** Feet or yards, remembered between mornings. Same storage this app already
 * uses for the picked business — per browser, and no worse than losing it. */
const WIDTH_UNIT_KEY = "grazer.wireWidthUnit";

function readWidthUnit(): "ft" | "yd" {
  try {
    return localStorage.getItem(WIDTH_UNIT_KEY) === "yd" ? "yd" : "ft";
  } catch {
    // A private window, or site data blocked. Feet is the default anyway.
    return "ft";
  }
}

export default function Move() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  /** Null means "wherever they are". Set only when moving on or skipping. */
  const [destId, setDestId] = useState<string | null>(null);
  /** A pasture picked deliberately, rather than the one the mob is standing
   *  in. Cleared the moment a paddock is chosen, because the paddock says
   *  which pasture it is in. */
  const [pastureOverride, setPastureOverride] = useState<string | null>(null);
  /** Whether the ranked list of somewhere-else is open. */
  const [elsewhere, setElsewhere] = useState(false);
  /** Which mob is being moved. Null until one is picked, which resolves to
   *  whichever the roster puts first — the one standing longest. */
  const [groupId, setGroupId] = useState<string | null>(null);
  const [wireTo, setWireTo] = useState<number | null>(null);
  const [backOverride, setBackOverride] = useState<number | null>(null);
  const [movingBack, setMovingBack] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState("");
  const [grazeTo, setGrazeTo] = useState("");
  const [ateTo, setAteTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cutting, setCutting] = useState(false);
  const [cutYield, setCutYield] = useState("");
  const [cutOn, setCutOn] = useState(today);

  /**
   * The width box.
   *
   * `widthUnit` is remembered, because it is a habit rather than a decision:
   * a farm that steps its wire off in yards thinks in yards every morning and
   * should not re-pick it every morning. `widthDraft` is what is typed, and
   * null the rest of the time — while it is null the box reads the wire, so
   * dragging updates it. Holding the wire's width in the box at all times
   * instead would fight the typist: "12" on its way to "120" would place a
   * wire, redraw, and round the box back to something else mid-keystroke.
   */
  const [widthUnit, setWidthUnit] = useState<"ft" | "yd">(readWidthUnit);
  const [widthDraft, setWidthDraft] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, pastures, events, removals, availability, groups, members, weights, plan] =
      await Promise.all([
        fetchPaddocks(farmId),
        fetchPastures(farmId),
        fetchGrazingEvents(farmId),
        fetchForageRemovals(farmId),
        fetchForageAvailability(farmId),
        fetchGrazingGroups(farmId),
        fetchGroupMembers(farmId),
        fetchLatestWeights(farmId),
        fetchActivePlan(farmId),
      ]);
    const targets = plan ? await fetchPlanPaddockTargets(plan.id) : [];
    setLoad({ state: "ok", paddocks, pastures, events, removals, availability, groups, members, weights, targets, plan });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const [unitPx, measureSvg] = useMapScale();

  /**
   * Every mob and where it stands, longest-standing first.
   *
   * This used to be `load.groups[0]`, which on a farm with four mobs left
   * three of them with no route to this page at all.
   */
  const roster = useMemo(
    () =>
      load.state === "ok"
        ? mobRoster({ groups: load.groups, paddocks: load.paddocks, events: load.events, nowIso: nowIso() })
        : [],
    [load],
  );

  // The picked mob, or the one the roster puts first. Falling back by
  // position rather than holding a default in state keeps the two in step
  // when a mob is moved and the order changes underneath.
  const group: GrazingGroup | null =
    (groupId === null ? undefined : roster.find((r) => r.group.id === groupId)?.group) ??
    roster[0]?.group ??
    null;

  const standing = useMemo(() => {
    if (load.state !== "ok" || group === null) return null;
    return standingOf({ groupId: group.id, paddocks: load.paddocks, events: load.events });
  }, [load, group]);

  /** Every paddock on the farm, in rotation order. Destinations resolve
   *  against this, so a paddock in another pasture is still reachable. */
  const allUnits = load.state === "ok" ? inRotation(load.paddocks) : [];

  // Where they are, unless they are being moved on.
  const dest: Paddock | null =
    destId !== null ? (allUnits.find((p) => p.id === destId) ?? null) : (standing?.paddock ?? null);

  /**
   * The pasture being worked in.
   *
   * The paddock decides it — a mob standing in North Pasture is working in
   * North Pasture — and the override only matters between picking another
   * pasture and picking a paddock inside it.
   */
  const pastureId: string | null = pastureOverride ?? dest?.pastureId ?? null;

  /** The pastures with ground in them, in the order the farm is walked. */
  const pastures = useMemo(
    () => (load.state === "ok" ? pasturesInUse(load.paddocks.filter((p) => p.active), load.pastures) : []),
    [load],
  );

  /**
   * What the map draws and the picker offers.
   *
   * On a farm that uses pastures this is one pasture's worth; on a farm that
   * does not, `paddocksInPasture` hands back everything and the page reads
   * exactly as it did before.
   */
  const units = paddocksInPasture(allUnits, pastureId);

  /**
   * Where else they could go, best-rested first.
   *
   * Straight from `boardRows`, which is what the grazing board draws — so the
   * two cannot rank the same ground differently. It already sorts
   * longest-rested first, puts occupied units last, and compares rest against
   * the plan's recovery figure for the season the farm is actually in.
   *
   * Which paddock to move to is a recovery decision, and a row of codes in
   * rotation order makes you hold the rest days in your head. At eight
   * paddocks that is a nuisance; the point of ranking is that it is the same
   * gesture at eight as at forty-six.
   */
  const candidates = useMemo(() => {
    if (load.state !== "ok") return [];
    return boardRows({
      paddocks: units,
      events: load.events,
      groups: load.groups,
      targets: load.targets,
      removals: load.removals,
      nowIso: nowIso(),
    }).filter((r) => r.paddock.id !== dest?.id);
    // `units` is derived fresh each render; `load` and `pastureId` are what
    // actually move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, pastureId, dest]);

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

  /** What the field falls back to when it is left blank — shown as its
   *  placeholder so the figure in use is never invisible. */
  const fallbackGrazeTo =
    load.state === "ok" && dest
      ? grazeDownTo({ paddockId: dest.id, plan: load.plan, targets: load.targets }).inches
      : null;

  /**
   * What they actually took the strip they are standing on down to.
   *
   * This is about the ground behind the wire, not ahead of it, and it is the
   * only measurement in the morning — everything else on this page is a
   * forecast. `log_grazing_move` puts it on the event it closes, which is
   * that strip.
   */
  const ateToIn = (() => {
    const v = Number(ateTo.trim());
    return ateTo.trim() !== "" && Number.isFinite(v) && v > 0 ? v : null;
  })();

  /** The strip they are on, which the move is about to close. */
  const openStrip = standing?.open ?? null;

  /** What that works out to as a share of the sward they went in on. Recorded
   *  beside the height so the figure survives if the entry height is later
   *  corrected — and left null rather than guessed when there is no entry
   *  height to divide by. */
  const atePct = (() => {
    const entry = openStrip?.forageHeightInEntry ?? null;
    if (ateToIn === null || entry === null || entry <= 0 || ateToIn >= entry) return null;
    return Math.round(((entry - ateToIn) / entry) * 1000) / 10;
  })();

  const grazeToIn = (() => {
    const v = Number(grazeTo.trim());
    return grazeTo.trim() !== "" && Number.isFinite(v) && v > 0 ? v : null;
  })();

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
          grazeToIn,
        })
      : {
          assumptions: FALLBACK,
          sources: {
            standing: "default", takeDown: "default", utilization: "default", intake: "default",
          } as const,
          grazeDown: { entryIn: null, residualIn: null, source: "none" },
        };

  const stripped = dest !== null && isSwept(dest);

  // The wire opens away from the back line, or there is nothing to grab.
  /**
   * The narrowest strip the form will draw.
   *
   * A wire opened exactly on the back line has no width, and a strip of no
   * width is invisible on the map and reads as nothing on the readout — so
   * the form shows a hair's breadth instead. Half a percent of a 400-foot
   * paddock is about two feet.
   */
  const MIN_STRIP = 0.005;

  const wire =
    wireTo ??
    (dest === null
      ? 0
      : openingWire({
          paddock: dest, backLine,
          headCount: head, avgWeightLb: avgWeight,
          assumptions: assumed.assumptions,
        }));

  /**
   * Where the wire actually goes.
   *
   * The floor keeps a freshly-opened form from drawing a strip of no width.
   * The cap is what was missing: with the back line at the end of a fully
   * grazed paddock, the floor pushed the wire *past* it — offering a
   * two-foot strip of ground that is not there, and standing ready to record
   * one. "The rest of it" left two feet behind every time.
   */
  const wireAt = Math.min(1, Math.max(wire, backLine + MIN_STRIP));

  /** Nothing of this paddock is left to give in this pass. */
  const nothingLeft = stripped && wireAt - backLine <= 1e-9;

  const strip =
    stripped && dest
      ? planStrip({
          paddock: dest, from: backLine, to: wireAt,
          headCount: head, avgWeightLb: avgWeight,
          assumptions: assumed.assumptions,
        })
      : null;

  const dayWidth =
    stripped && dest
      ? widthForHours({
          paddock: dest, hours: 24, from: backLine,
          headCount: head, avgWeightLb: avgWeight,
          assumptions: assumed.assumptions,
        })
      : null;

  const halfDayWidth =
    stripped && dest
      ? widthForHours({
          paddock: dest, hours: 12, from: backLine,
          headCount: head, avgWeightLb: avgWeight,
          assumptions: assumed.assumptions,
        })
      : null;

  // ── typing the width ────────────────────────────────────────────────
  //
  // The wire is dragged with a finger on a phone held in the other hand, in a
  // paddock, and a finger is worth about ten feet. Some strips are stepped
  // off and known — a 60-foot break, the same one as yesterday — and those
  // want typing rather than aiming for.

  /**
   * Move the wire, from anywhere that is not the box.
   *
   * Clearing the draft is the point: a wire dragged or placed by a preset has
   * to show up in the box, and a stale draft would leave the box reading the
   * width somebody typed two moves ago.
   */
  const placeWire = (to: number) => {
    setWireTo(to);
    setWidthDraft(null);
  };

  /**
   * Work in another pasture.
   *
   * The destination goes with it: a paddock chosen in North Pasture is not a
   * destination in Creek Pasture, and leaving it set would draw a map of one
   * pasture with the wire on ground outside it.
   */
  const goToPasture = (id: string) => {
    setPastureOverride(id);
    setElsewhere(false);
    setDestId(null);
    setBackOverride(null);
    clearWire();
    setMovingBack(false);
    setError(null);
  };

  /** Back to the opening wire the page works out for itself. */
  const clearWire = () => {
    setWireTo(null);
    setWidthDraft(null);
  };

  /** Whole units, because nobody sets a wire to a tenth of a foot. */
  const widthNow =
    strip?.widthFt == null
      ? null
      : Math.round(widthUnit === "yd" ? strip.widthFt / FT_PER_YD : strip.widthFt);

  /** What the box shows: what is being typed, or what the wire is at. */
  const widthValue = widthDraft ?? (widthNow === null ? "" : String(widthNow));

  const typeWidth = (text: string) => {
    setWidthDraft(text);
    if (dest === null) return;
    const n = Number(text.trim());
    // An empty or half-typed box leaves the wire where it is rather than
    // throwing it to one end. "6" on the way to "60" is not a request.
    if (text.trim() === "" || !Number.isFinite(n) || n <= 0) return;
    const to = sweepToForWidthFt(dest, backLine, widthUnit === "yd" ? n * FT_PER_YD : n);
    if (to !== null) setWireTo(Math.max(backLine + MIN_STRIP, to));
  };

  const switchUnit = (unit: "ft" | "yd") => {
    setWidthUnit(unit);
    // The wire does not move: the same strip is being read in another unit.
    // Dropping the draft is what makes it re-read, converted.
    setWidthDraft(null);
    try {
      localStorage.setItem(WIDTH_UNIT_KEY, unit);
    } catch {
      // Not worth telling anyone about. The choice holds for this visit.
    }
  };

  // ── the drawing ─────────────────────────────────────────────────────

  /**
   * The drawing.
   *
   * Fitted to the pasture being worked in, not to the farm. Green Pastures
   * is 1,579 acres; fitting to all of it drew 46 shapes the size of postage
   * stamps and made the wire unusable.
   *
   * The design called for the rest of the farm drawn faint around the edge,
   * for orientation. It is not here, because it could not be seen: the
   * viewBox is fitted to the pasture with 14px of padding, and on the seeded
   * farm the next pasture's block starts 2,600ft beyond that — so every one
   * of those outlines rendered outside the frame and was clipped. Widening
   * the fit to catch them would undo the zoom that is the whole point. The
   * pasture row above the map says which ground is next door, in words.
   */
  const drawn = useMemo(() => {
    if (load.state !== "ok") return null;
    const here = units
      .map((p) => ({ paddock: p, ring: asPolygonRing(p.boundary) }))
      .filter((u): u is { paddock: Paddock; ring: LonLat[] } => u.ring !== null);

    const projection = fitPasture(here.map((u) => u.ring), { width: WIDTH, padding: 14 });
    return projection === null ? null : { units: here, projection };
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
      if (wireTo !== null && wireTo <= f) clearWire();
    } else {
      placeWire(Math.max(backLine + MIN_STRIP, f));
    }
  };

  /**
   * Switch to another mob.
   *
   * Everything the form is holding belongs to the mob that was selected — the
   * destination, the back line, the wire, the heights. Carrying any of it
   * across would place this mob's wire using the last one's figures.
   */
  const goToMob = (id: string) => {
    setGroupId(id);
    setPastureOverride(null);
    setElsewhere(false);
    setDestId(null);
    setBackOverride(null);
    clearWire();
    setMovingBack(false);
    setHeight("");
    setGrazeTo("");
    setAteTo("");
    setError(null);
  };

  const goTo = (paddock: Paddock | null) => {
    // The paddock says which pasture it is in, so a deliberate pasture choice
    // has done its job the moment one is picked.
    setPastureOverride(null);
    setElsewhere(false);
    setDestId(paddock?.id ?? null);
    setBackOverride(null);
    clearWire();
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
        // Both of these land on the strip being *closed*, not the one being
        // opened — `log_grazing_move` sets them on the open event before it
        // inserts the new one. So they are what the mob actually did to the
        // ground they are standing on, never what is intended for the ground
        // ahead. Writing a forecast here would file it against the wrong
        // strip and call an intention a measurement twice over.
        residualHeightInExit: ateToIn,
        utilizationPct: atePct,
        sweptFrom: stripped ? backLine : null,
        sweptTo: stripped ? wireAt : null,
      });
      setNote(
        (strip
          ? `${strip.acres.toFixed(2)} acres of ${dest.name} opened to ${group.name}` +
            (assumed.grazeDown.residualIn === null
              ? "."
              : ` — about ${Math.round(strip.lbDmOnOffer).toLocaleString()} lb of dry matter eaten,` +
                ` down to ${assumed.grazeDown.residualIn}″.`)
          : `${group.name} moved to ${dest.name}.`) +
          (ateToIn === null ? "" : ` The strip they left is recorded at ${ateToIn}″.`),
      );
      goTo(null);
      setHeight("");
      setGrazeTo("");
      setAteTo("");
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
        actions={<Link to="/grazing/records?tab=paddocks" className="rot-back mono">← the board</Link>}
      />

      {error && <div style={{ paddingTop: 16 }}><Callout tone="dashed">{error}</Callout></div>}
      <SaveToast note={note} onDone={() => setNote(null)} />

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
          {/* Which mob, when there is more than one.
              Longest-standing first, because the question at the gate is not
              which mobs exist but which one has been in the same paddock
              longest. A single-mob farm sees nothing here at all. */}
          {roster.length > 1 && (
            <div className="mv-mobs" role="group" aria-label="Which mob">
              {roster.map((r) => {
                const on = r.group.id === group.id;
                return (
                  <button
                    key={r.group.id}
                    type="button"
                    className={`mv-mob${on ? " mv-mob--on" : ""}`}
                    aria-pressed={on}
                    onClick={() => goToMob(r.group.id)}
                  >
                    {r.group.name}
                    <span className="mv-mob__where">
                      {r.paddock === null ? (
                        "not on pasture"
                      ) : (
                        <>
                          {r.paddock.code ?? r.paddock.name} · {daysInWords(r.daysIn)}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Which pasture. Only when the farm has more than one — the same
              rule the mob row follows, so a farm with one of each sees
              neither control. */}
          {pastures.length > 1 && (
            <div className="mv-mobs mv-pastures" role="group" aria-label="Which pasture">
              {pastures.map(({ pasture, paddocks: n, acres }) => {
                const on = pasture.id === pastureId;
                return (
                  <button
                    key={pasture.id}
                    type="button"
                    className={`mv-mob${on ? " mv-mob--on" : ""}`}
                    aria-pressed={on}
                    onClick={() => goToPasture(pasture.id)}
                  >
                    {pasture.name}
                    <span className="mv-mob__where">
                      {n} paddock{n === 1 ? "" : "s"} · {Math.round(acres)} ac
                    </span>
                  </button>
                );
              })}
            </div>
          )}

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
          {/* ── what they actually did to the strip they are on ────────
              First, because it is the first thing you look at: you walk out,
              see what they left, and only then decide what to give them next.
              It is also the one measurement on this page — everything below
              is a forecast. */}
          {openStrip !== null && (
            <div className="mv-ate">
              <label className="mv-field">
                <span className="eyebrow">
                  They ate {standing?.paddock?.name ?? "the last strip"} down to, inches
                </span>
                <input
                  value={ateTo}
                  onChange={(e) => setAteTo(e.target.value)}
                  inputMode="decimal"
                  aria-label="They ate it down to, inches"
                  placeholder="—"
                />
              </label>
              <p className="mv-height__note">
                {ateToIn === null ? (
                  <>
                    Measured off the strip behind the wire. Left blank, the record keeps
                    what the strip was sized for and nothing more.
                  </>
                ) : atePct === null ? (
                  <>
                    Recorded against that strip. No entry height was taken for it, so
                    there is nothing to work a share of the sward out from.
                  </>
                ) : (
                  <>
                    {atePct}% of the {openStrip.forageHeightInEntry}″ they went in on
                    {" "}— recorded against that strip, not this one.
                  </>
                )}
              </p>
            </div>
          )}

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
              {/* The graze-down. Beside the height because the figures below
                  are built on the difference between the two, not on either
                  one. Blank falls back to the paddock's target, then the
                  plan's — the placeholder says which is standing in. */}
              <label className="mv-field">
                <span className="eyebrow">Graze it down to, inches</span>
                <input
                  value={grazeTo}
                  onChange={(e) => setGrazeTo(e.target.value)}
                  inputMode="decimal"
                  aria-label="Graze it down to, inches"
                  placeholder={fallbackGrazeTo === null ? "—" : String(fallbackGrazeTo)}
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
                ) : assumed.grazeDown.residualIn !== null ? (
                  // What the height drop is worth, which is not what a cow
                  // gets: some of it goes under a hoof. Rendered beside the
                  // panel's lower figure this read as a contradiction, so it
                  // says which of the two it is and where the other lives.
                  <>
                    {Math.round(
                      (heightIn - assumed.grazeDown.residualIn) * load.plan.lbDmPerAcreInch,
                    ).toLocaleString()}{" "}
                    lb DM/acre comes off the plant — the{" "}
                    {(heightIn - assumed.grazeDown.residualIn).toFixed(1)}″ between them, at{" "}
                    {load.plan.lbDmPerAcreInch} lb an acre-inch. What they eat of it is below.
                  </>
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

                <ScaleBar projection={drawn.projection} unitPx={unitPx} />

                {/* What is about to be opened. */}
                {dest && destRing && stripped && (
                  <>
                    <SliceShape
                      ring={destRing} headingDeg={dest.sweepHeadingDeg!}
                      from={backLine} to={wireAt} put={put}
                      className="pm-proposed"
                    />
                    <CutLine
                      ring={destRing} headingDeg={dest.sweepHeadingDeg!} at={backLine}
                      put={put} className="mv-backline"
                    />
                    <CutLine
                      ring={destRing} headingDeg={dest.sweepHeadingDeg!}
                      at={wireAt} put={put}
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
                  ? "Drag the wire, or set the width below. The dashed line behind them is the back line."
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
                    {Math.round(backLine * 100)}% → {Math.round(wireAt * 100)}%
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
                    {/* The one figure on this row that is five decisions deep,
                        so it is the one that shows its working. */}
                    <div className="eyebrow grz-strip-stats__k">
                      Days of feed
                      <InfoTip label="How days of feed is worked out">
                        <DaysOfFeedWorking
                          assumptions={assumed.assumptions}
                          sources={assumed.sources}
                          acres={strip.acres}
                          headCount={head}
                          avgWeightLb={avgWeight}
                          hoursOfFeed={strip.hoursOfFeed}
                        />
                      </InfoTip>
                    </div>
                  </div>
                  {/* What goes into them: the two heights give what came off
                      the sward, utilization gives the share of it that
                      reached an animal. The label says "eat" and means it. */}
                  <div>
                    <div className="mono grz-strip-stats__v">
                      {Math.round(strip.lbDmOnOffer).toLocaleString()}
                    </div>
                    <div className="eyebrow">lb they'll eat</div>
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

              {/* The pass has reached the far fence. Said plainly, because
                  the alternative was a strip of no width that looked like two
                  feet of grass and could be logged as one. */}
              {nothingLeft && (
                <p className="grz-warn">
                  {dest?.name} is grazed to the far end in this pass — there is nothing left of it
                  to open. Pick the next paddock, or move the back line to start another pass.
                </p>
              )}

              {stripped && (
                <div className="grz-wire__presets">
                  {/* The width presets go when there is no width to be had.
                      "Move the back line" stays — starting another pass is
                      the way out of this, and hiding it would strand the
                      farmer on the message above. */}
                  {!nothingLeft && dayWidth !== null && (
                    <>
                      {/* Its own figure, not half the day's width: half the
                          ground is not half the distance unless the unit is a
                          rectangle. */}
                      <button type="button" className="grz-preset"
                        onClick={() => halfDayWidth !== null && placeWire(Math.min(1, backLine + halfDayWidth))}>
                        Half a day
                      </button>
                      <button type="button" className="grz-preset"
                        onClick={() => placeWire(Math.min(1, backLine + dayWidth))}>
                        A day
                      </button>
                    </>
                  )}
                  {!nothingLeft && (
                    <button type="button" className="grz-preset" onClick={() => placeWire(1)}>
                      The rest of it
                    </button>
                  )}
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

              {/* A wire that is stepped off rather than aimed at.

                  Dragging is right for "about a day's worth" and wrong for
                  "the same 60-foot break as yesterday": a finger on a phone
                  held in a paddock is worth about ten feet. Hidden while the
                  back line is being moved, because then the number would be
                  answering a different question. */}
              {stripped && !nothingLeft && !movingBack && (
                <div className="mv-width">
                  <label className="mv-width__field">
                    <span className="eyebrow">Or set the width</span>
                    <span className="mv-width__entry">
                      <input
                        value={widthValue}
                        onChange={(e) => typeWidth(e.target.value)}
                        onBlur={() => setWidthDraft(null)}
                        inputMode="numeric"
                        aria-label={`Strip width, ${widthUnit === "yd" ? "yards" : "feet"}`}
                        disabled={dest?.sweepLengthFt == null}
                      />
                      <span className="mv-width__units" role="group" aria-label="Width unit">
                        {(["ft", "yd"] as const).map((u) => (
                          <button
                            key={u}
                            type="button"
                            className={`grz-preset mv-width__unit${widthUnit === u ? " grz-preset--on" : ""}`}
                            aria-pressed={widthUnit === u}
                            onClick={() => switchUnit(u)}
                          >
                            {u}
                          </button>
                        ))}
                      </span>
                    </span>
                  </label>
                  <p className="mv-width__note">
                    {dest?.sweepLengthFt == null
                      ? `${dest?.name} has no sweep length on file, so a width here has nothing to measure against. It is on the paddock's record.`
                      : `Measured along the sweep, from the back line. ${dest.name} runs ${Math.round(dest.sweepLengthFt).toLocaleString()}′ end to end.`}
                  </p>
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
                  {assumed.grazeDown.residualIn !== null ? (
                    <>
                      {assumed.grazeDown.entryIn}″ down to {assumed.grazeDown.residualIn}″ ={" "}
                      {Math.round(
                        (assumed.grazeDown.entryIn! - assumed.grazeDown.residualIn) *
                          (load.state === "ok" ? (load.plan?.lbDmPerAcreInch ?? 0) : 0) *
                          (assumed.assumptions.utilizationPct / 100),
                      ).toLocaleString()}{" "}
                      lb DM an acre eaten <em>({grazeWord(assumed.grazeDown.source)})</em> —{" "}
                      {Math.round(assumed.assumptions.takeDownPct)}% of what is standing comes off,
                      and {Math.round(assumed.assumptions.utilizationPct)}% of that is eaten{" "}
                      <em>({sourceWord(assumed.sources.utilization)})</em>.{" "}
                    </>
                  ) : (
                    <>
                      {assumed.assumptions.standingLbDmPerAcre.toLocaleString()} lb DM/acre standing{" "}
                      <em>({sourceWord(assumed.sources.standing)})</em>,{" "}
                      {assumed.assumptions.takeDownPct}% of it grazed off, and{" "}
                      {assumed.assumptions.utilizationPct}% of that eaten{" "}
                      <em>({sourceWord(assumed.sources.utilization)})</em>.{" "}
                    </>
                  )}
                  Intake at {assumed.assumptions.intakePctBodyweight}% of body weight{" "}
                  <em>({sourceWord(assumed.sources.intake)})</em>.{" "}
                  A forecast, not a measurement.
                </p>
              )}

              <div className="grz-form__actions">
                <Button disabled={busy} onClick={() => setCutting(!cutting)}>
                  {cutting ? "Not hay" : "Cut for hay"}
                </Button>
                <Button variant="filled" disabled={busy || nothingLeft} onClick={send}>
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
            {candidates.length > 0 && (
              <button
                type="button"
                className={`grz-preset ${elsewhere ? "grz-preset--on" : ""}`}
                aria-expanded={elsewhere}
                onClick={() => setElsewhere(!elsewhere)}
              >
                {elsewhere ? "Close the list" : "Elsewhere…"}
              </button>
            )}
            {dest !== null && standing?.paddock && dest.id !== standing.paddock.id && (
              <button type="button" className="grz-preset" onClick={() => goTo(null)}>
                Stay in {standing.paddock.name}
              </button>
            )}

            {/* Longest-rested first, which is the order the grazing board
                draws — same function, so the two cannot disagree about which
                ground is ready. */}
            {elsewhere && (
              <div className="mv-elsewhere">
                <p className="mv-elsewhere__lead">Longest rested first.</p>
                <div className="mv-elsewhere__head" aria-hidden="true">
                  <span>Paddock</span>
                  <span>Rested</span>
                  <span className="text-right">Acres</span>
                  <span className="text-right hide-sm">Last grazed</span>
                </div>
                {candidates.map((r) => (
                  <button
                    key={r.paddock.id}
                    type="button"
                    className="mv-cand"
                    onClick={() => goTo(r.paddock)}
                  >
                    <span className="mv-cand__name">
                      {r.paddock.name}
                      {r.occupant && (
                        <span className="mv-cand__note">
                          {" "}
                          — {r.occupant.group?.name ?? "a mob"} in it
                        </span>
                      )}
                    </span>
                    <span className="mv-cand__rest mono">
                      {restWords(r)}
                      {r.eligible && !r.eligible.met && (
                        <span className="grz-eligible grz-eligible--early">
                          {" "}
                          {r.eligible.shortBy}d short
                        </span>
                      )}
                    </span>
                    <span className="mv-cand__acres mono text-right">
                      {r.paddock.acresGrazable ?? r.paddock.acresMeasured ?? "—"}
                    </span>
                    <span className="mv-cand__seen mono text-right hide-sm">
                      {r.lastGrazed ? shortDate(r.lastGrazed) : "—"}
                    </span>
                  </button>
                ))}
              </div>
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

/** Where the graze-down height came from — typed here, or standing in from
 *  the paddock's target or the farm's default. */
function grazeWord(source: string): string {
  switch (source) {
    case "today": return "set here";
    case "paddock": return `${"this paddock's target"}`;
    case "plan": return "your plan's default";
    default: return "this app's figure";
  }
}

/**
 * A date, however it arrived.
 *
 * A cutting is a plain date and a grazing is an instant, and both land here.
 * Appending midnight to something that already carries a time gives
 * "2026-08-05T12:00:00.000ZT00:00:00", which is an Invalid Date — and the
 * page renders those words rather than failing.
 */
function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * How far is that, on the ground.
 *
 * Sized off `--pm-unit` like the labels are, so the bar and its caption stay
 * the same size on a phone as on a desktop while the map behind them scales.
 */
function ScaleBar({
  projection, unitPx,
}: { projection: NonNullable<ReturnType<typeof fitPasture>>; unitPx: number }) {
  const bar = scaleBarFeet(projection);
  const y = projection.height - 10 * unitPx;
  const x = 14 * unitPx;
  const tick = 4 * unitPx;
  return (
    <g pointerEvents="none">
      <line x1={x} y1={y} x2={x + bar.px} y2={y} stroke="var(--ink)" vectorEffect="non-scaling-stroke" />
      <line x1={x} y1={y - tick} x2={x} y2={y + tick / 2} stroke="var(--ink)" vectorEffect="non-scaling-stroke" />
      <line x1={x + bar.px} y1={y - tick} x2={x + bar.px} y2={y + tick / 2} stroke="var(--ink)" vectorEffect="non-scaling-stroke" />
      <text x={x + bar.px + 6 * unitPx} y={y + 3 * unitPx} className="pm-sub">{bar.feet} ft</text>
    </g>
  );
}

/** Re-exported for the tests, which check the acreage the page will show
 * matches what the boundary says. */
export { drawnSliceAcres, stripWidthFt };
