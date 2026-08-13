import { useCallback, useEffect, useMemo, useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  boardRows,
  endGrazing,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchLatestWeights,
  fetchPaddocks,
  fetchPlanPaddockTargets,
  fetchActivePlan,
  groupAvgWeightLb,
  groupHeadCount,
  logMove,
  occupancyDays,
  prefillFrom,
  stockingDensityLbPerAcre,
  whereIs,
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
      members: GrazingGroupMember[];
      weights: Map<string, number>;
      targets: PlanPaddockTarget[];
      hasPlan: boolean;
    };

const COLS = "minmax(0, 1fr) 110px 120px 96px";
const COLS_SM = "minmax(0, 1fr) 92px";

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

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, groups, events, members, weights, plan] = await Promise.all([
      fetchPaddocks(farmId),
      fetchGrazingGroups(farmId),
      fetchGrazingEvents(farmId),
      fetchGroupMembers(farmId),
      fetchLatestWeights(farmId),
      fetchActivePlan(farmId),
    ]);
    const targets = plan ? await fetchPlanPaddockTargets(plan.id) : [];
    setLoad({ state: "ok", paddocks, groups, events, members, weights, targets, hasPlan: plan !== null });
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

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          load.state === "ok"
            ? `${rows.length} paddock${rows.length === 1 ? "" : "s"} · ${acresOf(load.paddocks).toFixed(2)} grazable acres`
            : "Herd"
        }
        title="Grazing"
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
                  <select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Move to">
                    <option value="">Pick a paddock…</option>
                    {rows
                      .filter((r) => r.paddock.id !== here?.paddockId)
                      .map((r) => (
                        <option key={r.paddock.id} value={r.paddock.id}>
                          {r.paddock.name} — {restLabel(r)}
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
                      });
                      const to = load.paddocks.find((p) => p.id === paddockId);
                      setMoving(false);
                      return `${group.name} moved to ${to?.name ?? "the paddock"}.`;
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
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 15 }}>
                  {restLabel(r)}
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

function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
