import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, EarTag, GridRow, Pill } from "../components/ui";
import {
  describeBreeding,
  fetchAnimals,
  fetchBreedComposition,
  formatAge,
  herdOnly,
  isMilked,
  type BreedShare,
  type RealAnimal,
} from "../lib/herd";
import { AnimalForm } from "../components/herd/AnimalForm";
import { useWorkspace } from "../lib/workspace";
import "./animals.css";

type Fetch =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; rows: RealAnimal[]; breeds: Map<string, BreedShare[]> };

type SortKey = "name" | "tag" | "age" | "class";

const COLS = "60px 1fr 110px 110px 96px";
/** Class and age go on a phone: class is already repeated under the name,
 *  and age is reference rather than something you scan a list for. */
const COLS_SM = "44px 1fr 84px";

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
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await fetchAnimals();
      const breeds = await fetchBreedComposition(rows.map((r) => r.id));
      if (!cancelled) setResult({ state: "ok", rows, breeds });
    })().catch(
      (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // `rows` is everything fetched, including reference bulls — the add/edit
  // form needs them so a calf can be given an AI sire. The list itself shows
  // only the animals that live here; a catalogue bull isn't livestock and
  // would overstate every count on the page.
  const rows = result.state === "ok" ? result.rows : EMPTY_ANIMALS;
  const all = useMemo(() => herdOnly(rows), [rows]);
  const breeds = result.state === "ok" ? result.breeds : EMPTY_BREEDS;

  // Classes come from the data, so a class nobody anticipated still gets a
  // filter rather than being invisible.
  const classes = useMemo(() => [...new Set(all.map((a) => a.class))].sort(), [all]);
  const inactiveCount = all.filter((a) => a.status !== "active").length;
  const dairyCount = all.filter(isMilked).length;
  const beefCount = all.length - dairyCount;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = all.filter((a) => {
      if (!showInactive && a.status !== "active") return false;
      if (classFilter !== "all" && a.class !== classFilter) return false;
      if (purposeFilter === "dairy" && !isMilked(a)) return false;
      if (purposeFilter === "beef" && isMilked(a)) return false;
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
  }, [all, breeds, query, classFilter, purposeFilter, showInactive, sort]);

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          result.state === "ok"
            ? `${all.length} on file · ${dairyCount} dairy · ${beefCount} beef · ${all.length - inactiveCount} active`
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
            onSaved={(saved) => {
              setAdding(false);
              // Straight to the new animal's record — the next thing you
              // want after adding one is usually to fill in the rest.
              navigate(`/animals/${saved.ear_tag}`);
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

        {inactiveCount > 0 && (
          <label className="animals-toggle">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Show {inactiveCount} inactive</span>
          </label>
        )}
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
            <span>Status</span>
            <span className="text-right hide-sm">Age</span>
          </GridRow>

          {visible.map((a) => (
            <Link key={a.id} to={`/animals/${a.ear_tag}`} style={{ color: "inherit", display: "contents" }}>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="body" highlight={a.status !== "active"}>
                <EarTag tag={a.ear_tag} accent="herd" />
                <span>
                  <span className="serif" style={{ fontSize: 17 }}>
                    {nameOf(a)}
                  </span>
                  <br />
                  <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                    {[describeBreeding(breeds.get(a.id)), a.sex, a.purpose].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="hide-sm" style={{ fontSize: 13 }}>{a.class}</span>
                <span>
                  <Pill variant={a.status === "active" ? "outline-green" : "outline"}>{a.status}</Pill>
                </span>
                <span className="mono text-right hide-sm" style={{ fontSize: 15 }}>
                  {formatAge(a.birth_date)}
                </span>
              </GridRow>
            </Link>
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

          {visible.length > 0 && visible.length !== all.length && (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
              Showing {visible.length} of {all.length}.
            </p>
          )}
        </>
      )}
    </OpsShell>
  );
}

// Stable references, so the memos below aren't invalidated every render by
// a fresh empty literal.
const EMPTY_ANIMALS: RealAnimal[] = [];
const EMPTY_BREEDS: Map<string, BreedShare[]> = new Map();

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
