import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchPaddocks,
  recordRemoval,
  rotationRounds,
  type ForageRemoval,
  type GrazingEvent,
  type Paddock,
  type RemovalKind,
  type Round,
  type Stay,
} from "../lib/grazing";
import "./grazing.css";

/**
 * Herd → Rotation: how many times round, and what came off in between.
 *
 * The unit here is the **round** — one trip through the farm — rather than the
 * day. At strip-grazing resolution a stay is a fortnight of daily wire moves,
 * and a chart fine enough to show one strip is far wider than the phone this
 * is read on. The round is also the question actually asked: not "what
 * happened on 14 July" but "how many times have we been round, and had that
 * paddock recovered when we walked back in".
 *
 * Hay is entered here rather than on the board because this is where the
 * record lives, and because a cutting is an occasional act — the board is for
 * the daily one.
 *
 * Nothing here says "compliant". These are records of what happened.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; paddocks: Paddock[]; events: GrazingEvent[]; removals: ForageRemoval[] };

const COLS = "minmax(0, 1fr) 104px 116px 58px";
const COLS_SM = "minmax(0, 1fr) 96px";

const KINDS: { value: RemovalKind; label: string }[] = [
  { value: "hay", label: "Hay" },
  { value: "haylage", label: "Haylage" },
  { value: "baleage", label: "Baleage" },
  { value: "green_chop", label: "Green chop" },
  { value: "other", label: "Other" },
];

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export default function Rotation() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cutting, setCutting] = useState(false);

  const [paddockId, setPaddockId] = useState("");
  const [removedOn, setRemovedOn] = useState(today);
  const [kind, setKind] = useState<RemovalKind>("hay");
  const [cuttingNumber, setCuttingNumber] = useState("");
  const [yieldLb, setYieldLb] = useState("");
  const [basis, setBasis] = useState<"weighed" | "estimated" | "">("");
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, events, removals] = await Promise.all([
      fetchPaddocks(farmId),
      fetchGrazingEvents(farmId),
      fetchForageRemovals(farmId),
    ]);
    setLoad({ state: "ok", paddocks, events, removals });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const rounds = useMemo(() => {
    if (load.state !== "ok") return [] as Round[];
    return rotationRounds({
      events: load.events,
      paddocks: load.paddocks,
      removals: load.removals,
      nowIso: nowIso(),
    }).reverse(); // newest first — the round you are in is the one you want
  }, [load]);

  const nameOf = (id: string) =>
    load.state === "ok" ? (load.paddocks.find((p) => p.id === id)?.name ?? "a paddock") : "a paddock";

  const num = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };

  const openCut = () => {
    setPaddockId("");
    setRemovedOn(today());
    setKind("hay");
    setCuttingNumber("");
    setYieldLb("");
    setBasis("");
    setNotes("");
    setCutting(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await recordRemoval(farmId!, {
        paddockId,
        removedOn,
        kind,
        cuttingNumber: num(cuttingNumber),
        yieldLb: num(yieldLb),
        yieldBasis: basis === "" ? null : basis,
        notes,
      });
      const where = nameOf(paddockId);
      setCutting(false);
      setNote(`Recorded off ${where}. Its rest now counts from ${shortDate(removedOn)}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const totalCuts = load.state === "ok" ? load.removals.length : 0;

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          load.state === "ok"
            ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}${totalCuts > 0 ? ` · ${totalCuts} cutting${totalCuts === 1 ? "" : "s"}` : ""}`
            : "Herd"
        }
        title="Rotation"
        actions={
          <>
            <Link to="/grazing" className="rot-back mono">
              ← the board
            </Link>
            <Button
              variant="filled"
              onClick={() => (cutting ? setCutting(false) : openCut())}
              disabled={load.state !== "ok" || load.paddocks.length === 0}
            >
              {cutting ? "Cancel" : "Record hay"}
            </Button>
          </>
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
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load: {load.message}
        </p>
      )}

      {load.state === "ok" && (
        <>
          {cutting && (
            <div className="grz-form">
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Off which paddock</span>
                  <select
                    value={paddockId}
                    onChange={(e) => setPaddockId(e.target.value)}
                    aria-label="Off which paddock"
                  >
                    <option value="">Pick a paddock…</option>
                    {load.paddocks
                      .filter((p) => p.active)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Cut on</span>
                  <input
                    type="date"
                    value={removedOn}
                    onChange={(e) => setRemovedOn(e.target.value)}
                    aria-label="Cut on"
                  />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">What</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as RemovalKind)}
                    aria-label="What"
                  >
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="grz-optional">
                Everything below is optional — the date and the paddock are what change the rest clock.
              </p>

              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Cutting no.</span>
                  <input
                    value={cuttingNumber}
                    onChange={(e) => setCuttingNumber(e.target.value)}
                    inputMode="numeric"
                    aria-label="Cutting no."
                  />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Yield, lb</span>
                  <input
                    value={yieldLb}
                    onChange={(e) => setYieldLb(e.target.value)}
                    inputMode="decimal"
                    aria-label="Yield, lb"
                  />
                </label>
                <label className="grz-field">
                  {/* A scale ticket and a guess off the back of the wagon are
                      not the same evidence, and the balance should not be
                      forced to treat them alike. */}
                  <span className="eyebrow">Weighed or estimated</span>
                  <select
                    value={basis}
                    onChange={(e) => setBasis(e.target.value as "weighed" | "estimated" | "")}
                    aria-label="Weighed or estimated"
                  >
                    <option value="">—</option>
                    <option value="weighed">weighed</option>
                    <option value="estimated">estimated</option>
                  </select>
                </label>
              </div>

              <label className="grz-field grz-field--wide">
                <span className="eyebrow">Notes</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
              </label>

              <div className="grz-form__actions">
                <Button variant="filled" disabled={busy || paddockId === ""} onClick={save}>
                  {busy ? "Saving…" : "Record it"}
                </Button>
              </div>
            </div>
          )}

          {rounds.length === 0 && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                No rounds yet. A round is one trip through the farm — it starts when the mob enters a
                paddock and ends when they walk back into one they have already had this time through.
                Log moves on the board and they will gather here, with the rest each paddock had before
                they came back to it.
              </Callout>
            </div>
          )}

          {rounds.map((round) => (
            <section key={round.index} className="rot-round">
              <div className="rot-round__head">
                <span className="serif rot-round__n">Round {round.index}</span>
                <span className="mono rot-round__when">
                  {spanLabel(round.startedAt, round.endedAt)} · {round.days} day
                  {round.days === 1 ? "" : "s"}
                </span>
                {round.endedAt === null && <Pill variant="outline-green">running</Pill>}
              </div>

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Paddock</span>
                <span>Rest before</span>
                <span className="hide-sm">Dates</span>
                <span className="text-right hide-sm">Days</span>
              </GridRow>

              {round.stays.map((stay) => (
                <GridRow
                  key={stay.enteredAt + stay.paddockId}
                  cols={COLS}
                  mobileCols={COLS_SM}
                  as="body"
                  highlight={stay.exitedAt === null}
                >
                  <span style={{ minWidth: 0 }}>
                    <span className="serif" style={{ fontSize: 17 }}>
                      {nameOf(stay.paddockId)}
                    </span>
                    <br />
                    <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>{stayNote(stay)}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 15 }}>
                    {stay.restBeforeDays === null ? (
                      <span style={{ color: "var(--ink-faint)" }}>first time</span>
                    ) : (
                      `${stay.restBeforeDays} day${stay.restBeforeDays === 1 ? "" : "s"}`
                    )}
                  </span>
                  <span className="mono hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                    {spanLabel(stay.enteredAt, stay.exitedAt)}
                  </span>
                  <span className="mono text-right hide-sm" style={{ fontSize: 15 }}>
                    {stay.days}
                  </span>
                </GridRow>
              ))}

              {/* Cuttings sit with the round they fell in, because the reason
                  to show them here is that they explain a rest figure that
                  would otherwise look wrong. */}
              {round.cuttings.map((c) => (
                <p key={c.id} className="rot-cut">
                  <span className="eyebrow">{KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}</span>{" "}
                  off <strong>{nameOf(c.paddockId)}</strong>, {shortDate(c.removedOn)}
                  {cutNote(c)}
                </p>
              ))}
            </section>
          ))}

          {/* Cuttings before anything was grazed have nowhere to sit in a
              round, and silently dropping them would be worse than a list. */}
          {rounds.length === 0 && load.removals.length > 0 && (
            <section className="rot-round">
              <div className="rot-round__head">
                <span className="serif rot-round__n">Cuttings</span>
              </div>
              {load.removals.map((c) => (
                <p key={c.id} className="rot-cut">
                  <span className="eyebrow">{KINDS.find((k) => k.value === c.kind)?.label ?? c.kind}</span>{" "}
                  off <strong>{nameOf(c.paddockId)}</strong>, {shortDate(c.removedOn)}
                  {cutNote(c)}
                </p>
              ))}
            </section>
          )}
        </>
      )}
    </OpsShell>
  );
}

/** What made up the stay: how many wire moves, and how much ground. */
function stayNote(stay: Stay): string {
  return [
    stay.strips > 1 ? `${stay.strips} strips` : null,
    stay.acres === null ? null : `${stay.acres.toFixed(2)} ac`,
    stay.exitedAt === null ? "still in it" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function cutNote(c: ForageRemoval): string {
  const bits = [
    c.cuttingNumber === null ? null : `${ordinal(c.cuttingNumber)} cutting`,
    c.yieldLb === null ? null : `${Math.round(c.yieldLb).toLocaleString()} lb`,
    c.yieldBasis,
  ].filter(Boolean);
  return bits.length === 0 ? "" : ` — ${bits.join(", ")}`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "1–11 Jun" where the months match, "28 May – 4 Jun" where they don't, and
 * an open end where they are still in it. */
function spanLabel(fromIso: string, toIso: string | null): string {
  const from = new Date(fromIso);
  if (toIso === null) return `${dayMonth(from)} –`;
  const to = new Date(toIso);
  if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
    return `${from.getDate()}–${dayMonth(to)}`;
  }
  return `${dayMonth(from)} – ${dayMonth(to)}`;
}

function dayMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
