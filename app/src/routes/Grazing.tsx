import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  boardRows,
  fetchForageAvailability,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchLatestWeights,
  fetchPaddocks,
  fetchPlanPaddockTargets,
  fetchActivePlan,
  isSwept,
  whereIs,
  occupancyDays,
  readinessDays,
  stockingDensityLbPerAcre,
  sweepBands,
  sweptSoFar,
  type ForageAvailability,
  type ForageRemoval,
  type GrazingPlan,
  type BoardRow,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingGroupMember,
  type Paddock,
  type PlanPaddockTarget,
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

const nowIso = () => new Date().toISOString();

export default function Grazing() {
  const { farmId } = useWorkspace();
  const nav = useNavigate();
  const [load, setLoad] = useState<Load>({ state: "loading" });

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

  const group = load.state === "ok" ? (load.groups[0] ?? null) : null;
  const here = group && load.state === "ok" ? whereIs(group.id, load.events) : null;
  const herePaddock = here && load.state === "ok" ? load.paddocks.find((p) => p.id === here.paddockId) : null;

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
          <Button variant="filled" onClick={() => nav("/grazing/move")}>
            Move the mob
          </Button>
        }
      />

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

          {/* The move form used to live here. It is on Herd → Move now, which
              knows where the mob is, where the back line is and what the strip
              is worth — none of which a form on a board can say. This page
              answers the other question: which paddock next, and is it ready. */}

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

function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
