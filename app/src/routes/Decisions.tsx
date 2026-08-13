import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  fetchActivePlan,
  fetchContingencyPlans,
  fetchManagementDecisions,
  recordDecision,
  type ContingencyPlan,
  type GrazingPlan,
  type ManagementDecision,
} from "../lib/grazing";
import "./grazing.css";

/**
 * Herd → Decisions: what changed, why, and what came of it.
 *
 * This is the record most operations do not keep, and it is what Operation and
 * Maintenance is really asking for. A plan on file and a season of move logs
 * together still do not show *adaptive management* — they show what was
 * intended and what happened, with nothing joining the two. The join is
 * somebody noticing a thing and changing course because of it.
 *
 * The three fields are deliberately separate. **What you saw** is evidence,
 * **what tripped** is the reading of it, and **what you did** is the act.
 * Collapsed into one note they become a story written afterwards, which is
 * exactly what this is meant to replace.
 *
 * Follow-up is its own field for the same reason: a decision without an
 * outcome is a good intention, and the value of the log is in whether the
 * thing worked.
 *
 * Nothing here says "compliant".
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      decisions: ManagementDecision[];
      plan: GrazingPlan | null;
      contingencies: ContingencyPlan[];
    };

const today = () => new Date().toISOString().slice(0, 10);

export default function Decisions() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [decidedOn, setDecidedOn] = useState(today);
  const [observation, setObservation] = useState("");
  const [triggerText, setTriggerText] = useState("");
  const [decision, setDecision] = useState("");
  const [contingencyId, setContingencyId] = useState("");
  const [followup, setFollowup] = useState("");
  const [followedUpOn, setFollowedUpOn] = useState("");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [decisions, plan] = await Promise.all([
      fetchManagementDecisions(farmId),
      fetchActivePlan(farmId),
    ]);
    const contingencies = plan ? await fetchContingencyPlans(plan.id) : [];
    setLoad({ state: "ok", decisions, plan, contingencies });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const openSheet = () => {
    setError(null);
    setNote(null);
    setDecidedOn(today());
    setObservation("");
    setTriggerText("");
    setDecision("");
    setContingencyId("");
    setFollowup("");
    setFollowedUpOn("");
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await recordDecision(farmId!, {
        planId: load.state === "ok" ? load.plan?.id ?? null : null,
        decidedOn,
        observation,
        triggerDescription: triggerText,
        decision,
        contingencyPlanId: contingencyId === "" ? null : contingencyId,
        outcomeFollowup: followup,
        followedUpOn: followedUpOn || null,
      });
      setOpen(false);
      setNote("Recorded.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const labelFor = (id: string | null) => {
    if (id === null || load.state !== "ok") return null;
    const c = load.contingencies.find((x) => x.id === id);
    return c ? c.triggerType.replace(/_/g, " ") : null;
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          load.state === "ok"
            ? `${load.decisions.length} decision${load.decisions.length === 1 ? "" : "s"}`
            : "Herd"
        }
        title="Decisions"
        actions={
          <>
            <Link to="/grazing" className="rot-back mono">← the board</Link>
            <Button variant="filled" onClick={() => (open ? setOpen(false) : openSheet())} disabled={load.state !== "ok"}>
              {open ? "Cancel" : "Record a decision"}
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
          {open && (
            <div className="grz-form">
              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Decided on</span>
                  <input type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} aria-label="Decided on" />
                </label>
                {load.contingencies.length > 0 && (
                  <label className="grz-field grz-field--wide">
                    <span className="eyebrow">Against a trigger in the plan</span>
                    <select value={contingencyId} onChange={(e) => setContingencyId(e.target.value)} aria-label="Against a trigger in the plan">
                      <option value="">Not one of them</option>
                      {load.contingencies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.triggerType.replace(/_/g, " ")}
                          {c.triggerThreshold ? ` — ${c.triggerThreshold}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Kept apart on purpose: evidence, the reading of it, and the
                  act. One box would turn all three into a story written
                  afterwards, which is what this log exists to replace. */}
              <label className="grz-field grz-field--wide">
                <span className="eyebrow">What you saw</span>
                <input value={observation} onChange={(e) => setObservation(e.target.value)} aria-label="What you saw" />
              </label>
              <label className="grz-field grz-field--wide">
                <span className="eyebrow">What that meant</span>
                <input value={triggerText} onChange={(e) => setTriggerText(e.target.value)} aria-label="What that meant" />
              </label>
              <label className="grz-field grz-field--wide">
                <span className="eyebrow">What you did</span>
                <input value={decision} onChange={(e) => setDecision(e.target.value)} aria-label="What you did" />
              </label>

              <p className="grz-optional">
                Follow-up can wait — a decision without an outcome is a good intention, but the
                outcome usually is not known on the day.
              </p>
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">How it turned out</span>
                  <input value={followup} onChange={(e) => setFollowup(e.target.value)} aria-label="How it turned out" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Looked back on</span>
                  <input type="date" value={followedUpOn} onChange={(e) => setFollowedUpOn(e.target.value)} aria-label="Looked back on" />
                </label>
              </div>

              <div className="grz-form__actions">
                <Button variant="filled" disabled={busy || decision.trim() === ""} onClick={save}>
                  {busy ? "Saving…" : "Record it"}
                </Button>
              </div>
            </div>
          )}

          {load.decisions.length === 0 && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                Nothing recorded yet. This is the log of times you changed course — pulled the mob off
                early because the ground was wet, skipped a paddock, fed hay in July. A plan and a
                season of moves show what was intended and what happened; this is the bit that joins
                them, and it is what Operation and Maintenance is really asking for.
              </Callout>
            </div>
          )}

          {load.decisions.map((d) => (
            <section key={d.id} className="rot-round">
              <div className="rot-round__head">
                <span className="serif rot-round__n">{shortDate(d.decidedOn)}</span>
                {labelFor(d.contingencyPlanId) && (
                  <Pill variant="outline-ochre">{labelFor(d.contingencyPlanId)}</Pill>
                )}
                {d.followedUpOn === null && d.outcomeFollowup === null && (
                  <span className="mono rot-round__when">no follow-up yet</span>
                )}
              </div>
              {d.observation && <p className="dec-line"><span className="eyebrow">Saw</span> {d.observation}</p>}
              {d.triggerDescription && <p className="dec-line"><span className="eyebrow">Meant</span> {d.triggerDescription}</p>}
              {d.decision && <p className="dec-line dec-line--act"><span className="eyebrow">Did</span> {d.decision}</p>}
              {d.outcomeFollowup && (
                <p className="dec-line">
                  <span className="eyebrow">Turned out</span> {d.outcomeFollowup}
                  {d.followedUpOn && <span className="pm-unit__sub"> · {shortDate(d.followedUpOn)}</span>}
                </p>
              )}
            </section>
          ))}

          {load.plan === null && load.decisions.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <Callout>
                These are recorded against no plan, because none is in force. They stay on record
                either way — a decision is a thing that happened.
              </Callout>
            </div>
          )}
        </>
      )}
    </OpsShell>
  );
}

function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
