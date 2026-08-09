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
  | { state: "ok"; breedings: Breeding[]; animals: RealAnimal[]; lots: SemenLot[]; costs: Map<string, number> };

const COLS = "110px 1fr 170px 120px 110px 110px";
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

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", breedings: [], animals: [], lots: [], costs: new Map() });
      return;
    }
    const [breedings, animals, lots, costs] = await Promise.all([
      fetchBreedings(farmId),
      fetchAnimals(),
      fetchSemenLots(farmId),
      fetchBreedingCosts(farmId),
    ]);
    setLoad({ state: "ok", breedings, animals, lots, costs });
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
                <span className="hide-sm">Straw</span>
                <span className="text-right hide-sm">Service</span>
                <span className="text-right">Cost</span>
                <span className="text-right hide-sm">Actions</span>
              </GridRow>

              {breedings.map((b) => {
                const cost = costs.get(b.id);
                return (
                  <div key={b.id}>
                    <GridRow cols={COLS} mobileCols={COLS_SM} as="body" highlight={b.voided}>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {b.date}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="serif" style={{ fontSize: 17 }}>
                          {name(b.animal_id) ?? "Unknown"}
                        </span>
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
                      <span className="mono hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {b.semen_lot_id ? b.naab_code_snapshot.trim() || b.semen_type || "straw" : "—"}
                      </span>
                      <span className="mono text-right hide-sm">{b.service_number}</span>
                      <span className="mono text-right">{cost === undefined ? "—" : money(cost)}</span>
                      <span className="text-right hide-sm">
                        {!b.voided && (
                          <button
                            type="button"
                            className="link-button mono"
                            onClick={() => {
                              setVoidingId(voidingId === b.id ? null : b.id);
                              setVoidReason("");
                              setError(null);
                            }}
                          >
                            void
                          </button>
                        )}
                      </span>
                    </GridRow>

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
