import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  fetchActivePlan,
  fetchContingencyPlans,
  fetchForageAvailability,
  fetchForageDemand,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchInfrastructure,
  fetchKeyAreas,
  fetchManagementDecisions,
  fetchMonitoringRecords,
  fetchPaddocks,
  fetchPlanPaddockTargets,
  fetchResourceConcerns,
  occupancyDays,
  rotationRounds,
  forageEatenLbDm,
  stripAcres,
  sweepInWords,
  type ContingencyPlan,
  type ForageAvailability,
  type ForageDemand,
  type ForageRemoval,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingPlan,
  type Infrastructure,
  type KeyArea,
  type ManagementDecision,
  type MonitoringRecord,
  type Paddock,
  type PlanPaddockTarget,
  type PlanResourceConcern,
} from "../lib/grazing";
import { forageBalance, gapInWords } from "../lib/balance";
import { cadenceInWords } from "../lib/monitoring";
import { downloadCsv, exportFilename, toCsv, type Column } from "../lib/grazing-export";
import "./grazing.css";

/**
 * Herd → Annual record: everything the module holds, in the standard's own
 * section order.
 *
 * The order is not this app's choice. CPS 528's Plans and Specifications
 * section lists what a plan must carry, and a reviewer reads it in that
 * sequence — so the page follows it exactly, and a section with nothing in it
 * says so rather than being dropped. **A missing section is information.**
 * Silently omitting it would leave a reader to guess whether the farm has no
 * contingency plan or whether the app forgot to print one.
 *
 * It prints. The @media print rules drop the nav and the buttons, so "save as
 * PDF" produces the document rather than a screenshot of an app.
 *
 * Nothing here computes or asserts compliance. The words are "recorded",
 * "target" and "outside plan target"; whether any of it meets the standard is
 * the conservationist's determination, and this page carries no opinion.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      plan: GrazingPlan | null;
      paddocks: Paddock[];
      groups: GrazingGroup[];
      events: GrazingEvent[];
      removals: ForageRemoval[];
      availability: ForageAvailability[];
      demand: ForageDemand[];
      targets: PlanPaddockTarget[];
      concerns: PlanResourceConcern[];
      contingencies: ContingencyPlan[];
      areas: KeyArea[];
      records: MonitoringRecord[];
      decisions: ManagementDecision[];
      infrastructure: Infrastructure[];
    };

const nowIso = () => new Date().toISOString();

export default function GrazingRecord() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [
      plan, paddocks, groups, events, removals, availability, demand,
      areas, records, decisions, infrastructure,
    ] = await Promise.all([
      fetchActivePlan(farmId),
      fetchPaddocks(farmId),
      fetchGrazingGroups(farmId),
      fetchGrazingEvents(farmId),
      fetchForageRemovals(farmId),
      fetchForageAvailability(farmId),
      fetchForageDemand(farmId),
      fetchKeyAreas(farmId),
      fetchMonitoringRecords(farmId),
      fetchManagementDecisions(farmId),
      fetchInfrastructure(farmId),
    ]);
    const [targets, concerns, contingencies] = plan
      ? await Promise.all([
          fetchPlanPaddockTargets(plan.id),
          fetchResourceConcerns(plan.id),
          fetchContingencyPlans(plan.id),
        ])
      : [[], [], []];
    setLoad({
      state: "ok", plan, paddocks, groups, events, removals, availability, demand,
      targets, concerns, contingencies, areas, records, decisions, infrastructure,
    });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const nameOf = (id: string | null) =>
    id === null
      ? "the whole farm"
      : load.state === "ok"
        ? (load.paddocks.find((p) => p.id === id)?.name ?? "a paddock")
        : "";

  const rounds = useMemo(() => {
    if (load.state !== "ok") return [];
    return rotationRounds({
      events: load.events, paddocks: load.paddocks,
      removals: load.removals, nowIso: nowIso(),
    });
  }, [load]);

  const balance = useMemo(() => {
    if (load.state !== "ok") return [];
    return forageBalance({
      paddocks: load.paddocks, availability: load.availability,
      demand: load.demand, removals: load.removals,
      planDefaultDmiPctBw: load.plan?.defaultDmiPctBw ?? null,
    });
  }, [load]);

  const exportEvents = () => {
    if (load.state !== "ok") return;
    const cols: Column<GrazingEvent>[] = [
      { key: "paddock", label: "Paddock", value: (e) => nameOf(e.paddockId) },
      { key: "group", label: "Group", value: (e) => load.groups.find((g) => g.id === e.groupId)?.name ?? "" },
      { key: "in", label: "Entered", value: (e) => e.enteredAt },
      { key: "out", label: "Exited", value: (e) => e.exitedAt },
      { key: "days", label: "Days", value: (e) => occupancyDays(e, nowIso()) },
      { key: "head", label: "Head", value: (e) => e.headCount },
      { key: "weight", label: "Avg weight lb", value: (e) => e.avgWeightLb },
      { key: "from", label: "Swept from", value: (e) => e.sweptFrom },
      { key: "to", label: "Swept to", value: (e) => e.sweptTo },
      {
        key: "acres", label: "Acres grazed",
        value: (e) => {
          const p = load.paddocks.find((x) => x.id === e.paddockId);
          const a = p ? stripAcres(e, p) : null;
          return a === null ? null : a.toFixed(3);
        },
      },
      { key: "entry", label: "Forage in (in)", value: (e) => e.forageHeightInEntry },
      { key: "residual", label: "Residual out (in)", value: (e) => e.residualHeightInExit },
      { key: "util", label: "Utilization %", value: (e) => e.utilizationPct },
      {
        // What came off: the acres times the height taken between entry and
        // the graze-down. Blank rather than zero where the record does not
        // carry enough to say — a figure and an absence should not look the
        // same when the season is totalled.
        key: "eaten", label: "Dry matter eaten (lb)",
        value: (e) => {
          const p = load.paddocks.find((x) => x.id === e.paddockId);
          const lb = p ? forageEatenLbDm(e, p, load.plan) : null;
          return lb === null ? null : Math.round(lb);
        },
      },
      { key: "soil", label: "Soil moisture", value: (e) => e.soilMoisture },
      { key: "notes", label: "Notes", value: (e) => e.notes },
    ];
    downloadCsv(exportFilename("events", nowIso()), toCsv(load.events, cols));
  };

  const exportForage = () => {
    if (load.state !== "ok") return;
    type Row = { kind: string; paddock: string; a: string; b: string; c: string; d: string; e: string };
    const rows: Row[] = [
      ...load.availability.map((r) => ({
        kind: r.isPlanned ? "availability (projected)" : "availability",
        paddock: nameOf(r.paddockId),
        a: `${r.periodStart} → ${r.periodEnd}`,
        b: r.lbDmPerAcre === null ? "" : `${r.lbDmPerAcre} lb DM/acre`,
        c: r.aum === null ? "" : `${r.aum} AUM`,
        d: r.basis ?? "",
        e: [r.speciesMix, r.qualityNote, r.notes].filter(Boolean).join("; "),
      })),
      ...load.demand.map((r) => ({
        kind: `demand (${r.kind})`,
        paddock: nameOf(r.paddockId),
        a: `${r.periodStart} → ${r.periodEnd}`,
        b: r.demandLbDm === null ? "" : `${r.demandLbDm} lb DM`,
        c: r.demandAum === null ? "" : `${r.demandAum} AUM`,
        d: r.headCount === null ? "" : `${r.headCount} head @ ${r.avgWeightLb ?? "?"} lb`,
        e: r.notes ?? "",
      })),
      ...load.removals.map((r) => ({
        kind: `removed (${r.kind})`,
        paddock: nameOf(r.paddockId),
        a: r.removedOn,
        b: r.yieldLb === null ? "" : `${r.yieldLb} lb`,
        c: "",
        d: [r.cuttingNumber === null ? "" : `cutting ${r.cuttingNumber}`, r.yieldBasis ?? ""].filter(Boolean).join(", "),
        e: r.notes ?? "",
      })),
    ];
    const cols: Column<Row>[] = [
      { key: "kind", label: "Record", value: (r) => r.kind },
      { key: "paddock", label: "Paddock", value: (r) => r.paddock },
      { key: "a", label: "Period", value: (r) => r.a },
      { key: "b", label: "Pounds", value: (r) => r.b },
      { key: "c", label: "AUM", value: (r) => r.c },
      { key: "d", label: "Basis", value: (r) => r.d },
      { key: "e", label: "Notes", value: (r) => r.e },
    ];
    downloadCsv(exportFilename("forage", nowIso()), toCsv(rows, cols));
  };

  const exportMonitoring = () => {
    if (load.state !== "ok") return;
    const cols: Column<MonitoringRecord>[] = [
      { key: "area", label: "Key area", value: (r) => load.areas.find((a) => a.id === r.keyAreaId)?.name ?? "" },
      {
        key: "paddock", label: "Paddock",
        value: (r) => nameOf(load.areas.find((a) => a.id === r.keyAreaId)?.paddockId ?? null),
      },
      { key: "on", label: "Observed", value: (r) => r.observedOn },
      { key: "protocol", label: "Protocol", value: (r) => r.protocol },
      { key: "residual", label: "Residual (in)", value: (r) => r.residualHeightIn },
      { key: "cover", label: "Ground cover %", value: (r) => r.groundCoverPct },
      { key: "litter", label: "Litter %", value: (r) => r.litterPct },
      { key: "bare", label: "Bare ground %", value: (r) => r.bareGroundPct },
      { key: "species", label: "Species composition", value: (r) => r.speciesComposition },
      { key: "vigor", label: "Key plant vigour", value: (r) => r.keyPlantVigor },
      { key: "erosion", label: "Erosion", value: (r) => r.erosionObservations },
      { key: "compaction", label: "Compaction", value: (r) => r.compactionObservations },
      { key: "observer", label: "Observer", value: (r) => r.observer },
      { key: "notes", label: "Notes", value: (r) => r.notes },
    ];
    downloadCsv(exportFilename("monitoring", nowIso()), toCsv(load.records, cols));
  };

  const exportDecisions = () => {
    if (load.state !== "ok") return;
    const cols: Column<ManagementDecision>[] = [
      { key: "on", label: "Decided", value: (d) => d.decidedOn },
      { key: "obs", label: "Observed", value: (d) => d.observation },
      { key: "trigger", label: "What it meant", value: (d) => d.triggerDescription },
      { key: "decision", label: "Decision", value: (d) => d.decision },
      { key: "outcome", label: "Outcome", value: (d) => d.outcomeFollowup },
      { key: "followed", label: "Followed up", value: (d) => d.followedUpOn },
    ];
    downloadCsv(exportFilename("decisions", nowIso()), toCsv(load.decisions, cols));
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow={load.state === "ok" ? (load.plan?.name ?? "no plan in force") : "Herd"}
        title="Annual record"
        actions={
          <>
            <Link to="/grazing" className="rot-back mono">← the board</Link>
            <Button onClick={() => window.print()} disabled={load.state !== "ok"}>Print</Button>
          </>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && (
        <div className="rec">
          <p className="rec-meta">
            Recorded by the Herd app on {shortDate(nowIso())}
            {load.plan?.contractNumber ? ` · contract ${load.plan.contractNumber}` : ""}
            {load.plan?.tractNumber ? ` · tract ${load.plan.tractNumber}` : ""}
            . These are records of what happened. Whether they meet the standard is the
            conservationist's determination.
          </p>

          <Section n={1} title="Goals and objectives">
            {load.plan === null ? (
              <Missing>No plan is in force, so no goals are on record.</Missing>
            ) : (
              <>
                <Field label="Long-term goals">{load.plan.longTermGoals}</Field>
                <Field label="Immediate objectives">{load.plan.immediateObjectives}</Field>
                <Field label="Plan period">
                  {load.plan.periodStart ? `${load.plan.periodStart} → ${load.plan.periodEnd ?? "…"}` : null}
                </Field>
              </>
            )}
            {load.concerns.length === 0 ? (
              <Missing>No resource concerns recorded.</Missing>
            ) : (
              <ul className="rec-list">
                {load.concerns.map((c) => (
                  <li key={c.id}><strong>{c.category}</strong> — {c.concern}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section n={2} title="Management units and supporting infrastructure">
            <p className="rec-note">
              The drawn map is on <Link to="/grazing/map">Pasture map</Link>.
            </p>
            <table className="rec-table">
              <thead>
                <tr><th>Unit</th><th>Grazable acres</th><th>Sweep</th><th>Type</th></tr>
              </thead>
              <tbody>
                {load.paddocks.filter((p) => p.active).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="mono">{(p.acresGrazable ?? p.acresMeasured ?? 0).toFixed(2)}</td>
                    <td>{sweepInWords(p.sweepHeadingDeg) ?? "taken whole"}</td>
                    <td>{p.unitType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {load.infrastructure.filter((i) => i.active).length === 0 ? (
              <Missing>No supporting infrastructure recorded.</Missing>
            ) : (
              <ul className="rec-list">
                {load.infrastructure.filter((i) => i.active).map((i) => (
                  <li key={i.id}>
                    {i.name ?? i.kind.replace(/_/g, " ")} — {i.kind.replace(/_/g, " ")}
                    {i.status === "planned" ? " (planned)" : ""}
                    {i.nrcsPracticeCode ? `, practice ${i.nrcsPracticeCode}` : ""}
                    {i.geometry === null ? ", no location on file" : ""}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section n={3} title="Forage availability by unit">
            {load.availability.length === 0 ? (
              <Missing>No availability recorded.</Missing>
            ) : (
              <table className="rec-table">
                <thead>
                  <tr><th>Unit</th><th>Period</th><th>lb DM/acre</th><th>AUM</th><th>Basis</th><th>Species and quality</th></tr>
                </thead>
                <tbody>
                  {load.availability.map((a) => (
                    <tr key={a.id}>
                      <td>{nameOf(a.paddockId)}{a.isPlanned ? " (projected)" : ""}</td>
                      <td className="mono">{a.periodLabel ?? `${a.periodStart} → ${a.periodEnd}`}</td>
                      <td className="mono">{a.lbDmPerAcre ?? "—"}</td>
                      <td className="mono">{a.aum ?? "—"}</td>
                      <td>{a.basis ?? "—"}</td>
                      <td>{[a.speciesMix, a.qualityNote].filter(Boolean).join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={4} title="Forage demand">
            {load.demand.length === 0 ? (
              <Missing>No demand recorded.</Missing>
            ) : (
              <table className="rec-table">
                <thead>
                  <tr><th>Unit</th><th>Kind</th><th>Period</th><th>Head</th><th>Avg weight</th><th>Stated demand</th></tr>
                </thead>
                <tbody>
                  {load.demand.map((d) => (
                    <tr key={d.id}>
                      <td>{nameOf(d.paddockId)}</td>
                      <td>{d.kind}</td>
                      <td className="mono">{d.periodLabel ?? `${d.periodStart} → ${d.periodEnd}`}</td>
                      <td className="mono">{d.headCount ?? "—"}</td>
                      <td className="mono">{d.avgWeightLb ?? "—"}</td>
                      <td className="mono">
                        {d.demandLbDm !== null ? `${d.demandLbDm} lb DM` : d.demandAum !== null ? `${d.demandAum} AUM` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={5} title="Feed and forage balance by unit">
            <p className="rec-note">
              Pounds of dry matter and AUM are reported as entered and never converted into one
              another — that conversion needs a figure for what an animal unit eats in a month, which
              is the farm's to choose.
            </p>
            {balance.length === 0 ? (
              <Missing>Nothing to balance yet.</Missing>
            ) : (
              <table className="rec-table">
                <thead>
                  <tr><th>Unit</th><th>Period</th><th>Standing</th><th>Hay off</th><th>Demand</th><th>Balance</th></tr>
                </thead>
                <tbody>
                  {balance.map((l) => (
                    <tr key={`${l.paddockId ?? "farm"}${l.period.start}`}>
                      <td>{l.paddockName ?? "The whole farm"}</td>
                      <td className="mono">{l.period.label ?? `${l.period.start} → ${l.period.end}`}</td>
                      <td className="mono">{fmt(l.supplyLbDm, l.supplyAum)}</td>
                      <td className="mono">{l.hayLbDm === null ? "—" : Math.round(l.hayLbDm).toLocaleString()}</td>
                      <td className="mono">{fmt(l.demandLbDm, l.demandAum)}</td>
                      <td className="mono">
                        {l.balanceLbDm !== null
                          ? Math.round(l.balanceLbDm).toLocaleString()
                          : l.balanceAum !== null
                            ? `${l.balanceAum.toFixed(1)} AUM`
                            : gapInWords(l.gap)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={6} title="Grazing strategy: intensity, timing, duration, frequency">
            {load.targets.length === 0 ? (
              <Missing>No per-unit targets recorded.</Missing>
            ) : (
              <table className="rec-table">
                <thead>
                  <tr><th>Unit</th><th>Entry height</th><th>Residual</th><th>Recovery, growing</th><th>Recovery, dormant</th><th>Utilization</th></tr>
                </thead>
                <tbody>
                  {load.targets.map((t) => (
                    <tr key={t.id}>
                      <td>{nameOf(t.paddockId)}</td>
                      <td className="mono">{t.targetEntryHeightIn ?? "—"}</td>
                      <td className="mono">{t.targetResidualHeightIn ?? "—"}</td>
                      <td className="mono">{t.minRecoveryDaysGrowing ?? "—"}</td>
                      <td className="mono">{t.minRecoveryDaysDormant ?? "—"}</td>
                      <td className="mono">{t.targetUtilizationPct ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="rec-h3">What actually happened</h3>
            {rounds.length === 0 ? (
              <Missing>No grazing recorded yet.</Missing>
            ) : (
              <table className="rec-table">
                <thead>
                  <tr><th>Round</th><th>Unit</th><th>In</th><th>Out</th><th>Days</th><th>Strips</th><th>Rest before</th></tr>
                </thead>
                <tbody>
                  {rounds.flatMap((r) =>
                    r.stays.map((s) => (
                      <tr key={`${r.index}-${s.paddockId}-${s.enteredAt}`}>
                        <td className="mono">{r.index}</td>
                        <td>{nameOf(s.paddockId)}</td>
                        <td className="mono">{s.enteredAt.slice(0, 10)}</td>
                        <td className="mono">{s.exitedAt?.slice(0, 10) ?? "still in it"}</td>
                        <td className="mono">{s.days}</td>
                        <td className="mono">{s.strips}</td>
                        <td className="mono">{s.restBeforeDays ?? "first time"}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={7} title="Contingency plan for episodic events">
            {load.contingencies.length === 0 ? (
              <Missing>No contingency triggers recorded.</Missing>
            ) : (
              <table className="rec-table">
                <thead><tr><th>Trigger</th><th>What trips it</th><th>Planned response</th></tr></thead>
                <tbody>
                  {load.contingencies.map((c) => (
                    <tr key={c.id}>
                      <td>{c.triggerType.replace(/_/g, " ")}</td>
                      <td>{c.triggerThreshold ?? "— not stated"}</td>
                      <td>{c.plannedResponse ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={8} title="Monitoring: key areas, protocols and records">
            <Field label="Cadence in the plan">{cadenceInWords(load.plan)}</Field>
            {load.areas.filter((a) => a.active).length === 0 ? (
              <Missing>No key areas recorded.</Missing>
            ) : (
              <table className="rec-table">
                <thead><tr><th>Key area</th><th>Unit</th><th>Location</th><th>Camera bearing</th></tr></thead>
                <tbody>
                  {load.areas.filter((a) => a.active).map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{nameOf(a.paddockId)}</td>
                      <td className="mono">
                        {a.latitude === null || a.longitude === null ? "— not recorded" : `${a.latitude}, ${a.longitude}`}
                      </td>
                      <td className="mono">{a.photoAzimuthDeg === null ? "— not recorded" : `${a.photoAzimuthDeg}°`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {load.records.length === 0 ? (
              <Missing>No monitoring records.</Missing>
            ) : (
              <table className="rec-table">
                <thead>
                  <tr><th>Date</th><th>Key area</th><th>Residual</th><th>Cover</th><th>Bare</th><th>Observations</th></tr>
                </thead>
                <tbody>
                  {load.records.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.observedOn}</td>
                      <td>{load.areas.find((a) => a.id === r.keyAreaId)?.name ?? "—"}</td>
                      <td className="mono">{r.residualHeightIn ?? "—"}</td>
                      <td className="mono">{r.groundCoverPct ?? "—"}</td>
                      <td className="mono">{r.bareGroundPct ?? "—"}</td>
                      <td>
                        {[r.keyPlantVigor, r.speciesComposition, r.erosionObservations, r.compactionObservations, r.notes]
                          .filter(Boolean).join("; ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section n={9} title="Adaptive management decisions">
            <p className="rec-note">
              Required by Operation and Maintenance: the record of the records being used to make
              changes.
            </p>
            {load.decisions.length === 0 ? (
              <Missing>No decisions recorded.</Missing>
            ) : (
              <table className="rec-table">
                <thead>
                  <tr><th>Date</th><th>Observed</th><th>What it meant</th><th>Decision</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {load.decisions.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.decidedOn}</td>
                      <td>{d.observation ?? "—"}</td>
                      <td>{d.triggerDescription ?? "—"}</td>
                      <td>{d.decision ?? "—"}</td>
                      <td>{d.outcomeFollowup ?? "— not yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <div className="rec-exports">
            <h2 className="pm-h2 serif">The rows behind it</h2>
            <p className="grz-optional">
              CSV, for checking a figure without retyping it. Values that a spreadsheet would treat
              as a formula are neutralised on the way out.
            </p>
            <div className="grz-wire__presets">
              <button type="button" className="grz-preset" onClick={exportEvents}>Grazing events</button>
              <button type="button" className="grz-preset" onClick={exportForage}>Forage records</button>
              <button type="button" className="grz-preset" onClick={exportMonitoring}>Monitoring</button>
              <button type="button" className="grz-preset" onClick={exportDecisions}>Decisions</button>
            </div>
          </div>

          {load.plan === null && (
            <div style={{ marginTop: 18 }}>
              <Callout>
                Sections that draw on the plan are empty because none is in force. Everything
                recorded in the field is here regardless — a record of what happened does not
                depend on a plan existing.
              </Callout>
            </div>
          )}
        </div>
      )}
    </OpsShell>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rec-section">
      <h2 className="rec-h2 serif">
        <span className="rec-n mono">{n}</span> {title}
      </h2>
      {children}
    </section>
  );
}

/** A section with nothing in it says so. Dropping it would leave a reader to
 * guess whether the farm has no contingency plan or the app forgot to print
 * one — and those are very different things. */
function Missing({ children }: { children: React.ReactNode }) {
  return (
    <p className="rec-missing">
      <Pill variant="outline">not recorded</Pill> {children}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="rec-field">
      <span className="eyebrow">{label}</span>
      <br />
      {children ?? <span className="rec-none">— not recorded</span>}
    </p>
  );
}

function fmt(lb: number | null, aum: number | null): string {
  if (lb !== null) return Math.round(lb).toLocaleString();
  if (aum !== null) return `${aum.toFixed(1)} AUM`;
  return "—";
}

function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}
