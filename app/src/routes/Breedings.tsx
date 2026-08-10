import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import { fetchSemenLots, type SemenLot } from "../lib/sires";
import {
  countServices,
  fetchBreedingCosts,
  fetchBreedings,
  isActive,
  METHODS,
  recordBreeding,
  sireLabel,
  validateBreeding,
  voidBreeding,
  type Breeding,
  type BreedingDraft,
  type BreedingMethod,
} from "../lib/breedings";
import {
  CHECK_METHODS,
  CHECK_RESULTS,
  daysBetween,
  dueDate,
  fetchGestationDays,
  fetchPregnancyChecks,
  latestCheck,
  recordCheck,
  validateCheck,
  type PregnancyCheck,
} from "../lib/repro";
import {
  fetchBreeds,
  fetchComposition,
  fetchOverrides,
  gestationFor,
  type GestationInputs,
} from "../lib/gestation";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";
import "./breedings.css";

/**
 * Logging a breeding.
 *
 * Everything the form collects is written by one database function, because
 * an AI service is four changes that have to land together — the event, the
 * straw off the ledger, the cost against the cow, and the link between them.
 * See lib/breedings.ts.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      breedings: Breeding[];
      animals: RealAnimal[];
      lots: SemenLot[];
      costs: Map<string, number>;
      checks: PregnancyCheck[];
      gestation: GestationInputs;
    };

const COLS = "110px 1fr 150px 150px 100px 100px";
const COLS_SM = "92px 1fr 96px";

const emptyDraft = (): BreedingDraft => ({
  animalId: "",
  date: todayIso(),
  method: "ai",
  sireId: "",
  semenLotId: "",
  technician: "",
  notes: "",
  cost: "",
});

export default function Breedings() {
  const { business, farmId } = useWorkspace();

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<BreedingDraft>(emptyDraft);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // Checking whether a service took. Opened per breeding, because that's
  // what the check attaches itself to.
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkDate, setCheckDate] = useState(todayIso);
  const [checkMethod, setCheckMethod] = useState<string>("palpation");
  const [checkResult, setCheckResult] = useState<string>("pregnant");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({
        state: "ok",
        breedings: [],
        animals: [],
        lots: [],
        costs: new Map(),
        checks: [],
        gestation: EMPTY_GESTATION,
      });
      return;
    }
    const [breedings, animals, lots, costs, checks, gestation] = await Promise.all([
      fetchBreedings(farmId),
      fetchAnimals(),
      fetchSemenLots(farmId),
      fetchBreedingCosts(farmId),
      fetchPregnancyChecks(farmId),
      // Her breeds decide her gestation; the species settings are only the
      // fallback for an animal with no composition on file. A failure here
      // costs the due-date column and nothing else.
      loadGestation(farmId).catch(() => EMPTY_GESTATION),
    ]);
    setLoad({ state: "ok", breedings, animals, lots, costs, checks, gestation });
  }, [farmId]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    refresh().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const breedings = load.state === "ok" ? load.breedings : EMPTY_BREEDINGS;
  const animals = load.state === "ok" ? load.animals : EMPTY_ANIMALS;
  const lots = load.state === "ok" ? load.lots : EMPTY_LOTS;
  const costs = load.state === "ok" ? load.costs : EMPTY_COSTS;
  const checks = load.state === "ok" ? load.checks : EMPTY_CHECKS;
  const gestation = load.state === "ok" ? load.gestation : EMPTY_GESTATION;

  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const name = (id: string | null | undefined) => {
    if (!id) return undefined;
    const a = byId.get(id);
    return a ? a.barn_name?.trim() || a.ear_tag : undefined;
  };

  // Only females can be bred, and only males can be a sire — the database
  // says so too, but a dropdown offering the wrong half is its own bug.
  const females = useMemo(
    () => animals.filter((a) => a.sex === "female" && a.status === "active"),
    [animals],
  );
  const bulls = useMemo(() => animals.filter((a) => a.sex === "male"), [animals]);
  const usableLots = useMemo(() => lots.filter((l) => l.active && l.straws_remaining > 0), [lots]);

  const chosenLot = usableLots.find((l) => l.id === draft.semenLotId) ?? null;
  const problem = adding ? validateBreeding(draft, chosenLot?.straws_remaining) : null;

  const standing = breedings.filter(isActive);
  const strawsLeft = lots.reduce((s, l) => s + (l.active ? l.straws_remaining : 0), 0);
  const spent = [...costs.values()].reduce((s, n) => s + n, 0);

  const act = async (what: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      await refresh();
      setNote(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OpsShell searchPlaceholder="A cow, a bull…">
      <PageHeader
        eyebrow={business ? `${business.name} · herd` : "Herd"}
        title="Breedings"
        actions={
          <Button
            variant="filled"
            disabled={load.state !== "ok" || !farmId}
            onClick={() => {
              setAdding((v) => !v);
              setDraft(emptyDraft());
              setError(null);
              setNote(null);
            }}
          >
            {adding ? "Cancel" : "Log a breeding"}
          </Button>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load breedings: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={standing.length || "—"} label="Breedings logged" />
            <StatTile value={strawsLeft || "—"} label="Straws in the tank" />
            <StatTile value={spent ? money(spent) : "—"} label="Breeding cost" />
            <StatTile value={usableLots.length || "—"} label="Lots available" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {adding && (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                What happened
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Cow or heifer</div>
                  <select
                    className="order-select"
                    value={draft.animalId}
                    aria-label="Cow or heifer"
                    onChange={(e) => setDraft((d) => ({ ...d, animalId: e.target.value }))}
                  >
                    <option value="">Pick one…</option>
                    {females.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.barn_name?.trim() || a.ear_tag} · {a.class}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Date</div>
                  <input
                    className="order-select"
                    type="date"
                    value={draft.date}
                    aria-label="Date"
                    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Bred by</div>
                  <select
                    className="order-select"
                    value={draft.method}
                    aria-label="Method"
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, method: e.target.value as BreedingMethod, sireId: "", semenLotId: "" }))
                    }
                  >
                    {METHODS.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>

                {draft.method === "ai" ? (
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Straw</div>
                    <select
                      className="order-select"
                      value={draft.semenLotId}
                      aria-label="Straw"
                      onChange={(e) => setDraft((d) => ({ ...d, semenLotId: e.target.value }))}
                    >
                      <option value="">Pick a lot…</option>
                      {usableLots.map((l) => (
                        <option key={l.id} value={l.id}>
                          {name(l.sire_id) ?? "Unknown bull"}
                          {l.naab_code.trim() && ` · ${l.naab_code}`} — {l.straws_remaining} left
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Bull</div>
                    <select
                      className="order-select"
                      value={draft.sireId}
                      aria-label="Bull"
                      onChange={(e) => setDraft((d) => ({ ...d, sireId: e.target.value }))}
                    >
                      <option value="">Pick a bull…</option>
                      {bulls.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.barn_name?.trim() || a.ear_tag}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Technician</div>
                  <input
                    className="order-select"
                    value={draft.technician}
                    aria-label="Technician"
                    onChange={(e) => setDraft((d) => ({ ...d, technician: e.target.value }))}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Cost</div>
                  <input
                    className="order-select"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder={
                      chosenLot ? (chosenLot.cost_per_straw_cents / 100).toFixed(2) : draft.method === "ai" ? "" : "0.00"
                    }
                    value={draft.cost}
                    aria-label="Cost"
                    onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
                  />
                </label>
              </div>

              <label style={{ fontSize: 13, display: "block", marginTop: 12 }}>
                <div className="eyebrow">Notes</div>
                <input
                  className="order-select"
                  style={{ width: "100%" }}
                  value={draft.notes}
                  aria-label="Notes"
                  onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                />
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button
                  variant="filled"
                  size="sm"
                  disabled={busy || problem !== null}
                  onClick={() =>
                    void act(async () => {
                      await recordBreeding(draft);
                      setAdding(false);
                    }, draft.method === "ai" ? "Logged, and the straw is out of the tank." : "Logged.")
                  }
                >
                  {busy ? "Saving…" : "Log it"}
                </Button>
                <span style={{ fontSize: 13, color: problem ? "var(--red)" : "var(--ink-muted)" }}>
                  {problem ?? METHODS.find((m) => m.code === draft.method)?.hint}
                </span>
              </div>

              {draft.method === "ai" && chosenLot && (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                  {chosenLot.straws_remaining} straw{chosenLot.straws_remaining === 1 ? "" : "s"} in that lot now;{" "}
                  {chosenLot.straws_remaining - 1} after this. Leave the cost blank to use the lot's{" "}
                  {money(chosenLot.cost_per_straw_cents / 100)} a straw.
                </p>
              )}
            </div>
          )}

          <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
            Recorded
          </div>

          {breedings.length === 0 ? (
            <Callout>
              Nothing logged yet. Straws are added and counted on <Link to="/sires">Sires</Link>; logging a breeding
              here is what takes one out of the tank.
            </Callout>
          ) : (
            <>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Date</span>
                <span>Cow · bull</span>
                <span className="hide-sm">Checked</span>
                <span className="hide-sm">Due</span>
                <span className="text-right">Cost</span>
                <span className="text-right hide-sm">Actions</span>
              </GridRow>

              {breedings.map((b) => {
                const cost = costs.get(b.id);
                const check = latestCheck(checks, b.id);
                const dam = byId.get(b.animal_id);
                const carried = dam ? gestationFor(dam, gestation) : null;
                const due = dam ? dueDate(b.date, carried?.days) : null;
                // Once she's confirmed open or aborted there is nothing left
                // to be due, and a date sitting there would be a lie.
                const stillCarrying = !b.voided && check?.result !== "open" && check?.result !== "aborted";
                return (
                  <div key={b.id}>
                    <GridRow cols={COLS} mobileCols={COLS_SM} as="body" highlight={b.voided}>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {b.date}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        {/* Her name opens her record, where the same services
                            are drawn as a timeline. This list answers "what
                            did we do lately"; that page answers "how is she
                            doing", and there was no way to get from one to
                            the other. */}
                        {dam ? (
                          <Link to={`/animals/${dam.ear_tag}`} className="serif" style={{ fontSize: 17 }}>
                            {name(b.animal_id) ?? "Unknown"}
                          </Link>
                        ) : (
                          <span className="serif" style={{ fontSize: 17 }}>
                            {name(b.animal_id) ?? "Unknown"}
                          </span>
                        )}
                        <br />
                        <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                          {sireLabel(b, name(b.sire_id))}
                          {b.technician.trim() && ` · ${b.technician}`}
                        </span>
                        {b.voided && (
                          <>
                            {" "}
                            <Pill variant="outline">voided</Pill>
                          </>
                        )}
                      </span>
                      <span className="hide-sm" style={{ fontSize: 13, minWidth: 0 }}>
                        {check ? (
                          <>
                            {/* Green for in calf, plain for everything else.
                                The one other colour a pill has is hazard
                                yellow, and tokens.css reserves that strictly
                                for withdrawal. */}
                            <Pill variant={check.result === "pregnant" ? "outline-green" : "outline"}>
                              {check.result}
                            </Pill>
                            <br />
                            <span className="mono" style={{ color: "var(--ink-muted)" }}>
                              {check.estimated_days_bred !== null
                                ? `${check.estimated_days_bred}d · ${check.method}`
                                : check.method}
                            </span>
                          </>
                        ) : (
                          <span style={{ color: "var(--ink-faint)" }}>not yet</span>
                        )}
                      </span>
                      <span className="mono hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {!stillCarrying || !due ? (
                          "—"
                        ) : (
                          <>
                            {due}
                            <br />
                            <span style={{ color: "var(--ink-faint)" }}>
                              {daysBetween(todayIso(), due) >= 0
                                ? `in ${daysBetween(todayIso(), due)}d`
                                : `${-daysBetween(todayIso(), due)}d ago`}
                              {carried && ` · ${carried.days}d ${carried.basis}`}
                            </span>
                          </>
                        )}
                      </span>
                      <span className="mono text-right">{cost === undefined ? "—" : money(cost)}</span>
                      <span className="text-right hide-sm" style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                        {!b.voided && (
                          <>
                            <button
                              type="button"
                              className="link-button mono"
                              onClick={() => {
                                setCheckingId(checkingId === b.id ? null : b.id);
                                setVoidingId(null);
                                setCheckDate(todayIso());
                                setCheckMethod("palpation");
                                setCheckResult("pregnant");
                                setError(null);
                              }}
                            >
                              check
                            </button>
                            <button
                              type="button"
                              className="link-button mono"
                              onClick={() => {
                                setVoidingId(voidingId === b.id ? null : b.id);
                                setCheckingId(null);
                                setVoidReason("");
                                setError(null);
                              }}
                            >
                              void
                            </button>
                          </>
                        )}
                      </span>
                    </GridRow>

                    {checkingId === b.id && (
                      <div className="breeding-void">
                        <div className="eyebrow" style={{ marginBottom: 8 }}>
                          Was she checked in calf?
                        </div>
                        <div className="breeding-check__row">
                          <label style={{ fontSize: 13 }}>
                            <div className="eyebrow">Date</div>
                            <input
                              className="order-select"
                              type="date"
                              value={checkDate}
                              aria-label="Check date"
                              onChange={(e) => setCheckDate(e.target.value)}
                            />
                          </label>
                          <label style={{ fontSize: 13 }}>
                            <div className="eyebrow">How</div>
                            <select
                              className="order-select"
                              value={checkMethod}
                              aria-label="Check method"
                              onChange={(e) => setCheckMethod(e.target.value)}
                            >
                              {CHECK_METHODS.map((m) => (
                                <option key={m.code} value={m.code}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ fontSize: 13 }}>
                            <div className="eyebrow">Result</div>
                            <select
                              className="order-select"
                              value={checkResult}
                              aria-label="Check result"
                              onChange={(e) => setCheckResult(e.target.value)}
                            >
                              {CHECK_RESULTS.map((r) => (
                                <option key={r.code} value={r.code}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <Button
                            variant="filled"
                            size="sm"
                            disabled={
                              busy ||
                              validateCheck({
                                animalId: b.animal_id,
                                date: checkDate,
                                method: checkMethod,
                                result: checkResult,
                                bredOn: b.date,
                              }) !== null
                            }
                            onClick={() =>
                              void act(async () => {
                                await recordCheck({
                                  animalId: b.animal_id,
                                  date: checkDate,
                                  method: checkMethod,
                                  result: checkResult,
                                  breedingEventId: b.id,
                                });
                                setCheckingId(null);
                              }, "Check recorded.")
                            }
                          >
                            {busy ? "Saving…" : "Record it"}
                          </Button>
                          <Button size="sm" onClick={() => setCheckingId(null)}>
                            Cancel
                          </Button>
                          <span style={{ fontSize: 13, color: "var(--red)" }}>
                            {validateCheck({
                              animalId: b.animal_id,
                              date: checkDate,
                              method: checkMethod,
                              result: checkResult,
                              bredOn: b.date,
                            })}
                          </span>
                        </div>
                        <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                          Bred {b.date} — that's {daysBetween(b.date, checkDate)} days.
                        </p>
                      </div>
                    )}

                    {voidingId === b.id && (
                      <div className="breeding-void">
                        <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                          {b.semen_lot_id
                            ? "The straw goes back into the tank and the cost comes off her. The breeding stays on the record, marked voided."
                            : "The breeding stays on the record, marked voided, and any cost comes off her."}
                        </p>
                        <div className="breeding-void__row">
                          <input
                            className="order-select"
                            placeholder="Why?"
                            value={voidReason}
                            aria-label={`Reason for voiding ${name(b.animal_id) ?? "this breeding"}`}
                            onChange={(e) => setVoidReason(e.target.value)}
                          />
                          <Button
                            variant="filled"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await voidBreeding(b.id, voidReason);
                                setVoidingId(null);
                              }, "Voided.")
                            }
                          >
                            {busy ? "Voiding…" : "Void it"}
                          </Button>
                          <Button size="sm" onClick={() => setVoidingId(null)}>
                            Keep it
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                A service number counts from her last calving, not from the beginning — she's on{" "}
                {females.length > 0
                  ? `${countServices(breedings, females[0].id)} for ${females[0].barn_name?.trim() || females[0].ear_tag}`
                  : "none yet"}
                . The cost of each AI service is booked against the cow, so it reaches her margin rather than sitting
                on the tank.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_BREEDINGS: Breeding[] = [];
const EMPTY_ANIMALS: RealAnimal[] = [];
const EMPTY_LOTS: SemenLot[] = [];
const EMPTY_COSTS = new Map<string, number>();
const EMPTY_CHECKS: PregnancyCheck[] = [];
const EMPTY_GESTATION: GestationInputs = { breeds: [], composition: [], overrides: [], bySpecies: {} };

/** The four small reads a due date needs, in one round trip's worth of
 * parallel. Kept here rather than in the lib so the lib stays pure enough to
 * test without a database. */
async function loadGestation(farmId: string): Promise<GestationInputs> {
  const [breeds, composition, overrides, bySpecies] = await Promise.all([
    fetchBreeds(farmId),
    fetchComposition(farmId),
    fetchOverrides(farmId),
    fetchGestationDays(),
  ]);
  return { breeds, composition, overrides, bySpecies };
}
