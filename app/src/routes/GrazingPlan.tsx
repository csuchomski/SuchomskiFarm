import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  addContingency,
  addResourceConcern,
  fetchContingencyPlans,
  fetchPaddocks,
  fetchPlanPaddockTargets,
  fetchPlans,
  fetchResourceConcerns,
  savePaddockTarget,
  savePlan,
  type ContingencyPlan,
  type ContingencyTrigger,
  type GrazingPlan as Plan,
  type MonitoringCadenceKind,
  type Paddock,
  type PlanPaddockTarget,
  type PlanResourceConcern,
  type ResourceCategory,
} from "../lib/grazing";
import "./grazing.css";

/**
 * Herd → Plan: the thresholds every other screen compares against.
 *
 * This page exists because nothing else in the module is allowed to invent a
 * number. Recovery days, residual heights, utilization, monitoring cadence and
 * intake are all decisions about this farm's ground, and until they are
 * written here the rest of the app says "no target" rather than guessing one.
 *
 * A plan is superseded rather than edited forever: starting a new one stands
 * the old one down in the same transaction (migration 042), and last season's
 * targets, concerns and decisions stay exactly where they are. A plan you can
 * quietly rewrite is not a plan a reviewer can rely on.
 *
 * Nothing here says "compliant".
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      plans: Plan[];
      active: Plan | null;
      paddocks: Paddock[];
      targets: PlanPaddockTarget[];
      concerns: PlanResourceConcern[];
      contingencies: ContingencyPlan[];
    };

const CATEGORIES: ResourceCategory[] = ["soil", "water", "air", "plants", "animals"];

const TRIGGERS: { value: ContingencyTrigger; label: string }[] = [
  { value: "drought", label: "Drought" },
  { value: "saturated_soil", label: "Saturated soil" },
  { value: "flood", label: "Flood" },
  { value: "fire", label: "Fire" },
  { value: "insect", label: "Insects" },
  { value: "forage_shortfall", label: "Forage shortfall" },
  { value: "other", label: "Other" },
];

const CADENCES: { value: MonitoringCadenceKind; label: string }[] = [
  { value: "every_rotation", label: "Every rotation" },
  { value: "every_n_days", label: "Every N days" },
  { value: "times_per_season", label: "N times a season" },
];

const TCOLS = "minmax(0, 1fr) 74px 74px 84px 84px";
const TCOLS_SM = "minmax(0, 1fr) 84px";

export default function GrazingPlan() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [startingNew, setStartingNew] = useState(false);

  const [name, setName] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [contract, setContract] = useState("");
  const [tract, setTract] = useState("");
  const [fields, setFields] = useState("");
  const [goals, setGoals] = useState("");
  const [objectives, setObjectives] = useState("");
  const [benchmark, setBenchmark] = useState("");
  const [cadenceKind, setCadenceKind] = useState<MonitoringCadenceKind>("every_rotation");
  const [cadenceValue, setCadenceValue] = useState("");
  const [dmi, setDmi] = useState("");
  const [swardLb, setSwardLb] = useState("");
  const [grazeTo, setGrazeTo] = useState("");

  const [concernCategory, setConcernCategory] = useState<ResourceCategory>("soil");
  const [concernText, setConcernText] = useState("");

  const [trigger, setTrigger] = useState<ContingencyTrigger>("drought");
  const [threshold, setThreshold] = useState("");
  const [response, setResponse] = useState("");

  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [tEntry, setTEntry] = useState("");
  const [tResidual, setTResidual] = useState("");
  const [tGrowing, setTGrowing] = useState("");
  const [tDormant, setTDormant] = useState("");
  const [tUtil, setTUtil] = useState("");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [plans, paddocks] = await Promise.all([fetchPlans(farmId), fetchPaddocks(farmId)]);
    const active = plans.find((p) => p.active) ?? null;
    const [targets, concerns, contingencies] = active
      ? await Promise.all([
          fetchPlanPaddockTargets(active.id),
          fetchResourceConcerns(active.id),
          fetchContingencyPlans(active.id),
        ])
      : [[], [], []];
    setLoad({ state: "ok", plans, active, paddocks, targets, concerns, contingencies });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const num = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };

  const openEdit = (fresh: boolean) => {
    const p = load.state === "ok" ? load.active : null;
    setError(null);
    setNote(null);
    setStartingNew(fresh);
    setName(fresh || !p ? "" : p.name);
    setPeriodStart(fresh || !p ? "" : p.periodStart ?? "");
    setPeriodEnd(fresh || !p ? "" : p.periodEnd ?? "");
    setContract(fresh || !p ? "" : p.contractNumber ?? "");
    setTract(fresh || !p ? "" : p.tractNumber ?? "");
    setFields(fresh || !p ? "" : p.fieldIds ?? "");
    setGoals(fresh || !p ? "" : p.longTermGoals ?? "");
    setObjectives(fresh || !p ? "" : p.immediateObjectives ?? "");
    setBenchmark(fresh || !p || p.benchmarkStockingRateAumPerAcre === null ? "" : String(p.benchmarkStockingRateAumPerAcre));
    setCadenceKind(fresh || !p ? "every_rotation" : p.monitoringCadenceKind);
    setCadenceValue(fresh || !p || p.monitoringCadenceValue === null ? "" : String(p.monitoringCadenceValue));
    setDmi(fresh || !p || p.defaultDmiPctBw === null ? "" : String(p.defaultDmiPctBw));
    setSwardLb(fresh || !p || p.lbDmPerAcreInch === null ? "" : String(p.lbDmPerAcreInch));
    setGrazeTo(fresh || !p || p.targetResidualHeightIn === null ? "" : String(p.targetResidualHeightIn));
    setEditing(true);
  };

  const act = async (what: () => Promise<string | null>) => {
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

  const savePlanNow = () =>
    act(async () => {
      const existing = load.state === "ok" ? load.active : null;
      await savePlan(farmId!, {
        planId: startingNew || existing === null ? null : existing.id,
        name,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        contractNumber: contract, tractNumber: tract, fieldIds: fields,
        longTermGoals: goals, immediateObjectives: objectives,
        benchmarkStockingRateAumPerAcre: num(benchmark),
        monitoringCadenceKind: cadenceKind,
        monitoringCadenceValue: num(cadenceValue),
        defaultDmiPctBw: num(dmi),
        lbDmPerAcreInch: num(swardLb),
        targetResidualHeightIn: num(grazeTo),
      });
      setEditing(false);
      return startingNew
        ? "New plan in force. The one before it stands, and stays readable."
        : "Plan saved.";
    });

  const openTarget = (paddockId: string) => {
    const t = load.state === "ok" ? load.targets.find((x) => x.paddockId === paddockId) : undefined;
    setEditTarget(paddockId);
    setTEntry(t?.targetEntryHeightIn === null || t === undefined ? "" : String(t.targetEntryHeightIn));
    setTResidual(t?.targetResidualHeightIn === null || t === undefined ? "" : String(t.targetResidualHeightIn));
    setTGrowing(t?.minRecoveryDaysGrowing === null || t === undefined ? "" : String(t.minRecoveryDaysGrowing));
    setTDormant(t?.minRecoveryDaysDormant === null || t === undefined ? "" : String(t.minRecoveryDaysDormant));
    setTUtil(t?.targetUtilizationPct === null || t === undefined ? "" : String(t.targetUtilizationPct));
  };

  const saveTarget = (planId: string, paddockId: string) =>
    act(async () => {
      await savePaddockTarget(farmId!, {
        planId, paddockId,
        targetEntryHeightIn: num(tEntry),
        targetResidualHeightIn: num(tResidual),
        minRecoveryDaysGrowing: num(tGrowing),
        minRecoveryDaysDormant: num(tDormant),
        targetUtilizationPct: num(tUtil),
        plannedGrazingNotes: "", plannedDefermentNotes: "",
        sensitiveAreaStrategy: "", notes: "",
      });
      setEditTarget(null);
      return "Target saved.";
    });

  const active = load.state === "ok" ? load.active : null;

  return (
    <OpsShell>
      <PageHeader
        eyebrow={active ? (active.periodStart ? `${active.periodStart} → ${active.periodEnd ?? "…"}` : "in force") : "Herd"}
        title={active ? active.name : "Grazing plan"}
        actions={
          <>
            <Link to="/grazing" className="rot-back mono">← the board</Link>
            {active && (
              <Button onClick={() => (editing && startingNew ? setEditing(false) : openEdit(true))}>
                {editing && startingNew ? "Cancel" : "Start a new plan"}
              </Button>
            )}
            <Button
              variant="filled"
              onClick={() => (editing && !startingNew ? setEditing(false) : openEdit(false))}
              disabled={load.state !== "ok"}
            >
              {editing && !startingNew ? "Cancel" : active ? "Edit" : "Write a plan"}
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

      {load.state === "ok" && (
        <>
          {editing && (
            <div className="grz-form">
              {startingNew && (
                <p className="grz-warn">
                  Starting a new plan stands the current one down. Nothing is lost — its targets,
                  concerns and decisions stay exactly where they are and stay readable.
                </p>
              )}
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" placeholder="2026 season" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">From</span>
                  <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="From" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">To</span>
                  <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="To" />
                </label>
              </div>

              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Contract no.</span>
                  <input value={contract} onChange={(e) => setContract(e.target.value)} aria-label="Contract no." />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Tract no.</span>
                  <input value={tract} onChange={(e) => setTract(e.target.value)} aria-label="Tract no." />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Field IDs</span>
                  <input value={fields} onChange={(e) => setFields(e.target.value)} aria-label="Field IDs" />
                </label>
              </div>

              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Long-term goals</span>
                  <input value={goals} onChange={(e) => setGoals(e.target.value)} aria-label="Long-term goals" />
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Immediate objectives</span>
                  <input value={objectives} onChange={(e) => setObjectives(e.target.value)} aria-label="Immediate objectives" />
                </label>
              </div>

              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Monitor</span>
                  <select value={cadenceKind} onChange={(e) => setCadenceKind(e.target.value as MonitoringCadenceKind)} aria-label="Monitor">
                    {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
                <label className="grz-field">
                  <span className="eyebrow">How many</span>
                  <input value={cadenceValue} onChange={(e) => setCadenceValue(e.target.value)} inputMode="numeric" aria-label="How many" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Intake, % of bw</span>
                  <input value={dmi} onChange={(e) => setDmi(e.target.value)} inputMode="decimal" aria-label="Intake, % of bw" />
                </label>
                <label className="grz-field">
                  {/* What turns this morning's height reading into forage. It
                      varies with sward, season and density, so it is the
                      farm's to set and never this app's. */}
                  <span className="eyebrow">lb DM per acre-inch</span>
                  <input value={swardLb} onChange={(e) => setSwardLb(e.target.value)} inputMode="decimal" aria-label="lb DM per acre-inch" />
                </label>
                <label className="grz-field">
                  {/* The graze-down. With a height reading it stands in for
                      the utilization percentage rather than compounding with
                      it — utilization becomes what these two heights work out
                      to, which is the way round a grazier thinks about it. A
                      paddock's own target below overrides this. */}
                  <span className="eyebrow">Graze down to, in</span>
                  <input value={grazeTo} onChange={(e) => setGrazeTo(e.target.value)} inputMode="decimal" aria-label="Graze down to, in" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Benchmark AUM/acre</span>
                  <input value={benchmark} onChange={(e) => setBenchmark(e.target.value)} inputMode="decimal" aria-label="Benchmark AUM/acre" />
                </label>
              </div>

              <div className="grz-form__actions">
                <Button variant="filled" disabled={busy || name.trim() === ""} onClick={savePlanNow}>
                  {busy ? "Saving…" : startingNew ? "Put it in force" : "Save"}
                </Button>
              </div>
            </div>
          )}

          {active === null && !editing && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                No plan yet. This is where the numbers the rest of the module compares against live —
                how long each paddock should rest, what residual to leave, how often to monitor, what
                a cow eats. Until they are written down, every other screen says "no target" rather
                than making one up.
              </Callout>
            </div>
          )}

          {active !== null && (
            <>
              {(active.longTermGoals || active.immediateObjectives) && (
                <>
                  <h2 className="pm-h2 serif">Goals</h2>
                  {active.longTermGoals && <p className="mon-desc"><strong>Long term.</strong> {active.longTermGoals}</p>}
                  {active.immediateObjectives && <p className="mon-desc"><strong>Right now.</strong> {active.immediateObjectives}</p>}
                </>
              )}

              <h2 className="pm-h2 serif">Targets by paddock</h2>
              <p className="grz-optional">
                Recovery is two figures, never one — thirty days in June and thirty in September are
                not the same rest, and a single number is the assumption that gets paddocks hurt.
              </p>

              <GridRow cols={TCOLS} mobileCols={TCOLS_SM} as="header">
                <span>Paddock</span>
                <span className="text-right hide-sm">Entry</span>
                <span className="text-right hide-sm">Residual</span>
                <span className="text-right">Growing</span>
                <span className="text-right hide-sm">Dormant</span>
              </GridRow>

              {load.paddocks.filter((p) => p.active).map((p) => {
                const t = load.targets.find((x) => x.paddockId === p.id);
                return editTarget === p.id ? (
                  <div key={p.id} className="grz-form" style={{ margin: "8px 0" }}>
                    <p className="eyebrow" style={{ marginBottom: 10 }}>{p.name}</p>
                    <div className="grz-form__row">
                      <label className="grz-field">
                        <span className="eyebrow">Entry height, in</span>
                        <input value={tEntry} onChange={(e) => setTEntry(e.target.value)} inputMode="decimal" aria-label="Entry height, in" />
                      </label>
                      <label className="grz-field">
                        <span className="eyebrow">Residual, in</span>
                        <input value={tResidual} onChange={(e) => setTResidual(e.target.value)} inputMode="decimal" aria-label="Residual, in" />
                      </label>
                      <label className="grz-field">
                        <span className="eyebrow">Recovery, growing</span>
                        <input value={tGrowing} onChange={(e) => setTGrowing(e.target.value)} inputMode="numeric" aria-label="Recovery, growing" />
                      </label>
                      <label className="grz-field">
                        <span className="eyebrow">Recovery, dormant</span>
                        <input value={tDormant} onChange={(e) => setTDormant(e.target.value)} inputMode="numeric" aria-label="Recovery, dormant" />
                      </label>
                      <label className="grz-field">
                        <span className="eyebrow">Utilization, %</span>
                        <input value={tUtil} onChange={(e) => setTUtil(e.target.value)} inputMode="decimal" aria-label="Utilization, %" />
                      </label>
                    </div>
                    <div className="grz-form__actions">
                      <Button disabled={busy} onClick={() => setEditTarget(null)}>Cancel</Button>
                      <Button variant="filled" disabled={busy} onClick={() => saveTarget(active.id, p.id)}>
                        {busy ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <GridRow key={p.id} cols={TCOLS} mobileCols={TCOLS_SM} as="body">
                    <span style={{ minWidth: 0 }}>
                      <button type="button" className="mon-link serif" style={{ fontSize: 17 }} onClick={() => openTarget(p.id)}>
                        {p.name}
                      </button>
                      <br />
                      <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
                        {t === undefined
                          ? "no targets set"
                          : [
                              t.targetUtilizationPct === null ? null : `${t.targetUtilizationPct}% utilization`,
                              `${(p.acresGrazable ?? 0).toFixed(2)} ac`,
                            ].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="mono text-right hide-sm fb-n">{t?.targetEntryHeightIn ?? "—"}</span>
                    <span className="mono text-right hide-sm fb-n">{t?.targetResidualHeightIn ?? "—"}</span>
                    <span className="mono text-right fb-n">{t?.minRecoveryDaysGrowing ?? "—"}</span>
                    <span className="mono text-right hide-sm fb-n">{t?.minRecoveryDaysDormant ?? "—"}</span>
                  </GridRow>
                );
              })}

              <h2 className="pm-h2 serif">Resource concerns</h2>
              {load.concerns.length === 0 && <p className="pm-unit__sub">None recorded.</p>}
              {load.concerns.map((c) => (
                <p key={c.id} className="pm-unit">
                  <Pill variant="outline">{c.category}</Pill> <strong>{c.concern}</strong>
                  {c.notes && <><br /><span className="pm-unit__sub">{c.notes}</span></>}
                </p>
              ))}
              <div className="grz-form__row" style={{ paddingTop: 12 }}>
                <label className="grz-field">
                  <span className="eyebrow">Category</span>
                  <select value={concernCategory} onChange={(e) => setConcernCategory(e.target.value as ResourceCategory)} aria-label="Category">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Concern</span>
                  <input value={concernText} onChange={(e) => setConcernText(e.target.value)} aria-label="Concern" />
                </label>
                <Button
                  disabled={busy || concernText.trim() === ""}
                  onClick={() =>
                    act(async () => {
                      await addResourceConcern(farmId!, active.id, concernCategory, concernText, "");
                      setConcernText("");
                      return "Concern added.";
                    })
                  }
                >
                  Add
                </Button>
              </div>

              <h2 className="pm-h2 serif">Contingency triggers</h2>
              <p className="grz-optional">
                What trips it, and what you do. A trigger with no threshold is a worry rather than a
                plan — "dry" is not something you can tell has happened.
              </p>
              {load.contingencies.length === 0 && <p className="pm-unit__sub">None recorded.</p>}
              {load.contingencies.map((c) => (
                <p key={c.id} className="pm-unit">
                  <strong>{TRIGGERS.find((t) => t.value === c.triggerType)?.label ?? c.triggerType}</strong>
                  {c.triggerThreshold === null && <> <Pill variant="outline-ochre">no threshold</Pill></>}
                  <br />
                  <span className="pm-unit__sub">
                    {[c.triggerThreshold, c.plannedResponse].filter(Boolean).join(" → ") || "Nothing said yet."}
                  </span>
                </p>
              ))}
              <div className="grz-form__row" style={{ paddingTop: 12 }}>
                <label className="grz-field">
                  <span className="eyebrow">Trigger</span>
                  <select value={trigger} onChange={(e) => setTrigger(e.target.value as ContingencyTrigger)} aria-label="Trigger">
                    {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">What trips it</span>
                  <input value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="What trips it" />
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">What you do</span>
                  <input value={response} onChange={(e) => setResponse(e.target.value)} aria-label="What you do" />
                </label>
                <Button
                  disabled={busy || threshold.trim() === ""}
                  onClick={() =>
                    act(async () => {
                      await addContingency(farmId!, {
                        planId: active.id, triggerType: trigger,
                        triggerThreshold: threshold, plannedResponse: response,
                        holdingAreaId: null, notes: "",
                      });
                      setThreshold("");
                      setResponse("");
                      return "Trigger added.";
                    })
                  }
                >
                  Add
                </Button>
              </div>

              {load.plans.filter((p) => !p.active).length > 0 && (
                <>
                  <h2 className="pm-h2 serif">Earlier plans</h2>
                  {load.plans.filter((p) => !p.active).map((p) => (
                    <p key={p.id} className="pm-unit">
                      <strong>{p.name}</strong>
                      <br />
                      <span className="pm-unit__sub">
                        {p.periodStart ?? "?"} → {p.periodEnd ?? "?"} · stood down, still on record
                      </span>
                    </p>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}
