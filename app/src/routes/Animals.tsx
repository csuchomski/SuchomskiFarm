import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, EarTag, GridRow, Pill } from "../components/ui";
import {
  animalPath,
  describeBreeding,
  fetchAnimals,
  fetchBreedComposition,
  formatAge,
  herdOnly,
  isDairy,
  type BreedShare,
  type RealAnimal,
} from "../lib/herd";
import { AnimalForm } from "../components/herd/AnimalForm";
import { breedingCell, fetchAlertInputs, statusOf, type AlertInputs } from "../lib/alerts";
import {
  fetchGrazingGroups,
  fetchGroupMembers,
  setAnimalMob,
  type GrazingGroup,
  type GrazingGroupMember,
} from "../lib/grazing";
import { useWorkspace } from "../lib/workspace";
import "./animals.css";

type Fetch =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      rows: RealAnimal[];
      breeds: Map<string, BreedShare[]>;
      repro: AlertInputs | null;
      mobs: GrazingGroup[];
      members: GrazingGroupMember[];
    };

type SortKey = "name" | "tag" | "age" | "class";

/** Status moved into the name cell as a pill, which freed its column for the
 *  one figure this page was missing — when each cow should next be bred. */
const COLS = "60px minmax(0, 1fr) 96px 150px 84px";
/** Class and age go on a phone: class is already repeated under the name, and
 *  age is reference rather than something you scan a list for. The breeding
 *  date stays — it is the reason to open this page in the morning. */
const COLS_SM = "44px minmax(0, 1fr) 96px";

