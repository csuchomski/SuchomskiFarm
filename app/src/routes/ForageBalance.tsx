import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  fetchActivePlan,
  fetchForageAvailability,
  fetchForageDemand,
  fetchForageRemovals,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchLatestWeights,
  fetchPaddocks,
  groupAvgWeightLb,
  groupHeadCount,
  recordAvailability,
  recordDemand,
  type AvailabilityBasis,
  type DemandKind,
  type ForageAvailability,
  type ForageDemand,
  type ForageRemoval,
  type GrazingGroup,
  type GrazingPlan,
  type Paddock,
} from "../lib/grazing";
import { daysOfFeed, forageBalance, gapInWords, periodDays, type BalanceLine } from "../lib/balance";
import "./grazing.css";

/**
 * Herd → Forage balance: what is there to eat, what is eating it, and the
 * difference.
 *
 * The 2025 revision names this as its own deliverable, and it is why there is
 * no single carrying-capacity figure anywhere in this module. A carrying
 * capacity is an answer with its workings thrown away; this keeps the workings
 * where they can be argued with.
 *
 * **Pounds and AUM are shown in separate columns and never netted across.**
 * Converting one to the other needs an assumption about what an animal unit
 * eats in a month. That assumption is the farm's to make, and an app that made
 * it quietly would be putting a number in a conservationist's hands that
 * nobody chose.
 *
 * Nothing here says "compliant".
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      paddocks: Paddock[];
      availability: ForageAvailability[];
      demand: ForageDemand[];
      removals: ForageRemoval[];
      groups: GrazingGroup[];
      plan: GrazingPlan | null;
      derived: { head: number | null; weight: number | null };
    };

const COLS = "minmax(0, 1fr) 92px 74px 92px 104px";
const COLS_SM = "minmax(0, 1fr) 104px";

const BASES: { value: AvailabilityBasis; label: string }[] = [
  { value: "clipping", label: "Clipping" },
  { value: "plate_meter", label: "Plate meter" },
  { value: "visual", label: "Visual estimate" },
  { value: "ecological_site", label: "Ecological site" },
  { value: "extension_table", label: "Extension table" },
  { value: "other", label: "Other" },
];

type Sheet = null | "supply" | "demand";

export default function ForageBalance() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [paddockId, setPaddockId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [label, setLabel] = useState("");
  const [perAcre, setPerAcre] = useState("");
  const [aum, setAum] = useState("");
  const [species, setSpecies] = useState("");
  const [quality, setQuality] = useState("");
  const [planned, setPlanned] = useState(false);
  const [basis, setBasis] = useState<AvailabilityBasis | "">("");

  const [kind, setKind] = useState<DemandKind>("livestock");
  const [head, setHead] = useState("");
  const [weight, setWeight] = useState("");
  const [dmi, setDmi] = useState("");
  const [statedLb, setStatedLb] = useState("");
  const [statedAum, setStatedAum] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, availability, demand, removals, groups, members, weights, plan] = await Promise.all([
      fetchPaddocks(farmId),
      fetchForageAvailability(farmId),
      fetchForageDemand(farmId),
      fetchForageRemovals(farmId),
      fetchGrazingGroups(farmId),
      fetchGroupMembers(farmId),
      fetchLatestWeights(farmId),
      fetchActivePlan(farmId),
    ]);
    const mob = groups[0] ?? null;
    setLoad({
      state: "ok", paddocks, availability, demand, removals, groups, plan,
      derived: {
        head: mob ? groupHeadCount(mob, members) : null,
        weight: mob ? groupAvgWeightLb(mob, members, weights) : null,
      },
    });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const planDmi = load.state === "ok" ? load.plan?.defaultDmiPctBw ?? null : null;

  const lines = useMemo(() => {
    if (load.state !== "ok") return [] as BalanceLine[];
    return forageBalance({
      paddocks: load.paddocks,
      availability: load.availability,
      demand: load.demand,
      removals: load.removals,
      planDefaultDmiPctBw: planDmi,
    });
  }, [load, planDmi]);

  /** Windows already on file, so a new row lands on one that will net rather
   * than creating a lonely line of its own. */
  const windows = useMemo(() => {
    const seen = new Map<string, { start: string; end: string; label: string | null }>();
    for (const line of lines) {
      seen.set(`${line.period.start}|${line.period.end}`, {
        start: line.period.start, end: line.period.end, label: line.period.label,
      });
    }
    return [...seen.values()];
  }, [lines]);

  const num = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };

  const openSheet = (which: Exclude<Sheet, null>) => {
    setError(null);
    setNote(null);
    setPaddockId("");
    const w = windows[windows.length - 1];
    setStart(w?.start ?? "");
    setEnd(w?.end ?? "");
    setLabel(w?.label ?? "");
    setPerAcre("");
    setAum("");
    setSpecies("");
    setQuality("");
    setPlanned(false);
    setBasis("");
    setKind("livestock");
    setHead(load.state === "ok" && load.derived.head !== null ? String(load.derived.head) : "");
    setWeight(
      load.state === "ok" && load.derived.weight !== null ? String(Math.round(load.derived.weight)) : "",
    );
    setDmi("");
    setStatedLb("");
    setStatedAum("");
    setNotes("");
    setSheet(which);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (sheet === "supply") {
        await recordAvailability(farmId!, {
          paddockId, periodStart: start, periodEnd: end, periodLabel: label,
          lbDmPerAcre: num(perAcre), aum: num(aum),
          speciesMix: species, qualityNote: quality,
          isPlanned: planned, basis: basis === "" ? null : basis, notes,
        });
        setNote("Standing forage recorded.");
      } else {
        await recordDemand(farmId!, {
          paddockId: paddockId === "" ? null : paddockId,
          groupId: kind === "livestock" ? (load.state === "ok" ? load.groups[0]?.id ?? null : null) : null,
          kind, periodStart: start, periodEnd: end, periodLabel: label,
          headCount: kind === "livestock" ? num(head) : null,
          animalClass: "",
          avgWeightLb: kind === "livestock" ? num(weight) : null,
          dmiPctBw: num(dmi),
          demandLbDm: num(statedLb), demandAum: num(statedAum),
          notes,
        });
        setNote("Demand recorded.");
      }
      setSheet(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    start !== "" && end !== "" && start <= end && (sheet === "demand" || paddockId !== "");

  return (
    <OpsShell>
      <PageHeader
        eyebrow={load.state === "ok" ? `${lines.length} line${lines.length === 1 ? "" : "s"}` : "Herd"}
        title="Forage balance"
        actions={
          <>
            <Link to="/grazing" className="rot-back mono">
              ← the board
            </Link>
            <Button onClick={() => (sheet === "supply" ? setSheet(null) : openSheet("supply"))} disabled={load.state !== "ok"}>
              {sheet === "supply" ? "Cancel" : "What's standing"}
            </Button>
            <Button variant="filled" onClick={() => (sheet === "demand" ? setSheet(null) : openSheet("demand"))} disabled={load.state !== "ok"}>
              {sheet === "demand" ? "Cancel" : "What's eating it"}
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
          {sheet !== null && (
            <div className="grz-form">
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">{sheet === "supply" ? "Which paddock" : "Which paddock"}</span>
                  <select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Which paddock">
                    {/* Demand may be against the whole farm — that is the
                        honest shape for a wildlife estimate. Supply cannot,
                        since it is per acre of a particular unit. */}
                    <option value="">{sheet === "demand" ? "The whole farm" : "Pick a paddock…"}</option>
                    {load.paddocks.filter((p) => p.active).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grz-field">
                  <span className="eyebrow">From</span>
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">To</span>
                  <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="To" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Call it</span>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Call it" placeholder="June" />
                </label>
              </div>

              {windows.length > 0 && (
                <div className="grz-wire__presets" style={{ paddingBottom: 10 }}>
                  {/* Rows net only within an exact window, so landing on one
                      that already exists is the difference between a balance
                      and two lonely halves. */}
                  {windows.slice(-4).map((w) => (
                    <button key={`${w.start}|${w.end}`} type="button" className="grz-preset"
                      onClick={() => { setStart(w.start); setEnd(w.end); setLabel(w.label ?? ""); }}>
                      {w.label ?? `${w.start} → ${w.end}`}
                    </button>
                  ))}
                </div>
              )}

              {sheet === "supply" ? (
                <>
                  <div className="grz-form__row">
                    <label className="grz-field">
                      <span className="eyebrow">lb DM per acre</span>
                      <input value={perAcre} onChange={(e) => setPerAcre(e.target.value)} inputMode="decimal" aria-label="lb DM per acre" />
                    </label>
                    <label className="grz-field">
                      <span className="eyebrow">or AUM</span>
                      <input value={aum} onChange={(e) => setAum(e.target.value)} inputMode="decimal" aria-label="or AUM" />
                    </label>
                    <label className="grz-field">
                      <span className="eyebrow">How it was got</span>
                      <select value={basis} onChange={(e) => setBasis(e.target.value as AvailabilityBasis | "")} aria-label="How it was got">
                        <option value="">—</option>
                        {BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="grz-form__row">
                    <label className="grz-field grz-field--wide">
                      <span className="eyebrow">Species</span>
                      <input value={species} onChange={(e) => setSpecies(e.target.value)} aria-label="Species" />
                    </label>
                    <label className="grz-field grz-field--wide">
                      <span className="eyebrow">Quality</span>
                      <input value={quality} onChange={(e) => setQuality(e.target.value)} aria-label="Quality" />
                    </label>
                  </div>
                  <label className="grz-check">
                    <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} aria-label="This is a projection" />
                    <span>
                      This is a projection, not something measured.{" "}
                      <span className="grz-optional" style={{ display: "inline" }}>
                        A projection shown as a measurement is the kind of thing a reviewer catches.
                      </span>
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <div className="grz-form__row">
                    <label className="grz-field">
                      <span className="eyebrow">What is eating</span>
                      <select value={kind} onChange={(e) => setKind(e.target.value as DemandKind)} aria-label="What is eating">
                        <option value="livestock">Livestock</option>
                        <option value="wildlife">Wildlife</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    {kind === "livestock" && (
                      <>
                        <label className="grz-field">
                          <span className="eyebrow">Head</span>
                          <input value={head} onChange={(e) => setHead(e.target.value)} inputMode="numeric" aria-label="Head" />
                        </label>
                        <label className="grz-field">
                          <span className="eyebrow">Avg weight, lb</span>
                          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" aria-label="Avg weight, lb" />
                        </label>
                      </>
                    )}
                    <label className="grz-field">
                      <span className="eyebrow">Intake, % of bw</span>
                      <input value={dmi} onChange={(e) => setDmi(e.target.value)} inputMode="decimal" aria-label="Intake, % of bw"
                        placeholder={planDmi === null ? "" : String(planDmi)} />
                    </label>
                  </div>
                  <p className="grz-optional">
                    Or state the demand outright — which is how a wildlife estimate is entered, since nobody
                    counts the deer and weighs them.
                  </p>
                  <div className="grz-form__row">
                    <label className="grz-field">
                      <span className="eyebrow">Demand, lb DM</span>
                      <input value={statedLb} onChange={(e) => setStatedLb(e.target.value)} inputMode="decimal" aria-label="Demand, lb DM" />
                    </label>
                    <label className="grz-field">
                      <span className="eyebrow">or AUM</span>
                      <input value={statedAum} onChange={(e) => setStatedAum(e.target.value)} inputMode="decimal" aria-label="or AUM" />
                    </label>
                  </div>
                </>
              )}

              <label className="grz-field grz-field--wide">
                <span className="eyebrow">Notes</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
              </label>

              <div className="grz-form__actions">
                <Button variant="filled" disabled={busy || !canSave} onClick={save}>
                  {busy ? "Saving…" : "Record it"}
                </Button>
              </div>
            </div>
          )}

          {lines.length === 0 && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                Nothing balanced yet. Record what is standing on a unit for a period, and what will be
                eating it over the same period, and the difference appears here. The two only net when
                they cover the <em>same</em> window — a June figure is not split across half-Junes,
                because that would assume growth is even through the month.
              </Callout>
            </div>
          )}

          {lines.length > 0 && (
            <>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Unit and period</span>
                <span className="text-right hide-sm">Standing</span>
                <span className="text-right hide-sm">Hay</span>
                <span className="text-right hide-sm">Eaten</span>
                <span className="text-right">Balance</span>
              </GridRow>

              {lines.map((line) => (
                <GridRow key={`${line.paddockId ?? "farm"}|${line.period.start}|${line.period.end}`}
                  cols={COLS} mobileCols={COLS_SM} as="body">
                  <span style={{ minWidth: 0 }}>
                    <span className="serif" style={{ fontSize: 17 }}>
                      {line.paddockName ?? "The whole farm"}
                    </span>
                    {line.availabilityRows.some((r) => r.isPlanned) && (
                      <> <Pill variant="outline">projected</Pill></>
                    )}
                    <br />
                    <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
                      {line.period.label ?? `${line.period.start} → ${line.period.end}`}
                      {" · "}
                      {periodDays(line.period.start, line.period.end)} days
                    </span>
                    {line.gap !== null && <span className="grz-warn fb-gap">{gapInWords(line.gap)}</span>}
                  </span>
                  <span className="mono text-right hide-sm fb-n">{lb(line.supplyLbDm) ?? aumOf(line.supplyAum)}</span>
                  <span className="mono text-right hide-sm fb-n">{lb(line.hayLbDm) ?? "—"}</span>
                  <span className="mono text-right hide-sm fb-n">{lb(line.demandLbDm) ?? aumOf(line.demandAum)}</span>
                  <span className="mono text-right fb-n">
                    {line.balanceLbDm !== null ? (
                      <span className={line.balanceLbDm < 0 ? "fb-short" : undefined}>
                        {line.balanceLbDm > 0 ? "+" : ""}
                        {Math.round(line.balanceLbDm).toLocaleString()}
                      </span>
                    ) : line.balanceAum !== null ? (
                      <span className={line.balanceAum < 0 ? "fb-short" : undefined}>
                        {line.balanceAum > 0 ? "+" : ""}
                        {line.balanceAum.toFixed(1)} AUM
                      </span>
                    ) : (
                      "—"
                    )}
                    {feedNote(line, planDmi)}
                  </span>
                </GridRow>
              ))}

              <p className="grz-optional" style={{ marginTop: 14 }}>
                Standing, hay and eaten are pounds of dry matter unless marked AUM. The two units are
                shown side by side and never netted across — converting between them needs a figure for
                what an animal unit eats in a month, and that is yours to choose rather than this app's
                to assume.
              </p>
            </>
          )}

          {load.plan === null && (
            <div style={{ marginTop: 18 }}>
              <Callout>
                No grazing plan is on file, so a demand row has to carry its own intake rate. A plan can
                hold one default for the farm.
              </Callout>
            </div>
          )}
        </>
      )}
    </OpsShell>
  );
}

function lb(v: number | null): string | null {
  return v === null ? null : Math.round(v).toLocaleString();
}

function aumOf(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)} AUM`;
}

/** A surplus in pounds means little; a surplus in days means something. */
function feedNote(line: BalanceLine, planDmi: number | null) {
  const days = daysOfFeed(line, planDmi);
  if (days === null) return null;
  return (
    <>
      <br />
      <span className="fb-days">{days < 1 ? "<1" : Math.round(days)} days' feed</span>
    </>
  );
}
