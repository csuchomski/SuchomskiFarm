import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, GridRow, Callout, SaveToast } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import { animalPath, fetchAnimals, type RealAnimal } from "../lib/herd";
import {
  addToGroup,
  fetchGrazingGroups,
  fetchGroupMembers,
  fetchLatestWeights,
  mobWeight,
  removeFromGroup,
  saveGrazingGroup,
  type GrazingGroup,
  type GrazingGroupMember,
} from "../lib/grazing";
import "./grazing.css";

/**
 * Herd → Mobs: who is actually on the grass.
 *
 * This existed as a table and a read, and nothing else. `grazing_group_members`
 * could be fetched and never written, so adding an animal to Herd → Animals
 * left it out of the mob — which is how the farm ran for a while with five
 * animals on file and four head in every figure the grazing module produced.
 *
 * Head count and mob weight both come off this page. Nothing else on the farm
 * sets them: the strip width, the days of feed and the stock density are all
 * downstream of who is on this list and what they last weighed.
 *
 * No delete. A mob that is done with goes inactive, and an animal that leaves
 * gets a leaving date, because "she was in this mob until August" is what
 * makes a past move's head count make sense.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      groups: GrazingGroup[];
      members: GrazingGroupMember[];
      animals: RealAnimal[];
      weights: Map<string, number>;
    };

const COLS = "1fr 120px 120px 96px";
/* Class is what a phone gives up. Taking an animal out is not — that is the
   whole job, and hiding it behind a wider screen would mean the roll could
   only be corrected at a desk. */
const COLS_SM = "1fr 76px 96px";

const today = () => new Date().toISOString().slice(0, 10);

const nameOf = (a: RealAnimal) => (a.barn_name ? `${a.barn_name} · ${a.ear_tag}` : a.ear_tag);

