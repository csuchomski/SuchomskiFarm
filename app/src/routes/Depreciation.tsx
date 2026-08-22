import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { EarTag, Button, StatTile, GridRow, Callout, SaveToast } from "../components/ui";
import { animalPath, fetchAnimals, type RealAnimal } from "../lib/herd";
import { fetchProductionRecords } from "../lib/milkings";
import { fetchLactations } from "../lib/lactations";
import { fetchCalvings } from "../lib/repro";
import { formatMoney } from "../lib/sires";
import {
  annualChargeCents,
  carryingValueCents,
  enteredProduction,
  fetchAssumptions,
  fetchValuations,
  isHerdInventory,
  latestValuations,
  markHerdValues,
  perCwtCents,
  saveAssumptions,
  trailingYieldLb,
  type Assumptions,
  type Valuation,
} from "../lib/depreciation";
import { useWorkspace } from "../lib/workspace";
import "./depreciation.css";

/**
 * Economic herd depreciation.
 *
 * The largest cost of production nobody books. This page exists to book it:
 * what each cow costs per year simply by wearing out, what that is per
 * hundredweight of her milk, and what the herd is carried at.
 *
 * It is not the 4562. Nothing here computes tax depreciation, and the note at
 * the foot of the page says so — the two answer different questions and a
 * page that blurred them would be worse than either.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      animals: RealAnimal[];
      assumptions: Assumptions;
      valuations: Valuation[];
      freshByAnimal: Map<string, string[]>;
      calvingsByAnimal: Map<string, string[]>;
      milkByAnimal: Map<string, { produced_date: string; quantity: number; unit: string }[]>;
    };

const COLS = "60px minmax(0, 1fr) 110px 110px 110px";
const COLS_SM = "44px minmax(0, 1fr) 100px";

const today = () => new Date().toISOString().slice(0, 10);

export default function Depreciation() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ replacement: "", cull: "", lifetime: "", yield: "", lbPerGallon: "" });

  const asOf = today();

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [animals, assumptions, valuations, lactations, calvings, production] = await Promise.all([
      fetchAnimals(),
      fetchAssumptions(farmId),
      fetchValuations(farmId),
      fetchLactations(farmId),
      fetchCalvings(farmId),
      fetchProductionRecords(farmId),
    ]);

    const freshByAnimal = new Map<string, string[]>();
    for (const l of lactations) push(freshByAnimal, l.animal_id, l.fresh_date);

    const calvingsByAnimal = new Map<string, string[]>();
    for (const c of calvings) push(calvingsByAnimal, c.dam_id, c.date);

    const milkByAnimal = new Map<string, { produced_date: string; quantity: number; unit: string }[]>();
    for (const r of production) {
      if (!r.animal_id) continue;
      const held = milkByAnimal.get(r.animal_id);
      const row = { produced_date: r.produced_date, quantity: Number(r.quantity), unit: r.unit };
      if (held) held.push(row);
      else milkByAnimal.set(r.animal_id, [row]);
    }

    setLoad({ state: "ok", animals, assumptions, valuations, freshByAnimal, calvingsByAnimal, milkByAnimal });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const rows = useMemo(() => {
    if (load.state !== "ok") return [];
    const { animals, assumptions, valuations, freshByAnimal, calvingsByAnimal, milkByAnimal } = load;
    const latest = latestValuations(valuations, asOf);
    const annual = annualChargeCents(assumptions);

    return animals
      .filter(isHerdInventory)
      .map((animal) => {
        const started = enteredProduction(
          freshByAnimal.get(animal.id) ?? [],
          calvingsByAnimal.get(animal.id) ?? [],
          asOf,
        );
        const hers = trailingYieldLb(milkByAnimal.get(animal.id) ?? [], asOf, assumptions.milkLbPerGallon);
        return {
          animal,
          started,
          carrying: carryingValueCents(assumptions, started, asOf),
          marked: latest.get(animal.id) ?? null,
          // Her own milk where there is enough of it, the farm's expectation
          // where there isn't — and the row says which.
          perCwt: perCwtCents(annual, hers?.lb ?? assumptions.expectedAnnualYieldLb),
          fromHerOwnMilk: hers !== null,
        };
      })
      .sort((a, b) => nameOf(a.animal).localeCompare(nameOf(b.animal)));
  }, [load, asOf]);

  const assumptions = load.state === "ok" ? load.assumptions : null;
  const annual = assumptions ? annualChargeCents(assumptions) : null;
  const herdChargeCents = annual === null ? null : annual * rows.length;
  const carriedCents = rows.reduce((sum, r) => sum + (r.marked?.valueCents ?? 0), 0);
  const markedCount = rows.filter((r) => r.marked !== null).length;

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

  const openEditor = () => {
    if (!assumptions) return;
    setDraft({
      replacement: (assumptions.replacementCents / 100).toFixed(2),
      cull: (assumptions.cullCents / 100).toFixed(2),
      lifetime: String(assumptions.lifetimeLactations),
      yield: String(assumptions.expectedAnnualYieldLb),
      lbPerGallon: String(assumptions.milkLbPerGallon),
    });
    setEditing(true);
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow="Herd"
        title="Depreciation"
        actions={
          <>
            <Button onClick={openEditor} disabled={load.state !== "ok" || editing}>
              Assumptions
            </Button>
            <Button
              variant="filled"
              disabled={busy || load.state !== "ok" || !farmId || annual === null}
              onClick={() =>
                act(async () => {
                  const n = await markHerdValues(farmId!, asOf);
                  return n === 0
                    ? "Nothing to mark — no cow on this model."
                    : `Marked ${n} ${n === 1 ? "cow" : "cows"} as of ${asOf}.`;
                })
              }
            >
              {busy ? "Working…" : "Mark values today"}
            </Button>
          </>
        }
      />

      {error && (
        <div style={{ paddingTop: 16 }}>
          <Callout tone="dashed">{error}</Callout>
        </div>
      )}
      <SaveToast note={note} onDone={() => setNote(null)} />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && assumptions && (
        <>
          <div className="dep-stats">
            <StatTile
              value={annual === null ? "—" : formatMoney(Math.round(annual))}
              label="Per cow, per year"
            />
            <StatTile
              value={
                annual === null ? "—" : `${formatMoney(Math.round(perCwtCents(annual, assumptions.expectedAnnualYieldLb) ?? 0))}`
              }
              label={`Per cwt at ${assumptions.expectedAnnualYieldLb.toLocaleString()} lb`}
            />
            <StatTile
              value={herdChargeCents === null ? "—" : formatMoney(Math.round(herdChargeCents))}
              label={`The ${rows.length}-cow string, per year`}
            />
            <StatTile
              value={markedCount === 0 ? "—" : formatMoney(carriedCents)}
              label={markedCount === 0 ? "Not marked yet" : `Carried, ${markedCount} marked`}
            />
          </div>

          <p className="dep-formula mono">
            ({formatMoney(assumptions.replacementCents)} replacement − {formatMoney(assumptions.cullCents)} cull) ÷{" "}
            {assumptions.lifetimeLactations} lactations
          </p>

          {editing && (
            <div className="dep-editor">
              <div className="dep-editor__grid">
                <Field
                  label="Replacement cost of a springing heifer"
                  value={draft.replacement}
                  onChange={(v) => setDraft((d) => ({ ...d, replacement: v }))}
                  prefix="$"
                />
                <Field
                  label="Cull value"
                  value={draft.cull}
                  onChange={(v) => setDraft((d) => ({ ...d, cull: v }))}
                  prefix="$"
                />
                <Field
                  label="Productive lifetime, lactations"
                  value={draft.lifetime}
                  onChange={(v) => setDraft((d) => ({ ...d, lifetime: v }))}
                />
                <Field
                  label="Expected yield, lb per year"
                  value={draft.yield}
                  onChange={(v) => setDraft((d) => ({ ...d, yield: v }))}
                />
                <Field
                  label="Milk, lb per gallon"
                  value={draft.lbPerGallon}
                  onChange={(v) => setDraft((d) => ({ ...d, lbPerGallon: v }))}
                />
              </div>
              <div className="dep-editor__actions">
                <Button onClick={() => setEditing(false)}>Cancel</Button>
                <Button
                  variant="filled"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const next: Assumptions = {
                        replacementCents: Math.round(Number(draft.replacement) * 100),
                        cullCents: Math.round(Number(draft.cull) * 100),
                        lifetimeLactations: Number(draft.lifetime),
                        expectedAnnualYieldLb: Number(draft.yield),
                        milkLbPerGallon: Number(draft.lbPerGallon),
                      };
                      const problem = validate(next);
                      if (problem) throw new Error(problem);
                      await saveAssumptions(farmId!, next);
                      setEditing(false);
                      return "Assumptions saved. Mark values again to roll the herd on the new figures.";
                    })
                  }
                >
                  Save
                </Button>
              </div>
              <p className="dep-note">
                A lactation is taken as a year — that is the convention the arithmetic already carries. The
                expected yield is only used for a cow with too little milk recorded to divide by; where she has
                a year of her own, her row uses it.
              </p>
            </div>
          )}

          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>Tag</span>
            <span>Cow</span>
            <span className="text-right">Per cwt</span>
            <span className="text-right hide-sm">Carrying</span>
            <span className="text-right hide-sm">Marked</span>
          </GridRow>

          {rows.map((r) => (
            <GridRow key={r.animal.id} cols={COLS} mobileCols={COLS_SM} as="body">
              <EarTag tag={r.animal.ear_tag} accent="herd" />
              <span style={{ minWidth: 0 }}>
                <Link to={animalPath(r.animal)} className="serif" style={{ fontSize: 17 }}>
                  {nameOf(r.animal)}
                </Link>
                <br />
                <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>
                  {r.started === null
                    ? "not yet in the string — carried at replacement cost"
                    : `in production since ${shortDate(r.started)}`}
                </span>
              </span>
              <span className="text-right" style={{ minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 15 }}>
                  {r.perCwt === null ? "—" : formatMoney(Math.round(r.perCwt))}
                </span>
                <br />
                <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                  {r.fromHerOwnMilk ? "her milk" : "herd figure"}
                </span>
              </span>
              <span className="mono text-right hide-sm" style={{ fontSize: 15 }}>
                {r.carrying === null ? "—" : formatMoney(Math.round(r.carrying))}
              </span>
              <span className="text-right hide-sm" style={{ minWidth: 0 }}>
                {r.marked === null ? (
                  <span className="mono" style={{ fontSize: 13, color: "var(--ink-faint)" }}>
                    not marked
                  </span>
                ) : (
                  <>
                    <span className="mono" style={{ fontSize: 15 }}>
                      {formatMoney(r.marked.valueCents)}
                    </span>
                    <br />
                    <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                      {r.marked.basis === "marked" ? shortDate(r.marked.asOf) : `${r.marked.basis} · ${shortDate(r.marked.asOf)}`}
                    </span>
                  </>
                )}
              </span>
            </GridRow>
          ))}

          {rows.length === 0 && (
            <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>
              No cow on this model yet. It covers the dairy string — females past calf age, still here.
            </p>
          )}

          <div className="dep-footnotes">
            <p>
              <strong>Beef cows are not on this page.</strong> Every figure above is a dairy figure — a springing
              heifer, a cull cow, a lifetime in lactations — so marking a beef cow with them would be inventing a
              number rather than measuring one. She can still be given a value by hand.
            </p>
            <p>
              <strong>This is not tax depreciation.</strong> Depreciation only exists where there is basis, and a
              heifer raised on a cash-basis Schedule F has none. Purchased animals go on the 4562 under 5-year
              MACRS, placed in service when she enters the milking string, with §1245 recapture at culling — none
              of which is computed here. <Link to="/books/taxes">Books → Taxes</Link> takes that figure from
              whoever files for you.
            </p>
          </div>
        </>
      )}
    </OpsShell>
  );
}

/** What the farm can't be allowed to save, with the reason rather than a
 * silent refusal. Mirrors the checks in `herd.mark_herd_values`. */
