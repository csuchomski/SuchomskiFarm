import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import type { RealAnimal } from "../lib/herd";
import { fetchSemenLots, type SemenLot } from "../lib/sires";
import {
  countServices,
  fetchBreedingCosts,
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
  emptyCalf,
  latestCheck,
  recordCalving,
  recordCheck,
  validateCalving,
  validateCheck,
  type CalfDraft,
} from "../lib/repro";
import { gestationFor } from "../lib/gestation";
import { fetchLactations, type RealLactation } from "../lib/lactations";
import { fetchAlertInputs, timelineFor, type AlertInputs } from "../lib/alerts";
import { toSeasons, nextBreeding, type Season } from "../lib/repro-timeline";
import { ReproTimeline } from "../components/herd/ReproTimeline";
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
      repro: AlertInputs;
      lots: SemenLot[];
      costs: Map<string, number>;
      lactations: RealLactation[];
    };

/* Narrower than the flat list these rows came from: they now sit two levels
   in, and the indent is width the table used to have. Measured at 768, where
   the old tracks overflowed by 16px and squeezed the sire to nothing. */
const COLS = "100px minmax(0, 1fr) 130px 110px 84px 84px";
const COLS_SM = "84px minmax(0, 1fr) 76px";

/** Her name for a heading, falling back to the tag. */
const nameOfCow = (a: RealAnimal) => a.barn_name?.trim() || (a.ear_tag ? `Tag ${a.ear_tag}` : "Unnamed");

/** The one-word summary on a collapsed animal. Same source as the Animals
 *  column and the alerts — nextBreeding() — so they can't disagree. */