export default function Animals() {
  const navigate = useNavigate();
  const { farmId } = useWorkspace();
  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  // Beef and dairy are run as two herds even though they share a barn: one is
  // milked and one raises its calves, and almost nothing that applies to one
  // applies to the other.
  const [purposeFilter, setPurposeFilter] = useState<"all" | "dairy" | "beef">("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [nonce, setNonce] = useState(0);
  /** The animal under the cursor, and any error a move came back with. */
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  /** Which heading has its picker open — a mob's id, or "loose". */
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchAnimals();
      const breeds = await fetchBreedComposition(rows.map((r) => r.id));
      // The breeding column needs her whole repro record. Null when there is
      // no farm — the column then reads "—" rather than the page failing.
      const repro = farmId ? await fetchAlertInputs(farmId, new Date().toISOString().slice(0, 10)) : null;
      // The mob is the unit the farm actually works in — what gets moved, what
      // gets counted at the gate — so it is what this list is grouped by.
      const [mobs, members] = farmId
        ? await Promise.all([fetchGrazingGroups(farmId), fetchGroupMembers(farmId)])
        : [[] as GrazingGroup[], [] as GrazingGroupMember[]];
      if (!cancelled) setResult({ state: "ok", rows, breeds, repro, mobs, members });
    })().catch(
      (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [farmId, nonce]);

  // `rows` is everything fetched, including reference bulls — the add/edit
  // form needs them so a calf can be given an AI sire. The list itself shows
  // only the animals that live here; a catalogue bull isn't livestock and
  // would overstate every count on the page.
  const rows = result.state === "ok" ? result.rows : EMPTY_ANIMALS;
  const all = useMemo(() => herdOnly(rows), [rows]);
  const breeds = result.state === "ok" ? result.breeds : EMPTY_BREEDS;
  const repro = result.state === "ok" ? result.repro : null;
  const mobs = result.state === "ok" ? result.mobs : EMPTY_MOBS;
  const members = result.state === "ok" ? result.members : EMPTY_MEMBERS;

  /** Which mob each animal is in now. A closed membership is history. */
  const mobOf = useMemo(() => {
    const by = new Map<string, string>();
    for (const m of members) if (m.leftOn === null) by.set(m.animalId, m.groupId);
    return by;
  }, [members]);

  // Classes come from the data, so a class nobody anticipated still gets a
  // filter rather than being invisible.
  const classes = useMemo(() => [...new Set(all.map((a) => a.class))].sort(), [all]);
  // Counted over the animals on the farm, because those are the ones this
  // page shows. Counting the ones that have left as well left the heading
  // saying five over a list of four.
  const onFarm = useMemo(() => all.filter((a) => a.status === "active"), [all]);
  const goneCount = all.length - onFarm.length;
  const dairyCount = onFarm.filter(isDairy).length;
  const beefCount = onFarm.length - dairyCount;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = all.filter((a) => {
      // Animals that have left the farm are off this list. It is the list of
      // the herd, and they are not the herd any more — a heading of them
      // under the mobs was one more thing to scroll past every time.
      //
      // A search is the way back to one: typing a name is asking for that
      // animal in particular, which is a different act from opening the page.
      if (a.status !== "active" && q === "") return false;
      if (classFilter !== "all" && a.class !== classFilter) return false;
      if (purposeFilter === "dairy" && !isDairy(a)) return false;
      if (purposeFilter === "beef" && isDairy(a)) return false;
      if (!q) return true;
      const breeding = describeBreeding(breeds.get(a.id)) ?? "";
      return [a.barn_name ?? "", a.ear_tag, a.class, a.sex, a.purpose, a.status, breeding, a.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "tag":
          return compareTags(a.ear_tag, b.ear_tag);
        case "age":
          return a.birth_date.localeCompare(b.birth_date); // oldest first
        case "class":
          return a.class.localeCompare(b.class) || nameOf(a).localeCompare(nameOf(b));
        default:
          return nameOf(a).localeCompare(nameOf(b));
      }
    });
  }, [all, breeds, query, classFilter, purposeFilter, sort]);

  // The two sides of the herd, as sections rather than as a filter that hides
  // one of them. `isDairy` is the same predicate the chips, the counts and
  // the lactation pages use, so a dual-purpose cow lands under Dairy on every
  // screen — and her row still says "dual".
  const moveToMob = async (animalId: string, groupId: string | null) => {
    if (!farmId) return;
    setDragging(null);
    setMoveError(null);
    try {
      await setAnimalMob(farmId, animalId, groupId);
      setNonce((n) => n + 1);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : String(err));
    }
  };

  const sides = (rows: RealAnimal[]) => {
    const dairy = rows.filter(isDairy);
    const beef = rows.filter((a) => !isDairy(a));
    return [
      {
        key: "dairy",
        label: "Dairy",
        rows: dairy,
        note: dairy.some((a) => a.purpose === "dual") ? "milked, including dual-purpose" : "milked",
      },
      { key: "beef", label: "Beef", rows: beef, note: "raising their calves" },
    ].filter((g) => g.rows.length > 0);
  };

  /**
   * Mob first, then the two sides of the herd inside it.
   *
   * The mob is what the farm works in — the thing that gets moved and counted
   * at the gate — so it is the outer heading. Dairy and beef stay, because a
   * milked cow and a suckler are run differently whichever mob they are in,
   * but they are now a division *within* a mob rather than the whole shape of
   * the page.
   *
   * **Every working mob is headed, empty or not, and "Not in a mob" is always
   * the last heading once the farm has one.** A heading is a place to put an
   * animal, not just a label over rows that are already there: without the
   * empty one a mob just made has nothing to drag into, and without the loose
   * one there is no way to take an animal out of a mob at all. That was the
   * hole — a farm could put animals into mobs and never get them back out.
   *
   * A mob that has been retired is headed only while somebody is still in it,
   * and takes no drops. Its members can be dragged out; nobody can be dragged
   * in.
   */
  const groups = useMemo(() => {
    // An animal that has left the farm is not in a mob and is not waiting to
    // be put in one, so it takes no part in this grouping at all. It used to
    // fall through to "Not in a mob" — a heading that means "needs
    // assigning", takes drops, and offers a picker — which invited somebody
    // to drag a processed bull calf onto next week's grazing.
    const here = visible.filter((a) => a.status === "active");
    const gone = visible.filter((a) => a.status !== "active");

    const byMob = new Map<string, RealAnimal[]>();
    for (const a of here) {
      const key = mobOf.get(a.id) ?? "";
      const list = byMob.get(key);
      if (list) list.push(a);
      else byMob.set(key, [a]);
    }
    const named = mobs
      .filter((m) => m.active || (byMob.get(m.id)?.length ?? 0) > 0)
      .map((m) => ({
        mobId: m.id as string | null,
        mobName: m.name,
        target: m.active,
        rows: byMob.get(m.id) ?? [],
      }));
    const loose = byMob.get("") ?? [];
    const anyMob = mobs.some((m) => m.active);
    return [
      ...named,
      ...(anyMob || loose.length > 0
        ? [{ mobId: null, mobName: "Not in a mob", target: true, rows: loose }]
        : []),
      // Last, and only when something is actually there — this appears when
      // "Show inactive" is ticked or a search turns one up, and never
      // otherwise. `target: false` keeps it inert: no drop, no picker.
      ...(gone.length > 0
        ? [{ mobId: "gone" as string | null, mobName: "Off the farm", target: false, rows: gone }]
        : []),
    ].map((g) => ({
      ...g,
      gone: g.mobId === "gone",
      // No dairy/beef split on the ones that have gone: "milked" over a dead
      // cow is a sentence about something she is not doing. One nameless
      // side renders the rows with no heading over them.
      sides:
        g.mobId === "gone"
          ? [{ key: "gone", label: "", rows: g.rows, note: "" }]
          : sides(g.rows),
    }));
  }, [visible, mobs, mobOf]);

  /** A heading earns its place once there is more than one thing to head. A
   *  farm with no mobs at all reads as this list always did. */
  const showMobs = groups.length > 1;
  /** One mob is enough: an animal can be dragged into it, and back out of it
   *  onto "Not in a mob". */
  const canDrag = mobs.some((m) => m.active);

  /**
   * Who a heading could take, for the pointer-free way of doing this.
   *
   * Drag and drop is the quick way and it needs a pointer, which a phone in
   * the barn does not have. Every heading that takes a drop also carries a
   * picker that does the same job by tap — including "Not in a mob", where
   * picking somebody takes her out.
   *
   * Offered from the whole herd rather than from what the filters left on
   * screen: this is an explicit choice by name, and hiding half the herd
   * behind a search box somebody forgot to clear would make it look like
   * animals had gone missing.
   */
  const candidatesFor = (mobId: string | null) =>
    all
      .filter((a) => a.status === "active")
      .filter((a) => (mobId === null ? mobOf.has(a.id) : mobOf.get(a.id) !== mobId))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const mobNameOf = (animalId: string) => {
    const id = mobOf.get(animalId);
    return id === undefined ? "not in a mob" : (mobs.find((m) => m.id === id)?.name ?? "another mob");
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          result.state === "ok"
            ? `${onFarm.length} on the farm · ${dairyCount} dairy · ${beefCount} beef${
                goneCount > 0 ? ` · ${goneCount} ${goneCount === 1 ? "has" : "have"} left` : ""
              }`
            : "Herd"
        }
        title="Animals"
        actions={
          <Button variant="filled" onClick={() => setAdding((v) => !v)} disabled={result.state !== "ok"}>
            {adding ? "Cancel" : "Add animal"}
          </Button>
        }
      />

      {adding && result.state === "ok" && (
        <div style={{ paddingTop: 16 }}>
          <AnimalForm
            herd={rows}
            farmId={farmId}
            onCancel={() => setAdding(false)}
            mobs={mobs}
            onSaved={(saved) => {
              setAdding(false);
              // Straight to the new animal's record — the next thing you
              // want after adding one is usually to fill in the rest.
              navigate(animalPath(saved));
            }}
          />
        </div>
      )}

      <div className="animals-controls">
        <input
          className="animals-search"
          placeholder="Search name, tag, breed, notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search animals"
        />

        <div className="animals-filters">
          <FilterChip active={purposeFilter === "all"} onClick={() => setPurposeFilter("all")}>
            Whole herd
          </FilterChip>
          <FilterChip active={purposeFilter === "dairy"} onClick={() => setPurposeFilter("dairy")}>
            Dairy · {dairyCount}
          </FilterChip>
          <FilterChip active={purposeFilter === "beef"} onClick={() => setPurposeFilter("beef")}>
            Beef · {beefCount}
          </FilterChip>
          <span className="animals-filters__split" aria-hidden="true" />
          <FilterChip active={classFilter === "all"} onClick={() => setClassFilter("all")}>
            All
          </FilterChip>
          {classes.map((c) => (
            <FilterChip key={c} active={classFilter === c} onClick={() => setClassFilter(c)}>
              {c}
            </FilterChip>
          ))}
        </div>

        <select
          className="animals-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
        >
          <option value="name">Sort: name</option>
          <option value="tag">Sort: tag</option>
          <option value="age">Sort: oldest first</option>
          <option value="class">Sort: class</option>
        </select>

      </div>

      {result.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading herd…</p>
      )}
      {result.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load the herd: {result.message}
        </p>
      )}

      {result.state === "ok" && (
        <>
          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>Tag</span>
            <span>Animal</span>
            <span className="hide-sm">Class</span>
            <span>Next breeding</span>
            <span className="text-right hide-sm">Age</span>
          </GridRow>

          {canDrag && (
            <p className="animals-drag-note">
              {/* Neutral, because this page lists steers and bulls too — and
                  two sentences rather than one, because the mono words read
                  as labels on controls and a semicolon between them made the
                  whole thing look like a fragment. */}
              <span className="mono">add</span> on a mob puts an animal in it.{" "}
              <span className="mono">take one out</span> removes one from its mob. With a mouse, drag
              a row onto a heading instead.
            </p>
          )}

          {moveError !== null && <p className="animals-move-error">{moveError}</p>}

          {groups.map((group) => (
            <Fragment key={group.mobId ?? "loose"}>
              {/* The mob heading is also where a dragged animal is dropped.
                  Dropping is the quick way; the slow way — editing the animal
                  and picking a mob — is still there, and is the one that works
                  without a pointer. */}
              {showMobs && (
                <div
                  className={`animals-mob${group.gone ? " animals-mob--gone" : ""} ${
                    over === (group.mobId ?? "loose") ? "animals-mob--over" : ""
                  }`}
                  onDragOver={(e) => {
                    if (dragging === null || !group.target) return;
                    e.preventDefault();
                    setOver(group.mobId ?? "loose");
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    if (dragging !== null && group.target) void moveToMob(dragging, group.mobId);
                  }}
                >
                  <span className="serif animals-mob__name">{group.mobName}</span>
                  <span className="mono animals-mob__count">{group.rows.length}</span>
                  {/* Only while something is in the air. Repeated on every
                      heading it was three copies of the same sentence, which
                      is how a page starts reading like a manual. */}
                  {dragging !== null && group.target && (
                    <span className="animals-mob__hint">
                      {group.mobId === null ? "drop to take out of a mob" : "drop to move here"}
                    </span>
                  )}

                  {group.target && dragging === null && (
                    <MobPicker
                      open={picking === (group.mobId ?? "loose")}
                      loose={group.mobId === null}
                      mobName={group.mobName}
                      candidates={candidatesFor(group.mobId)}
                      whereIsShe={mobNameOf}
                      onOpen={() => setPicking(group.mobId ?? "loose")}
                      onClose={() => setPicking(null)}
                      onPick={(animalId) => {
                        setPicking(null);
                        void moveToMob(animalId, group.mobId);
                      }}
                    />
                  )}
                </div>
              )}

              {group.sides.map((side) => (
                <Fragment key={side.key}>
                  {/* Only when both sides are on screen. One heading over the
                      whole list would be labelling something the chips above
                      already said. */}
                  {group.sides.length > 1 && (
                    <div className="animals-group">
                      <span className="serif animals-group__name">{side.label}</span>
                      <span className="mono animals-group__count">{side.rows.length}</span>
                      <span className="animals-group__note">{side.note}</span>
                    </div>
                  )}
              {side.rows.map((a) => (
                <Link
                  key={a.id}
                  to={animalPath(a)}
                  style={{ color: "inherit", display: "contents" }}
                  draggable={canDrag}
                  onDragStart={(e) => {
                    // A link drags its URL by default, which drops as a
                    // navigation rather than a move.
                    e.dataTransfer.setData("text/plain", a.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(a.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <GridRow cols={COLS} mobileCols={COLS_SM} as="body" highlight={a.status !== "active"}>
                    <EarTag tag={a.ear_tag} accent="herd" />
                    <span style={{ minWidth: 0 }}>
                      <span className="serif" style={{ fontSize: 17 }}>
                        {nameOf(a)}
                      </span>
                      {/* The status moved here from a column of its own. It is
                          "active" for almost every row, so a whole column spent
                          saying so was the least useful width on the page. */}
                      {a.status !== "active" && (
                        <>
                          {" "}
                          <Pill variant="outline">{a.status}</Pill>
                        </>
                      )}
                      <br />
                      <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {[describeBreeding(breeds.get(a.id)), a.sex, a.purpose].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="hide-sm" style={{ fontSize: 13 }}>{a.class}</span>
                    <NextBreeding animal={a} repro={repro} />
                    <span className="mono text-right hide-sm" style={{ fontSize: 15 }}>
                      {formatAge(a.birth_date)}
                    </span>
                  </GridRow>
                </Link>
              ))}
                </Fragment>
              ))}
            </Fragment>
          ))}

          {visible.length === 0 && (
            <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>
              {all.length === 0
                ? "No animals recorded yet."
                : `Nothing matches${query ? ` "${query}"` : ""}${classFilter !== "all" ? ` in ${classFilter}` : ""}${
                    purposeFilter !== "all" ? ` on the ${purposeFilter} side` : ""
                  }.`}
            </p>
          )}

          {/* Counted against the farm, not the file. Against the file it said
              "showing 4 of 5" on an unfiltered page for ever, because one
              animal has left — which reads as something being hidden by a
              filter nobody set. The heading already says how many have. */}
          {visible.length > 0 && visible.length !== onFarm.length && (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
              Showing {visible.length} of {onFarm.length}.
            </p>
          )}
        </>
      )}
    </OpsShell>
  );
}

/**
 * The tap way into and out of a mob.
 *
 * Sits on the mob heading, which is also the drop target, so both ways of
 * doing it are in the same place. On "Not in a mob" it reads the other
 * direction — picking somebody there takes her out of whatever mob she is in.
 *
 * Each candidate says where she is now. Moving a cow out of the wrong mob is
 * the mistake this page can make, and the name on its own does not say which
 * mob she is coming from.
 */
function MobPicker({
  open, loose, mobName, candidates, whereIsShe, onOpen, onClose, onPick,
}: {
  open: boolean;
  loose: boolean;
  mobName: string;
  candidates: RealAnimal[];
  whereIsShe: (animalId: string) => string;
  onOpen: () => void;
  onClose: () => void;
  onPick: (animalId: string) => void;
}) {
  if (!open) {
    if (candidates.length === 0) return null;
    return (
      <span className="animals-mob__act">
        <button
          type="button"
          className="link-button mono"
          aria-label={loose ? "take an animal out of its mob" : `add an animal to ${mobName}`}
          onClick={onOpen}
        >
          {loose ? "take one out" : "add"}
        </button>
      </span>
    );
  }

  return (
    <span className="animals-mob__act">
      <select
        className="animals-mob__pick"
        aria-label={loose ? "Take an animal out of its mob" : `Add an animal to ${mobName}`}
        value=""
        onChange={(e) => e.target.value !== "" && onPick(e.target.value)}
      >
        <option value="">Which one…</option>
        {candidates.map((a) => (
          <option key={a.id} value={a.id}>
            {nameOf(a)} · {whereIsShe(a.id)}
          </option>
        ))}
      </select>
      <button type="button" className="link-button mono" onClick={onClose}>
        cancel
      </button>
    </span>
  );
}

/**
 * When she should next be bred — her calving plus the farm's voluntary
 * waiting period, or what she's doing instead. Blank for anyone the question
 * doesn't apply to: bulls, calves, and heifers who have never calved, where a
 * date would be a recommendation nobody made.
 */
function NextBreeding({ animal, repro }: { animal: RealAnimal; repro: AlertInputs | null }) {
  const applies = animal.sex === "female" && animal.class !== "calf" && animal.status === "active";
  if (!repro || !applies) {
    return <span className="mono" style={{ fontSize: 13, color: "var(--ink-faint)" }}>—</span>;
  }
  const cell = breedingCell(statusOf(animal, repro).breeding);
  return (
    <span style={{ minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 13, color: cell.accent ? "var(--herd-green)" : "var(--ink)" }}>
        {cell.value}
      </span>
      {cell.note && (
        <>
          <br />
          <span style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{cell.note}</span>
        </>
      )}
    </span>
  );
}

// Stable references, so the memos below aren't invalidated every render by
// a fresh empty literal.
const EMPTY_ANIMALS: RealAnimal[] = [];
const EMPTY_BREEDS: Map<string, BreedShare[]> = new Map();
const EMPTY_MOBS: GrazingGroup[] = [];
const EMPTY_MEMBERS: GrazingGroupMember[] = [];

function nameOf(a: RealAnimal) {
  return a.barn_name ?? `Tag ${a.ear_tag}`;
}

/** Ear tags are text in the schema but numeric in practice, so "10" should
 * sort after "9" rather than before it. */
export function compareTags(a: string, b: string) {
  const na = Number(a);
  const nb = Number(b);
  if (a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={`animals-chip ${active ? "animals-chip--active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}