export function validate(a: Assumptions): string | null {
  if (!Number.isFinite(a.replacementCents) || a.replacementCents <= 0) return "Replacement cost has to be a figure above zero.";
  if (!Number.isFinite(a.cullCents) || a.cullCents < 0) return "Cull value has to be zero or more.";
  if (a.cullCents > a.replacementCents) return "Cull value is above replacement cost, which would depreciate her upwards.";
  if (!Number.isFinite(a.lifetimeLactations) || a.lifetimeLactations <= 0) return "A productive lifetime of zero gives nothing to divide by.";
  if (!Number.isFinite(a.expectedAnnualYieldLb) || a.expectedAnnualYieldLb <= 0) return "Expected yield has to be above zero to give a figure per hundredweight.";
  if (!Number.isFinite(a.milkLbPerGallon) || a.milkLbPerGallon <= 0) return "Pounds per gallon has to be above zero.";
  return null;
}

function Field({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <label className="dep-field">
      <span className="eyebrow">{label}</span>
      <span className="dep-field__input">
        {prefix && <span className="mono dep-field__prefix">{prefix}</span>}
        <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" aria-label={label} />
      </span>
    </label>
  );
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const held = map.get(key);
  if (held) held.push(value);
  else map.set(key, [value]);
}

function nameOf(a: RealAnimal) {
  return a.barn_name ?? `Tag ${a.ear_tag}`;
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
