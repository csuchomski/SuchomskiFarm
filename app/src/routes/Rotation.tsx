import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Pill, Button, GridRow, Callout, SaveToast } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  deleteMove,
  deleteMoves,
  editMove,
  deleteRound,
  fetchForageRemovals,
  fetchGrazingEvents,
  fetchGrazingGroups,
  fetchPaddocks,
  fetchPastures,
  fetchRounds,
  pasturesInUse,
  recordRemoval,
  roundsFor,
  saveRound,
  type ForageRemoval,
  type GrazingEvent,
  type GrazingGroup,
  type GrazingRound,
  type MoveEdit,
  type Paddock,
  type Pasture,
  type RemovalKind,
  type RoundView,
  type Stay,
} from "../lib/grazing";
import { MoveEditor } from "../components/herd/MoveEditor";
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
  | {
      state: "ok";
      paddocks: Paddock[];
      pastures: Pasture[];
      groups: GrazingGroup[];
      rounds: GrazingRound[];
      events: GrazingEvent[];
      removals: ForageRemoval[];
    };

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

interface RoundForm {
  id: string | null;
  groupId: string;
  /** "" for a farm whose ground carries no pasture. */
  pastureId: string;
  startedOn: string;
  name: string;
  notes: string;
}

/**
 * How a round is named on the page.
 *
 * The mob and the ground come first because a farm running four mobs over six
 * pastures has thirty rounds, and "Round 2" on its own says nothing about
 * which. A named round uses its name; an unnamed one is numbered within its
 * own mob and pasture, which is how it is spoken about.
 */
function roundLabel(v: RoundView): string {
  const what = v.round.name ?? `Round ${v.index}`;
  return [v.group?.name, v.pasture?.name, what].filter(Boolean).join(" · ");
}