const STATUS_WORD: Record<string, string> = {
  carrying: "carrying",
  wait: "waiting period",
  ready: "ready to breed",
  bred: "awaiting a check",
  recheck: "recheck",
  open: "open",
  none: "nothing standing",
};

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
  // A check that comes back pregnant can carry the calving with it. That is
  // only useful in arrears — the calf doesn't exist 30 days after a service —
  // but recording a season out of the notebook is exactly when it is useful,
  // and the alternative is a second trip to another page.
  const [alsoCalved, setAlsoCalved] = useState(false);
  const [calvingDate, setCalvingDate] = useState("");
  const [calf, setCalf] = useState<CalfDraft>(emptyCalf);

  /** Which cow's record is open. One at a time — the drawn timeline is a wide
   *  thing and a page of them stacked is a page nobody reads. */
  const [openCow, setOpenCow] = useState<string | null>(null);
  const [showWait, setShowWait] = useState(true);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", repro: EMPTY_REPRO, lots: [], costs: new Map(), lactations: [] });
      return;
    }
    // One read of the whole repro record, shared by the seasons, the drawn
    // timeline and the due-date column. It is the same set lib/alerts.ts
    // needs, so it is the same function.
    const [repro, lots, costs, lactations] = await Promise.all([
      fetchAlertInputs(farmId, todayIso()),
      fetchSemenLots(farmId),
      fetchBreedingCosts(farmId),
      fetchLactations(farmId),
    ]);
    setLoad({ state: "ok", repro, lots, costs, lactations });
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

  const repro = load.state === "ok" ? load.repro : EMPTY_REPRO;
  const lots = load.state === "ok" ? load.lots : EMPTY_LOTS;
  const costs = load.state === "ok" ? load.costs : EMPTY_COSTS;
  const lactations = load.state === "ok" ? load.lactations : EMPTY_LACTATIONS;
  const breedings = repro.breedings;
  const animals = repro.animals;
  const checks = repro.checks;
  const gestation = repro.gestation;

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

  // Animals -> breeding season -> the services in it. The flat list answered
  // "what did we do lately" and nothing about any one cow; this is the shape
  // the record actually has, and it is the shape toSeasons already returns.
  const byBreedingId = useMemo(() => new Map(breedings.map((b) => [b.id, b])), [breedings]);

  const cows = useMemo(() => {
    if (load.state !== "ok") return [] as { cow: RealAnimal; input: ReturnType<typeof timelineFor>; seasons: Season[] }[];
    return females
      .map((cow) => {
        const input = { ...timelineFor(cow, repro), lactations };
        return { cow, input, seasons: toSeasons(input) };
      })
      // A cow with nothing logged has no record to show. She is on Animals,
      // and listing her here as an empty heading would be noise on the page
      // whose whole job is the ones that do have a record.
      .filter((c) => c.seasons.some((s) => s.services.length > 0 || s.ending !== null))
      .sort((a, b) => nameOfCow(a.cow).localeCompare(nameOfCow(b.cow)));
  }, [load.state, females, repro, lactations]);

  const standing = breedings.filter(isActive);
  const strawsLeft = lots.reduce((s, l) => s + (l.active ? l.straws_remaining : 0), 0);
  const spent = [...costs.values()].reduce((s, n) => s + n, 0);

  /** One service: the row, and the check and void forms it opens. Lifted out
   *  of the old flat map so the same markup can sit three levels down. */
  const renderService = (b: Breeding) => {
    const cost = costs.get(b.id);
    const check = latestCheck(checks, b.id);
    const dam = byId.get(b.animal_id);
    const carried = dam ? gestationFor(dam, gestation) : null;
    const due = dam ? dueDate(b.date, carried?.days) : null;
    // Once she's confirmed open or aborted there is nothing left to be due,
    // and a date sitting there would be a lie.
    const stillCarrying = !b.voided && check?.result !== "open" && check?.result !== "aborted";

    // Animals already on file who could be the calf from this service: born
    // on the calving date, not already attached to a calving, and not out of
    // some other cow. The database refuses every other pairing, so offering
    // one would only produce an error later.
    const claimedCalves = new Set(
      repro.outcomes.map((o) => o.calf_animal_id).filter((id): id is string => id !== null),
    );
    const onFile = animals.filter(
      (a) =>
        a.record_type !== "reference" &&
        a.birth_date === calvingDate &&
        !claimedCalves.has(a.id) &&
        (a.dam_id === null || a.dam_id === b.animal_id),
    );
    const asRecorded = ((): CalfDraft => {
      const picked = calf.animalId === "" ? undefined : byId.get(calf.animalId);
      return picked
        ? { ...calf, sex: picked.sex, earTag: picked.ear_tag, barnName: picked.barn_name ?? "" }
        : calf;
    })();
    const calvingProblem =
      alsoCalved && checkResult === "pregnant"
        ? validateCalving({ damId: b.animal_id, date: calvingDate, calves: [asRecorded] })
        : null;
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
                                setAlsoCalved(false);
                                setCalvingDate(due ?? "");
                                setCalf(emptyCalf());
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
                        {/* Only on a pregnant result: the other three say she
                            isn't in calf, so there is no calf to name. */}
                        {checkResult === "pregnant" && (
                          <div className="brd-calved">
                            <label className="rt-toggle" style={{ marginTop: 0 }}>
                              <input
                                type="checkbox"
                                checked={alsoCalved}
                                aria-label="She has since calved from this service"
                                onChange={(e) => setAlsoCalved(e.target.checked)}
                              />
                              She has since calved from this service
                            </label>

                            {alsoCalved && (
                              <>
                                <div className="breeding-check__row" style={{ marginTop: 12 }}>
                                  <label style={{ fontSize: 13 }}>
                                    <div className="eyebrow">Calved on</div>
                                    <input
                                      className="order-select"
                                      type="date"
                                      value={calvingDate}
                                      aria-label="Calving date"
                                      onChange={(e) => setCalvingDate(e.target.value)}
                                    />
                                  </label>
                                  {onFile.length > 0 && (
                                    <label style={{ fontSize: 13 }}>
                                      <div className="eyebrow">Calf</div>
                                      <select
                                        className="order-select"
                                        value={calf.animalId}
                                        aria-label="Calf record"
                                        onChange={(e) => setCalf({ ...calf, animalId: e.target.value })}
                                      >
                                        <option value="">New record</option>
                                        {onFile.map((a) => (
                                          <option key={a.id} value={a.id}>
                                            {a.barn_name?.trim() || `Tag ${a.ear_tag}`} — already on file
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  )}
                                  <label style={{ fontSize: 13 }}>
                                    <div className="eyebrow">Sex</div>
                                    <select
                                      className="order-select"
                                      value={asRecorded.sex}
                                      aria-label="Calf sex"
                                      disabled={calf.animalId !== ""}
                                      onChange={(e) => setCalf({ ...calf, sex: e.target.value })}
                                    >
                                      <option value="">Not recorded</option>
                                      <option value="female">Heifer</option>
                                      <option value="male">Bull</option>
                                    </select>
                                  </label>
                                  <label style={{ fontSize: 13 }}>
                                    <div className="eyebrow">Ear tag</div>
                                    <input
                                      className="order-select"
                                      value={asRecorded.earTag}
                                      aria-label="Calf ear tag"
                                      disabled={calf.animalId !== ""}
                                      onChange={(e) => setCalf({ ...calf, earTag: e.target.value })}
                                    />
                                  </label>
                                  <label style={{ fontSize: 13 }}>
                                    <div className="eyebrow">Name</div>
                                    <input
                                      className="order-select"
                                      value={asRecorded.barnName}
                                      aria-label="Calf name"
                                      disabled={calf.animalId !== ""}
                                      onChange={(e) => setCalf({ ...calf, barnName: e.target.value })}
                                    />
                                  </label>
                                </div>
                                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                                  {calvingProblem ? (
                                    <span style={{ color: "var(--red)" }}>{calvingProblem}</span>
                                  ) : calf.animalId !== "" ? (
                                    "The calf already on file is attached to this calving — her dam and sire are filled in, nothing new is created."
                                  ) : (
                                    "A live calf gets its own record, with this service's sire filled in. Ease and assistance can be added on Calvings."
                                  )}
                                </p>
                              </>
                            )}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <Button
                            variant="filled"
                            size="sm"
                            disabled={
                              busy ||
                              calvingProblem !== null ||
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
                                // Two writes, deliberately not one. A check is
                                // a fact and a calving is a fact; either is
                                // worth keeping without the other, unlike the
                                // halves of an AI service. If the second
                                // fails the message says the first landed.
                                if (alsoCalved && checkResult === "pregnant") {
                                  try {
                                    await recordCalving({
                                      damId: b.animal_id,
                                      date: calvingDate,
                                      calves: [asRecorded],
                                      calvingEase: 1,
                                      assistance: "unassisted",
                                      presentation: "anterior",
                                      retainedPlacenta: false,
                                      breedingEventId: b.id,
                                    });
                                  } catch (err) {
                                    throw new Error(
                                      `The check is recorded. The calving isn't: ${
                                        err instanceof Error ? err.message : String(err)
                                      }`,
                                    );
                                  }
                                }
                                setCheckingId(null);
                              }, alsoCalved && checkResult === "pregnant" ? "Check and calving recorded." : "Check recorded.")
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
  };

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

          <div className="serif" style={{ fontSize: 21, margin: "32px 0 4px" }}>
            Recorded
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
            By animal, then by season. A season runs from one calving to the next, so the services inside one are the
            ones that were trying for the same calf.
          </p>

          {cows.length === 0 ? (
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

              {cows.map(({ cow, input, seasons }) => {
                const open = seasons[seasons.length - 1];
                const status = nextBreeding(open, {
                  today: repro.today,
                  voluntaryWaitDays: repro.voluntaryWaitDays,
                });
                const expanded = openCow === cow.id;
                return (
                  <div className="brd-animal" key={cow.id}>
                    <button
                      type="button"
                      className="brd-animal__head"
                      aria-expanded={expanded}
                      onClick={() => setOpenCow(expanded ? null : cow.id)}
                    >
                      <span className="mono brd-animal__caret" aria-hidden="true">
                        {expanded ? "\u2013" : "+"}
                      </span>
                      <span className="brd-animal__name">
                        <span className="serif" style={{ fontSize: 19 }}>
                          {nameOfCow(cow)}
                        </span>
                        <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                          {" "}
                          · tag {cow.ear_tag || "—"} · {cow.class}
                        </span>
                      </span>
                      <span className="brd-animal__status">
                        <Pill variant={status.state === "carrying" ? "outline-green" : "outline"}>
                          {STATUS_WORD[status.state]}
                        </Pill>
                        <span className="mono" style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                          {seasons.reduce((n, s) => n + s.services.length, 0)} service
                          {seasons.reduce((n, s) => n + s.services.length, 0) === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>

                    {expanded && (
                      <div className="brd-animal__body">
                        {/* The drawn record, under her name, among the
                            services it is drawn from. It used to be on her
                            animal page, a click away from any of this. */}
                        <ReproTimeline input={input} herd={animals} showWait={showWait} onShowWait={setShowWait} />

                        {[...seasons].reverse().map((season) => (
                          <div className="brd-season" key={season.key}>
                            <div className="brd-season__head">
                              <span className="serif" style={{ fontSize: 17 }}>
                                {season.title}
                              </span>
                              <span className="mono brd-season__meta">
                                {season.anchor === "calving" ? `calved ${season.startsOn}` : `from ${season.startsOn}`}
                                {season.intervalDays !== null && ` · ${season.intervalDays} d interval`}
                                {season.daysOpen !== null && ` · ${season.daysOpen} d open`}
                              </span>
                            </div>

                            {season.services.length === 0 ? (
                              <p className="brd-season__empty">
                                No service logged in this season{season.ending ? "" : " yet"}.
                              </p>
                            ) : (
                              <>
                                <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                                  <span>Date</span>
                                  <span>Sire</span>
                                  <span className="hide-sm">Checked</span>
                                  <span className="hide-sm">Due</span>
                                  <span className="text-right">Cost</span>
                                  <span className="text-right hide-sm">Actions</span>
                                </GridRow>
                                {[...season.services].reverse().map((svc) => {
                                  const b = byBreedingId.get(svc.id);
                                  if (!b) return null;
                                  return renderService(b);
                                })}
                              </>
                            )}
                          </div>
                        ))}
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

const EMPTY_LOTS: SemenLot[] = [];
const EMPTY_COSTS = new Map<string, number>();
const EMPTY_LACTATIONS: RealLactation[] = [];
const EMPTY_REPRO: AlertInputs = {
  animals: [],
  calvings: [],
  outcomes: [],
  breedings: [],
  checks: [],
  gestation: { breeds: [], composition: [], overrides: [], bySpecies: {} },
  voluntaryWaitDays: null,
  today: todayIso(),
};