export default function Mobs() {
  const { business, farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The mob being edited, or "new" while one is being written.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("cattle");
  const [klass, setKlass] = useState("mixed");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);

  /** Which mob is having animals added to it, and who is picked. */
  const [adding, setAdding] = useState<string | null>(null);
  const [pick, setPick] = useState("");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [groups, members, animals, weights] = await Promise.all([
      fetchGrazingGroups(farmId),
      fetchGroupMembers(farmId),
      fetchAnimals(farmId),
      fetchLatestWeights(farmId),
    ]);
    setLoad({ state: "ok", groups, members, animals, weights });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

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

  /**
   * Animals that could join a mob: the ones that live here and are still
   * going. `record_type` matters — an AI bull is on file so a pedigree can
   * name him, and offering him as a candidate would be offering to put a
   * straw of semen out on grass.
   */
  const onFarm = useMemo(
    () =>
      load.state === "ok"
        ? load.animals
            .filter((a) => a.record_type === "herd" && a.status === "active")
            .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
        : [],
    [load],
  );

  const openMembers = (groupId: string) =>
    load.state === "ok"
      ? load.members.filter((m) => m.groupId === groupId && m.leftOn === null)
      : [];

  /** On the farm, in no mob. The list the picker offers. */
  const unassigned = useMemo(() => {
    if (load.state !== "ok") return [];
    const inAMob = new Set(load.members.filter((m) => m.leftOn === null).map((m) => m.animalId));
    return onFarm.filter((a) => !inAMob.has(a.id));
  }, [load, onFarm]);

  const startNew = () => {
    setEditing("new");
    setName("");
    setSpecies("cattle");
    setKlass("mixed");
    setNotes("");
    setActive(true);
  };

  const startEdit = (g: GrazingGroup) => {
    setEditing(g.id);
    setName(g.name);
    setSpecies(g.species ?? "cattle");
    setKlass(g.class ?? "mixed");
    setNotes(g.notes ?? "");
    setActive(g.active);
  };

  const saveNow = () =>
    act(async () => {
      await saveGrazingGroup(farmId!, {
        id: editing === "new" ? null : editing,
        name,
        species: species || null,
        class: klass || null,
        // Left alone here on purpose: a typed head count overrides the roll,
        // and this page exists so the roll is right.
        headCountManual: null,
        avgWeightLbManual: null,
        active,
        notes: notes.trim() || null,
      });
      const wasNew = editing === "new";
      setEditing(null);
      return wasNew ? `${name.trim()} started. Add the animals below.` : "Saved.";
    });

  const addNow = (groupId: string) =>
    act(async () => {
      if (load.state !== "ok" || pick === "") return null;
      const who = load.animals.find((a) => a.id === pick);
      await addToGroup({
        farmId: farmId!,
        groupId,
        animalId: pick,
        joinedOn: today(),
        members: load.members,
      });
      setPick("");
      return `${who ? nameOf(who) : "The animal"} is in the mob.`;
    });

  const takeOut = (m: GrazingGroupMember, who: RealAnimal | undefined) =>
    act(async () => {
      await removeFromGroup(farmId!, m.id, today());
      return `${who ? nameOf(who) : "The animal"} is out of the mob as of today.`;
    });

  return (
    <OpsShell>
      <PageHeader
        eyebrow={business?.name ?? "Herd"}
        title="Mobs"
        actions={
          load.state === "ok" && editing === null ? (
            <Button onClick={startNew}>Start a mob</Button>
          ) : undefined
        }
      />

      {load.state === "loading" && <p className="grz-where">Loading…</p>}
      {load.state === "error" && (
        <div style={{ paddingTop: 8 }}>
          <Callout>{load.message}</Callout>
        </div>
      )}

      {error && (
        <div style={{ paddingTop: 8 }}>
          <Callout>{error}</Callout>
        </div>
      )}
      <SaveToast note={note} onDone={() => setNote(null)} />

      {load.state === "ok" && (
        <>
          <p className="grz-where">
            A mob is the group that moves together, and it is where head count and mob weight
            come from — the strip width on <Link to="/grazing/move">Move</Link> is downstream of
            this list. Weights are per animal, on each animal's record.
          </p>

          {editing !== null && (
            <div className="grz-form">
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Species</span>
                  <select value={species} onChange={(e) => setSpecies(e.target.value)} aria-label="Species">
                    <option value="cattle">Cattle</option>
                    <option value="sheep">Sheep</option>
                    <option value="goats">Goats</option>
                    <option value="horses">Horses</option>
                  </select>
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Class</span>
                  <select value={klass} onChange={(e) => setKlass(e.target.value)} aria-label="Class">
                    <option value="mixed">Mixed</option>
                    <option value="cows">Cows</option>
                    <option value="heifers">Heifers</option>
                    <option value="steers">Steers</option>
                    <option value="calves">Calves</option>
                  </select>
                </label>
              </div>
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Notes</span>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
                </label>
                <label className="grz-field mb-still">
                  <span className="eyebrow">Still running</span>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    aria-label="Still running"
                  />
                </label>
              </div>
              <p className="grz-optional">
                A mob that has been broken up goes to "not running" rather than being deleted —
                its past moves still name it, and a head count on a move from July has to keep
                making sense.
              </p>
              <div className="grz-form__actions">
                <Button disabled={busy} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button variant="filled" disabled={busy || name.trim() === ""} onClick={saveNow}>
                  {busy ? "Saving…" : editing === "new" ? "Start it" : "Save"}
                </Button>
              </div>
            </div>
          )}

          {load.groups.length === 0 && editing === null && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                No mob on file, so nothing can be moved. Start one, then put the animals in it.
              </Callout>
            </div>
          )}

          {load.groups.map((g) => {
            const mine = openMembers(g.id);
            const weighed = mobWeight(load.members, g.id, load.weights);
            return (
              <section key={g.id} className="mb-mob">
                <div className="section__head" style={{ margin: "24px 0 4px" }}>
                  <div className="serif" style={{ fontSize: 21 }}>
                    {g.name}
                    {!g.active && <span className="mb-off"> · not running</span>}
                  </div>
                  <button type="button" className="link-button mono mb-act" onClick={() => startEdit(g)}>
                    Edit
                  </button>
                </div>

                <p className="mb-tally mono">
                  {mine.length} head
                  {weighed.totalLb === null
                    ? " · nobody weighed"
                    : ` · ${Math.round(weighed.totalLb).toLocaleString()} lb`}
                  {weighed.missing > 0 && (
                    <span className="mb-missing">
                      {" "}
                      · {weighed.missing} unweighed
                    </span>
                  )}
                </p>

                {mine.length === 0 ? (
                  <p className="grz-optional">Nobody in this mob yet.</p>
                ) : (
                  <>
                    <GridRow cols={COLS} mobileCols={COLS_SM}>
                      <span className="eyebrow">Animal</span>
                      <span className="eyebrow hide-sm">Class</span>
                      <span className="eyebrow text-right">Last weight</span>
                      <span className="eyebrow" />
                    </GridRow>
                    {mine.map((m) => {
                      const who = load.animals.find((a) => a.id === m.animalId);
                      const wt = load.weights.get(m.animalId);
                      // The link below carries the ear tag, not the id:
                      // /animals/:tag is resolved with `.eq("ear_tag", …)`,
                      // so an id reaches the record page and matches nothing.
                      return (
                        <GridRow key={m.id} cols={COLS} mobileCols={COLS_SM} as="body">
                          <span>
                            {who ? (
                              <Link to={animalPath(who)}>{nameOf(who)}</Link>
                            ) : (
                              <span className="mb-missing">not on file</span>
                            )}
                          </span>
                          <span className="hide-sm mono" style={{ fontSize: 13 }}>
                            {who?.class ?? "—"}
                          </span>
                          <span className="mono text-right">
                            {wt === undefined ? (
                              <span className="mb-missing">—</span>
                            ) : (
                              `${wt.toLocaleString()} lb`
                            )}
                          </span>
                          <span className="text-right">
                            <button
                              type="button"
                              className="link-button mono mb-act"
                              disabled={busy}
                              onClick={() => takeOut(m, who)}
                            >
                              Take out
                            </button>
                          </span>
                        </GridRow>
                      );
                    })}
                  </>
                )}

                {weighed.missing > 0 && (
                  <p className="grz-warn">
                    {weighed.missing} of {mine.length} {weighed.missing === 1 ? "has" : "have"} no
                    weight on file, so the feed figures count only the {weighed.weighed} that{" "}
                    {weighed.weighed === 1 ? "does" : "do"}. Weights go on each animal's record.
                  </p>
                )}

                {adding === g.id ? (
                  <div className="grz-form__row" style={{ paddingTop: 12 }}>
                    <label className="grz-field grz-field--wide">
                      <span className="eyebrow">Who joins</span>
                      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Who joins">
                        <option value="">Pick an animal…</option>
                        {unassigned.map((a) => (
                          <option key={a.id} value={a.id}>
                            {nameOf(a)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grz-form__actions" style={{ paddingTop: 0 }}>
                      <Button disabled={busy} onClick={() => { setAdding(null); setPick(""); }}>
                        Done
                      </Button>
                      <Button variant="filled" disabled={busy || pick === ""} onClick={() => addNow(g.id)}>
                        {busy ? "Adding…" : "Add"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ paddingTop: 10 }}>
                    <Button disabled={busy} onClick={() => setAdding(g.id)}>
                      Add an animal
                    </Button>
                  </div>
                )}

                {adding === g.id && unassigned.length === 0 && (
                  <p className="grz-optional">
                    Everything on the farm is already in a mob. An animal can only be in one at a
                    time — take it out of the other one first.
                  </p>
                )}
              </section>
            );
          })}

          {load.groups.length > 0 && unassigned.length > 0 && (
            <p className="grz-optional" style={{ marginTop: 20 }}>
              On the farm and in no mob:{" "}
              {unassigned.map((a) => nameOf(a)).join(", ")}. Nothing counts them until they are in
              one.
            </p>
          )}
        </>
      )}
    </OpsShell>
  );
}