export default function Rotation() {
  const { farmId, role } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cutting, setCutting] = useState(false);

  // Which stay is opened out into its moves, which move is being corrected,
  // and which round has been asked to go. One at a time: two open editors on
  // one chain is a way to save a correction against a stale neighbour.
  const [openStay, setOpenStay] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmRound, setConfirmRound] = useState<string | null>(null);
  /** The round being renamed or re-dated, or a blank one being started. */
  const [editingRound, setEditingRound] = useState<RoundForm | null>(null);

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
    const [paddocks, pastures, groups, rounds, events, removals] = await Promise.all([
      fetchPaddocks(farmId),
      fetchPastures(farmId),
      fetchGrazingGroups(farmId),
      fetchRounds(farmId),
      fetchGrazingEvents(farmId),
      fetchForageRemovals(farmId),
    ]);
    setLoad({ state: "ok", paddocks, pastures, groups, rounds, events, removals });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  /**
   * The rounds the farm started, with their grazing hung on them.
   *
   * Was `rotationRounds`, which guessed. It could not see which mob or which
   * pasture, so on a farm with four mobs over six pastures it reported twenty
   * rounds of a dozen stays where there are two per mob per pasture — see
   * migration 066. `roundsFor` reads rows instead, newest first.
   */
  const { rounds, unassigned } = useMemo(() => {
    if (load.state !== "ok") return { rounds: [] as RoundView[], unassigned: [] as Stay[] };
    return roundsFor({
      rounds: load.rounds,
      events: load.events,
      paddocks: load.paddocks,
      groups: load.groups,
      pastures: load.pastures,
      removals: load.removals,
      nowIso: nowIso(),
    });
  }, [load]);

  const readOnly = role !== null && !["owner", "helper", "vet"].includes(role);

  /** The mobs and ground a round can be started on. Derived from the paddocks
   *  so a pasture nobody has fenced is not offered. */
  const groups = load.state === "ok" ? load.groups.filter((g) => g.active) : [];
  const grounds = useMemo(
    () =>
      load.state === "ok"
        ? pasturesInUse(load.paddocks.filter((p) => p.active), load.pastures).map((r) => r.pasture)
        : [],
    [load],
  );

  const startEditRound = (v: RoundView) => {
    setEditingRound({
      id: v.round.id,
      groupId: v.round.groupId,
      pastureId: v.round.pastureId ?? "",
      startedOn: v.round.startedAt.slice(0, 10),
      name: v.round.name ?? "",
      notes: v.round.notes ?? "",
    });
    setConfirmRound(null);
    setError(null);
    setNote(null);
  };

  const startNewRound = () => {
    setEditingRound({
      id: null,
      groupId: groups[0]?.id ?? "",
      pastureId: grounds[0]?.id ?? "",
      startedOn: today(),
      name: "",
      notes: "",
    });
    setConfirmRound(null);
    setCutting(false);
    setError(null);
    setNote(null);
  };

  const saveRoundForm = async (form: RoundForm) => {
    if (!farmId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await saveRound(farmId, form.id, {
        groupId: form.groupId,
        pastureId: form.pastureId === "" ? null : form.pastureId,
        // Midnight local on the day chosen, so a round started "today" owns
        // every move made today rather than only those after the moment the
        // form was opened.
        startedAt: new Date(`${form.startedOn}T00:00:00`).toISOString(),
        name: form.name.trim() === "" ? null : form.name,
        notes: form.notes.trim() === "" ? null : form.notes,
      });
      setEditingRound(null);
      setNote(form.id === null ? "Round started." : "Round saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * "That was not a new round after all."
   *
   * Takes away the boundary, not the record: the moves stay exactly where
   * they are and fall into the round before this one. Nothing about the
   * grazing changes, which is why it needs no warning — unlike deleting the
   * moves, which is the other, destructive thing on this page.
   */
  const unmakeRound = async (v: RoundView) => {
    if (!farmId) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await deleteRound(farmId, v.round.id);
      setEditingRound(null);
      setNote(`${roundLabel(v)} is no longer a round of its own. Its moves join the one before it.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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

  /** The last move in the mob's chain owns its own departure. */
  const isLastInChain = (ev: GrazingEvent): boolean =>
    load.state === "ok" &&
    !load.events.some((e) => e.groupId === ev.groupId && e.enteredAt > ev.enteredAt);

  const saveEdit = async (ev: GrazingEvent, edit: MoveEdit) => {
    await editMove(farmId!, ev.id, edit);
    setEditing(null);
    setNote(`Corrected the move onto ${nameOf(edit.paddockId)}.`);
    setError(null);
    await refresh();
  };

  const removeMove = async (ev: GrazingEvent) => {
    await deleteMove(farmId!, ev.id);
    setEditing(null);
    setNote(
      ev.exitedAt === null
        ? "Deleted. They are back where they came from."
        : `Deleted the move onto ${nameOf(ev.paddockId)}.`,
    );
    setError(null);
    await refresh();
  };

  const removeRound = async (round: RoundView) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const ids = round.stays.flatMap((st) => st.events.map((e) => e.id));
      const n = await deleteMoves(farmId!, ids);
      setConfirmRound(null);
      setOpenStay(null);
      setNote(`${roundLabel(round)} deleted — ${n} move${n === 1 ? "" : "s"} off the record.`);
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
            <Link to="/grazing/records?tab=paddocks" className="rot-back mono">
              ← the board
            </Link>
            {!readOnly && (
              <Button
                onClick={() => (editingRound !== null ? setEditingRound(null) : startNewRound())}
                disabled={load.state !== "ok" || groups.length === 0}
              >
                {editingRound !== null ? "Cancel" : "Start a round"}
              </Button>
            )}
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
      <SaveToast note={note} onDone={() => setNote(null)} />

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

          {editingRound !== null && editingRound.id === null && (
            <RoundEditor
              form={editingRound}
              groups={groups}
              grounds={grounds}
              busy={busy}
              onChange={setEditingRound}
              onSave={() => void saveRoundForm(editingRound)}
              onCancel={() => setEditingRound(null)}
              onUnmake={null}
            />
          )}

          {rounds.length === 0 && editingRound === null && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                No rounds yet. A round is one mob's trip through one pasture, and you start it —
                where the mob overwinters and which paddock is shut up for hay both move where a
                round begins, and neither shows in the move record. Start one and the moves made
                after it gather here, with the rest each paddock had before you walked back in.
              </Callout>
            </div>
          )}

          {/* Grazing older than any round on this ground. Sweeping it into
              the first round would move a boundary nobody asked to move, and
              dropping it would lose moves off the page altogether. */}
          {unassigned.length > 0 && (
            <section className="rot-round">
              <div className="rot-round__head">
                <span className="serif rot-round__n">Before any round was started</span>
                <span className="mono rot-round__when">
                  {unassigned.length} stay{unassigned.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="grz-optional" style={{ margin: "0 0 8px" }}>
                Moves on ground that has no round covering the day they happened. Start a round
                dated on or before {shortDate(unassigned[0].enteredAt.slice(0, 10))} to take them in.
              </p>
              {unassigned.map((stay) => (
                <p key={stay.enteredAt + stay.paddockId} className="rot-cut">
                  <strong>{nameOf(stay.paddockId)}</strong>{" "}
                  {spanLabel(stay.enteredAt, stay.exitedAt)} · {stay.days} day
                  {stay.days === 1 ? "" : "s"}
                </p>
              ))}
            </section>
          )}

          {rounds.map((round) => (
            <section key={round.round.id} className="rot-round">
              <div className="rot-round__head">
                <span className="serif rot-round__n">{roundLabel(round)}</span>
                <span className="mono rot-round__when">
                  {round.firstEntryAt === null ? (
                    <>started {shortDate(round.round.startedAt.slice(0, 10))} · nothing grazed yet</>
                  ) : (
                    <>
                      {spanLabel(round.firstEntryAt, round.lastExitAt)} · {round.days} day
                      {round.days === 1 ? "" : "s"}
                    </>
                  )}
                </span>
                {round.running && <Pill variant="outline-green">running</Pill>}
                {/* A guess about last season presented as a record is worse
                    than no record. 066 backfilled these; editing one clears
                    the flag, because somebody has then looked at it. */}
                {round.round.derived && <Pill>start guessed</Pill>}
                {!readOnly && (
                  <button
                    type="button"
                    className="link-button mono"
                    aria-label={`edit ${roundLabel(round)}`}
                    onClick={() => startEditRound(round)}
                  >
                    edit
                  </button>
                )}
              </div>

              {editingRound?.id === round.round.id && (
                <RoundEditor
                  form={editingRound}
                  groups={groups}
                  grounds={grounds}
                  busy={busy}
                  onChange={setEditingRound}
                  onSave={() => void saveRoundForm(editingRound)}
                  onCancel={() => setEditingRound(null)}
                  onUnmake={() => void unmakeRound(round)}
                />
              )}

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Paddock</span>
                <span>Rest before</span>
                <span className="hide-sm">Dates</span>
                <span className="text-right hide-sm">Days</span>
              </GridRow>

              {round.stays.map((stay) => {
                const key = stay.enteredAt + stay.paddockId;
                const open = openStay === key;
                return (
                  <div key={key}>
                    <GridRow
                      cols={COLS}
                      mobileCols={COLS_SM}
                      as="body"
                      highlight={stay.exitedAt === null}
                      onClick={() => {
                        setOpenStay(open ? null : key);
                        setEditing(null);
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span className="serif" style={{ fontSize: 17 }}>
                          {nameOf(stay.paddockId)}
                        </span>
                        <span className="rot-open" aria-hidden="true">
                          {open ? "▾" : "▸"}
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

                    {/* The moves the stay is made of. A stay is a summary; a
                        correction has to land on the move that was actually
                        logged, so this is where editing lives. */}
                    {open && (
                      <div className="rot-moves">
                        {stay.events.map((ev) =>
                          editing === ev.id ? (
                            <MoveEditor
                              key={ev.id}
                              event={ev}
                              events={load.events}
                              paddocks={load.paddocks}
                              isLast={isLastInChain(ev)}
                              onSave={(edit) => saveEdit(ev, edit)}
                              onDelete={() => removeMove(ev)}
                              onCancel={() => setEditing(null)}
                            />
                          ) : (
                            <div key={ev.id} className="rot-move">
                              <span className="mono rot-move__when">{stamp(ev.enteredAt)}</span>
                              <span className="rot-move__what">{moveNote(ev)}</span>
                              <button
                                type="button"
                                className="rot-move__edit"
                                onClick={() => setEditing(ev.id)}
                              >
                                Edit
                              </button>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Under the round rather than beside its name. Taking a whole
                  round off the record is a rare thing next to correcting one
                  move, and it should not sit where the eye lands first or
                  where a thumb reaching for the first row can catch it. */}
              {confirmRound === round.round.id ? (
                <div className="rot-confirm">
                  <p className="grz-warn" style={{ margin: "0 0 10px" }}>
                    A round is not a thing of its own — it is the moves that make it up. Deleting it
                    takes all {round.stays.reduce((n, s) => n + s.events.length, 0)} of them off the
                    record{round.running ? ", and puts the mob back where they stood before it began" : ""}.
                    Cuttings are not touched.
                  </p>
                  <div className="grz-form__actions">
                    <Button disabled={busy} onClick={() => setConfirmRound(null)}>
                      Keep it
                    </Button>
                    <Button variant="filled" disabled={busy} onClick={() => removeRound(round)}>
                      {busy ? "Deleting…" : "Delete these moves"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rot-round__foot">
                  <button
                    type="button"
                    className="rot-round__del"
                    disabled={busy}
                    onClick={() => setConfirmRound(round.round.id)}
                  >
                    Delete the moves in {roundLabel(round)}
                  </button>
                </div>
              )}

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

/**
 * Starting a round, or saying where one really began.
 *
 * The mob and the ground are fixed once a round has moves under it — changing
 * either would hand its grazing to a round on other ground and leave this one
 * empty — so they are only offered while starting one. What stays editable is
 * the thing that is actually got wrong: which day it started.
 */
function RoundEditor({
  form, groups, grounds, busy, onChange, onSave, onCancel, onUnmake,
}: {
  form: RoundForm;
  groups: GrazingGroup[];
  grounds: Pasture[];
  busy: boolean;
  onChange: (f: RoundForm) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Null while starting one — there is no boundary yet to take away. */
  onUnmake: (() => void) | null;
}) {
  const set = <K extends keyof RoundForm>(k: K, v: RoundForm[K]) => onChange({ ...form, [k]: v });
  const fresh = form.id === null;

  return (
    <div className="grz-form">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {fresh ? "Start a round" : "This round"}
      </div>
      <div className="grz-form__row">
        {fresh && (
          <label className="grz-field">
            <span className="eyebrow">Mob</span>
            <select value={form.groupId} onChange={(e) => set("groupId", e.target.value)} aria-label="Mob">
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
        )}
        {/* No picker on a farm whose ground carries no pasture: the round is
            of the whole farm there, which is what it has always meant. */}
        {fresh && grounds.length > 0 && (
          <label className="grz-field">
            <span className="eyebrow">Ground</span>
            <select
              value={form.pastureId}
              onChange={(e) => set("pastureId", e.target.value)}
              aria-label="Ground"
            >
              {grounds.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="grz-field">
          <span className="eyebrow">Started</span>
          <input
            type="date"
            value={form.startedOn}
            onChange={(e) => set("startedOn", e.target.value)}
            aria-label="Started"
          />
        </label>
        <label className="grz-field grz-field--wide">
          <span className="eyebrow">Name (optional)</span>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            aria-label="Round name"
            placeholder="Spring 1"
          />
        </label>
      </div>
      <p className="grz-optional">
        {fresh
          ? "Every move this mob makes on this ground from that day on belongs to this round, until you start the next one."
          : "Moving the day moves the boundary: the moves either side change which round they fall in. No grazing is touched."}
      </p>
      <div className="grz-form__actions">
        {onUnmake !== null && (
          <button type="button" className="link-button mono" disabled={busy} onClick={onUnmake}>
            not a new round
          </button>
        )}
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="filled" disabled={busy || form.groupId === ""} onClick={onSave}>
          {busy ? "Saving…" : fresh ? "Start it" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/** A move's own line in the opened-out stay: the wire, the grass, the head. */
function moveNote(ev: GrazingEvent): string {
  const parts: string[] = [];
  if (ev.sweptFrom !== null && ev.sweptTo !== null) {
    parts.push(`wire ${Math.round(ev.sweptFrom * 100)}→${Math.round(ev.sweptTo * 100)}%`);
  }
  if (ev.forageHeightInEntry !== null) parts.push(`in at ${ev.forageHeightInEntry}"`);
  if (ev.residualHeightInExit !== null) parts.push(`off at ${ev.residualHeightInExit}"`);
  if (ev.headCount !== null) parts.push(`${ev.headCount} head`);
  if (ev.exitedAt === null) parts.push("still on it");
  return parts.length === 0 ? "no detail recorded" : parts.join(" · ");
}

/** Day and time, which is the resolution a wire move happens at. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
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
