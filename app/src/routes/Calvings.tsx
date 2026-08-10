import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import { fetchBreedings, sireLabel, isActive as breedingStands, type Breeding } from "../lib/breedings";
import { fetchBreeds, fetchComposition, fetchOverrides, gestationFor, type GestationInputs } from "../lib/gestation";
import {
  ASSISTANCE,
  emptyCalf,
  fetchCalfOutcomes,
  fetchCalvings,
  daysBetween,
  dueDate,
  fetchGestationDays,
  likelyService,
  OUTCOMES,
  PRESENTATION,
  recordCalving,
  validateCalving,
  type CalfDraft,
  type CalfOutcome,
  type Calving,
} from "../lib/repro";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";
import "./breedings.css";

/**
 * Calvings, and the calves.
 *
 * Recording one writes the calving, a row per calf, an animal record for
 * each live calf with its dam and sire already filled in, and — for a dairy
 * dam — the lactation it freshens, closing the one before it. All in one
 * database function; see docs/migrations/028-pregnancy-and-calving.sql.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);
const readable = (s: string) => s.replace(/_/g, " ");

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      calvings: Calving[];
      outcomes: CalfOutcome[];
      animals: RealAnimal[];
      breedings: Breeding[];
      gestation: GestationInputs;
    };

const COLS = "110px 1fr 150px 130px 110px";
const COLS_SM = "92px 1fr 96px";

export default function Calvings() {
  const { business, farmId } = useWorkspace();

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [damId, setDamId] = useState("");
  const [date, setDate] = useState(todayIso);
  const [ease, setEase] = useState(1);
  const [assistance, setAssistance] = useState<string>("unassisted");
  const [presentation, setPresentation] = useState<string>("anterior");
  const [retained, setRetained] = useState(false);
  const [notes, setNotes] = useState("");
  const [calves, setCalves] = useState<CalfDraft[]>([emptyCalf()]);
  // Which service made this calf. Left as "" until a dam is chosen, then
  // defaulted to the likeliest one rather than simply the most recent.
  const [serviceId, setServiceId] = useState("");
  const [servicePicked, setServicePicked] = useState(false);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", calvings: [], outcomes: [], animals: [], breedings: [], gestation: EMPTY_GESTATION });
      return;
    }
    const [calvings, outcomes, animals, breedings, breeds, composition, overrides, bySpecies] = await Promise.all([
      fetchCalvings(farmId),
      fetchCalfOutcomes(farmId),
      fetchAnimals(),
      fetchBreedings(farmId),
      fetchBreeds(farmId),
      fetchComposition(farmId),
      fetchOverrides(farmId),
      fetchGestationDays(),
    ]);
    setLoad({
      state: "ok",
      calvings,
      outcomes,
      animals,
      breedings,
      gestation: { breeds, composition, overrides, bySpecies },
    });
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

  const calvings = load.state === "ok" ? load.calvings : EMPTY_CALVINGS;
  const outcomes = load.state === "ok" ? load.outcomes : EMPTY_OUTCOMES;
  const animals = load.state === "ok" ? load.animals : EMPTY_ANIMALS;
  const breedings = load.state === "ok" ? load.breedings : EMPTY_BREEDINGS;
  const gestation = load.state === "ok" ? load.gestation : EMPTY_GESTATION;

  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const name = (id: string | null | undefined) => {
    if (!id) return undefined;
    const a = byId.get(id);
    return a ? a.barn_name?.trim() || a.ear_tag : undefined;
  };

  const dams = useMemo(() => animals.filter((a) => a.sex === "female" && a.status === "active"), [animals]);
  const dam = byId.get(damId) ?? null;
  const freshens = dam !== null && (dam.purpose === "dairy" || dam.purpose === "dual");

  const outcomesFor = (calvingId: string) => outcomes.filter((o) => o.calving_id === calvingId);

  // Animals already on file who could *be* one of today's calves: born on the
  // calving date, and not already attached to a calving. The date is the
  // filter because a calf's birth date is the calving — the database refuses
  // any other pairing, so offering one would only produce an error later.
  const claimed = useMemo(
    () => new Set(outcomes.map((o) => o.calf_animal_id).filter((id): id is string => id !== null)),
    [outcomes],
  );
  const onFile = useMemo(
    () => animals.filter((a) => a.birth_date === date && !claimed.has(a.id) && a.record_type !== "reference"),
    [animals, date, claimed],
  );
  const problem = adding ? validateCalving({ damId, date, calves }) : null;

  // Her standing services before this date — the ones that could have made
  // the calf. A voided service made nothing.
  const herServices = useMemo(
    () => breedings.filter((b) => b.animal_id === damId && breedingStands(b) && b.date < date),
    [breedings, damId, date],
  );
  const carried = dam ? gestationFor(dam, gestation) : null;
  const suggested = likelyService(date, herServices, carried?.days);

  // Suggest, don't impose: the moment the farmer touches the field it's
  // theirs, and changing dam or date re-suggests rather than overwriting a
  // deliberate choice.
  useEffect(() => {
    if (!servicePicked) setServiceId(suggested?.id ?? "");
  }, [suggested?.id, servicePicked]);

  const chosenService = herServices.find((b) => b.id === serviceId) ?? null;

  const liveCalves = outcomes.filter((o) => o.outcome === "live").length;
  const lost = outcomes.length - liveCalves;

  const reset = () => {
    setDamId("");
    setDate(todayIso());
    setEase(1);
    setAssistance("unassisted");
    setPresentation("anterior");
    setRetained(false);
    setNotes("");
    setCalves([emptyCalf()]);
    setServiceId("");
    setServicePicked(false);
  };

  return (
    <OpsShell searchPlaceholder="A cow, a calf…">
      <PageHeader
        eyebrow={business ? `${business.name} · herd` : "Herd"}
        title="Calvings"
        actions={
          <Button
            variant="filled"
            disabled={load.state !== "ok" || !farmId}
            onClick={() => {
              setAdding((v) => !v);
              reset();
              setError(null);
              setNote(null);
            }}
          >
            {adding ? "Cancel" : "Record a calving"}
          </Button>
        }
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load calvings: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={calvings.length || "—"} label="Calvings" />
            <StatTile value={liveCalves || "—"} label="Live calves" />
            <StatTile value={lost || "—"} label="Lost" />
            <StatTile value={calvings.filter((c) => c.is_twin).length || "—"} label="Twinnings" />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          {adding && (
            <div className="order-form">
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                The calving
              </div>
              <div className="order-form__fields">
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Dam</div>
                  <select
                    className="order-select"
                    value={damId}
                    aria-label="Dam"
                    onChange={(e) => setDamId(e.target.value)}
                  >
                    <option value="">Pick one…</option>
                    {dams.map((a) => (
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
                    value={date}
                    aria-label="Calving date"
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Ease (1 easy – 5 hard)</div>
                  <select
                    className="order-select"
                    value={String(ease)}
                    aria-label="Calving ease"
                    onChange={(e) => setEase(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Assistance</div>
                  <select
                    className="order-select"
                    value={assistance}
                    aria-label="Assistance"
                    onChange={(e) => setAssistance(e.target.value)}
                  >
                    {ASSISTANCE.map((a) => (
                      <option key={a} value={a}>
                        {readable(a)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13 }}>
                  <div className="eyebrow">Presentation</div>
                  <select
                    className="order-select"
                    value={presentation}
                    aria-label="Presentation"
                    onChange={(e) => setPresentation(e.target.value)}
                  >
                    {PRESENTATION.map((p) => (
                      <option key={p} value={p}>
                        {readable(p)}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, paddingTop: 18 }}>
                  <input
                    type="checkbox"
                    checked={retained}
                    aria-label="Retained placenta"
                    onChange={(e) => setRetained(e.target.checked)}
                  />
                  Retained placenta
                </label>
              </div>

              {/* Which service made the calf. This decides the sire on its
                  record, and through the sire, the breeds it inherits. */}
              {damId !== "" && (
                <>
                  <div className="eyebrow" style={{ margin: "20px 0 8px" }}>
                    The service behind it
                  </div>
                  {herServices.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      No breeding logged for her before this date, so the calf gets no sire. Log one on{" "}
                      <Link to="/breedings">Breedings</Link> first if you know it.
                    </p>
                  ) : (
                    <>
                      <label style={{ fontSize: 13, display: "block", maxWidth: 460 }}>
                        <div className="eyebrow">Service</div>
                        <select
                          className="order-select"
                          style={{ width: "100%" }}
                          value={serviceId}
                          aria-label="Service"
                          onChange={(e) => {
                            setServiceId(e.target.value);
                            setServicePicked(true);
                          }}
                        >
                          <option value="">Not recorded</option>
                          {herServices.map((b) => {
                            const expected = carried ? dueDate(b.date, carried.days) : null;
                            const off = expected ? daysBetween(expected, date) : null;
                            return (
                              <option key={b.id} value={b.id}>
                                {b.date} · {sireLabel(b, name(b.sire_id))}
                                {off !== null &&
                                  ` · ${off === 0 ? "due today" : off > 0 ? `${off}d late` : `${-off}d early`}`}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                        {chosenService
                          ? `The calf's sire comes from this service${
                              suggested && chosenService.id === suggested.id ? " — the closest fit to the date" : ""
                            }. If both parents have breeds on file, it inherits half from each.`
                          : "Without a service the calf has no sire, and no breeds to inherit."}
                      </p>
                    </>
                  )}
                </>
              )}

              <div className="eyebrow" style={{ margin: "20px 0 8px" }}>
                The calves
              </div>
              {calves.map((calf, i) => (
                <div className="calf-row" key={i}>
                  {/* A calf entered before the calving was — every animal born
                      before this page existed is in that position. Picking her
                      here attaches her rather than creating a second record of
                      the same animal. */}
                  {onFile.length > 0 && (
                    <label style={{ fontSize: 13 }}>
                      <div className="eyebrow">Record</div>
                      <select
                        className="order-select"
                        value={calf.animalId}
                        aria-label={`Calf ${i + 1} record`}
                        disabled={calf.outcome !== "live"}
                        onChange={(e) => {
                          const picked = animals.find((a) => a.id === e.target.value);
                          setCalves((prev) =>
                            prev.map((c, j) =>
                              j === i
                                ? {
                                    ...c,
                                    animalId: e.target.value,
                                    // Her own record is the authority on all
                                    // three; typing over them here would only
                                    // be rejected by the database.
                                    sex: picked ? picked.sex : c.sex,
                                    earTag: picked ? picked.ear_tag : c.earTag,
                                    barnName: picked ? (picked.barn_name ?? "") : c.barnName,
                                  }
                                : c,
                            ),
                          );
                        }}
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
                    <div className="eyebrow">Outcome</div>
                    <select
                      className="order-select"
                      value={calf.outcome}
                      aria-label={`Calf ${i + 1} outcome`}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, outcome: e.target.value } : c)))
                      }
                    >
                      {OUTCOMES.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Sex</div>
                    <select
                      className="order-select"
                      value={calf.sex}
                      aria-label={`Calf ${i + 1} sex`}
                      disabled={calf.animalId !== ""}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, sex: e.target.value } : c)))
                      }
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
                      value={calf.earTag}
                      aria-label={`Calf ${i + 1} ear tag`}
                      disabled={calf.outcome !== "live" || calf.animalId !== ""}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, earTag: e.target.value } : c)))
                      }
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Name</div>
                    <input
                      className="order-select"
                      value={calf.barnName}
                      aria-label={`Calf ${i + 1} name`}
                      disabled={calf.outcome !== "live" || calf.animalId !== ""}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, barnName: e.target.value } : c)))
                      }
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div className="eyebrow">Birth weight</div>
                    <input
                      className="order-select"
                      type="number"
                      min="0"
                      step="0.1"
                      inputMode="decimal"
                      value={calf.birthWeight}
                      aria-label={`Calf ${i + 1} birth weight`}
                      onChange={(e) =>
                        setCalves((prev) => prev.map((c, j) => (j === i ? { ...c, birthWeight: e.target.value } : c)))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="link-button mono"
                    disabled={calves.length === 1}
                    onClick={() => setCalves((prev) => prev.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="link-button mono"
                onClick={() => setCalves((prev) => [...prev, emptyCalf()])}
              >
                + another calf (twins)
              </button>

              <label style={{ fontSize: 13, display: "block", marginTop: 12 }}>
                <div className="eyebrow">Notes</div>
                <input
                  className="order-select"
                  style={{ width: "100%" }}
                  value={notes}
                  aria-label="Notes"
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                <Button
                  variant="filled"
                  size="sm"
                  disabled={busy || problem !== null}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    recordCalving({
                      damId,
                      date,
                      calves,
                      calvingEase: ease,
                      assistance,
                      presentation,
                      retainedPlacenta: retained,
                      notes,
                      breedingEventId: serviceId === "" ? null : serviceId,
                    })
                      .then(async () => {
                        await refresh();
                        setAdding(false);
                        setNote(
                          freshens
                            ? "Recorded, and she's freshened — the lactation before it is closed."
                            : "Recorded.",
                        );
                      })
                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? "Saving…" : "Record it"}
                </Button>
                <span style={{ fontSize: 13, color: problem ? "var(--red)" : "var(--ink-muted)" }}>
                  {problem ??
                    (calves.some((c) => c.animalId !== "")
                      ? "The calf already on file is attached to this calving — her dam and sire are filled in, nothing new is created."
                      : "A live calf gets its own record, with dam and sire filled in.")}
                </span>
              </div>

              {/* Its own line rather than part of the hint above: closing her
                  last lactation is a consequence worth seeing while you fill
                  the form in, not one that disappears behind a validation
                  message. */}
              {freshens && (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                  This also freshens her — a new lactation opens on this date and the one before it is closed.
                </p>
              )}
            </div>
          )}

          <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
            Recorded
          </div>

          {calvings.length === 0 ? (
            <Callout>
              Nothing recorded yet. A calving is what closes out a service logged on{" "}
              <Link to="/breedings">Breedings</Link>.
            </Callout>
          ) : (
            <>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Date</span>
                <span>Dam · calves</span>
                <span className="hide-sm">How it went</span>
                <span className="hide-sm">Weights</span>
                <span className="text-right hide-sm">Ease</span>
              </GridRow>

              {calvings.map((c) => {
                const calfRows = outcomesFor(c.id);
                return (
                  <GridRow key={c.id} cols={COLS} mobileCols={COLS_SM} as="body">
                    <span className="mono" style={{ fontSize: 13 }}>
                      {c.date}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="serif" style={{ fontSize: 17 }}>
                        {name(c.dam_id) ?? "Unknown"}
                      </span>
                      {c.is_twin && (
                        <>
                          {" "}
                          <Pill variant="outline">twins</Pill>
                        </>
                      )}
                      <br />
                      <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {calfRows.length === 0
                          ? "no calves recorded"
                          : calfRows
                              .map((o) => {
                                const who = name(o.calf_animal_id);
                                const what = o.sex === "female" ? "heifer" : o.sex === "male" ? "bull" : "calf";
                                return o.outcome === "live" ? `${who ?? what}` : `${what} ${readable(o.outcome)}`;
                              })
                              .join(", ")}
                      </span>
                    </span>
                    <span className="hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {(() => {
                        const svc = breedings.find((b) => b.id === c.breeding_event_id);
                        return svc ? `${sireLabel(svc, name(svc.sire_id))} · ` : "";
                      })()}
                      {readable(c.assistance)}
                      {c.presentation !== "anterior" && `, ${readable(c.presentation)}`}
                      {c.retained_placenta && ", retained placenta"}
                    </span>
                    <span className="mono hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {calfRows.every((o) => o.birth_weight_lb === null)
                        ? "—"
                        : calfRows
                            .map((o) => (o.birth_weight_lb === null ? "—" : `${o.birth_weight_lb}lb`))
                            .join(", ")}
                    </span>
                    <span className="mono text-right hide-sm">{c.calving_ease}</span>
                  </GridRow>
                );
              })}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                A live calf becomes an animal on <Link to="/animals">Animals</Link>, born on the farm, with its dam
                and the sire from the breeding behind this calving. A dairy dam's lactation opens here too — see{" "}
                <Link to="/lactations">Lactations</Link>.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_CALVINGS: Calving[] = [];
const EMPTY_OUTCOMES: CalfOutcome[] = [];
const EMPTY_ANIMALS: RealAnimal[] = [];
const EMPTY_BREEDINGS: Breeding[] = [];
const EMPTY_GESTATION: GestationInputs = { breeds: [], composition: [], overrides: [], bySpecies: {} };
