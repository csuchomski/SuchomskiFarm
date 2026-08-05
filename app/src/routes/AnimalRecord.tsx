import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWorkspace } from "../lib/workspace";
import { Button, Callout, EarTag, Pill, StatTile } from "../components/ui";
import { AnimalForm } from "../components/herd/AnimalForm";
import {
  describeBreeding,
  fetchAnimalByTag,
  fetchAnimals,
  fetchBreedComposition,
  formatAge,
  type BreedShare,
  type RealAnimal,
} from "../lib/herd";
import "./animal-record.css";

type Fetch =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "notfound" }
  | {
      state: "ok";
      animal: RealAnimal;
      breeds: BreedShare[];
      dam: RealAnimal | null;
      sire: RealAnimal | null;
      herd: RealAnimal[];
    };

export default function AnimalRecord() {
  const { tag = "" } = useParams();
  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [editing, setEditing] = useState(false);
  const { farmId } = useWorkspace();

  useEffect(() => {
    let cancelled = false;
    setResult({ state: "loading" });

    (async () => {
      try {
        const animal = await fetchAnimalByTag(tag);
        if (cancelled) return;
        if (!animal) {
          setResult({ state: "notfound" });
          return;
        }

        // The herd is small enough that fetching all of it to resolve two
        // parents costs less than two more round trips.
        const [composition, all] = await Promise.all([fetchBreedComposition([animal.id]), fetchAnimals()]);
        if (cancelled) return;

        const byId = new Map(all.map((a) => [a.id, a]));
        setResult({
          state: "ok",
          animal,
          breeds: composition.get(animal.id) ?? [],
          dam: animal.dam_id ? (byId.get(animal.dam_id) ?? null) : null,
          sire: animal.sire_id ? (byId.get(animal.sire_id) ?? null) : null,
          herd: all,
        });
      } catch (err) {
        if (!cancelled) setResult({ state: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tag]);

  if (result.state === "loading") {
    return (
      <Frame title="…">
        <p style={{ padding: 48, color: "var(--ink-muted)" }}>Loading…</p>
      </Frame>
    );
  }

  if (result.state === "error") {
    return (
      <Frame title="Animal">
        <div style={{ padding: 48 }}>
          <p style={{ color: "var(--red)" }}>
            Couldn't load tag {tag}: {result.message}
          </p>
          <Link to="/animals">← back to Animals</Link>
        </div>
      </Frame>
    );
  }

  if (result.state === "notfound") {
    return (
      <Frame title="Animal">
        <div style={{ padding: 48 }}>
          <p style={{ marginBottom: 8 }}>No animal on tag {tag}.</p>
          <Link to="/animals">← back to Animals</Link>
        </div>
      </Frame>
    );
  }

  const { animal, breeds, dam, sire, herd } = result;
  const name = animal.barn_name ?? `Tag ${animal.ear_tag}`;
  const breeding = describeBreeding(breeds);

  return (
    <Frame title={name}>
      <div className="record-head">
        <div className="record-head__top">
          <div className="record-photo">
            <span className="eyebrow" style={{ fontSize: 10 }}>
              Photo
            </span>
          </div>
          <div className="record-head__id">
            <div className="serif record-head__name">{name}</div>
            <div className="record-head__meta">
              {breeding && (
                <>
                  <span>{breeding}</span>
                  <span>·</span>
                </>
              )}
              <span>{animal.sex}</span>
              <span>·</span>
              <span>born {new Date(`${animal.birth_date}T00:00:00`).toLocaleDateString()}</span>
              <span>·</span>
              <span>{formatAge(animal.birth_date)} old</span>
              <Pill variant="outline-green">{animal.class}</Pill>
              {animal.status !== "active" && <Pill variant="outline">{animal.status}</Pill>}
            </div>
          </div>
          <EarTag tag={animal.ear_tag} accent="herd" size="lg" />
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <Button disabled title="Treatments aren't built yet">
              Log treatment
            </Button>
            <Button variant="filled" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close" : "Edit"}
            </Button>
          </div>
        </div>

        <div className="record-head__stats">
          <StatTile size="md" value={animal.class} label="Class" />
          <StatTile size="md" value={animal.sex} label="Sex" />
          <StatTile size="md" value={formatAge(animal.birth_date)} label="Age" />
          <StatTile size="md" value={breeds.length || "—"} label="Breeds on file" />
        </div>
      </div>

      {editing && (
        <div style={{ padding: "24px 32px 0" }}>
          <AnimalForm
            animal={animal}
            herd={herd}
            farmId={farmId}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              setEditing(false);
              const byId = new Map(herd.map((a) => [a.id, a]));
              setResult({
                state: "ok",
                animal: updated,
                breeds,
                dam: updated.dam_id ? (byId.get(updated.dam_id) ?? null) : null,
                sire: updated.sire_id ? (byId.get(updated.sire_id) ?? null) : null,
                herd: herd.map((a) => (a.id === updated.id ? updated : a)),
              });
            }}
          />
        </div>
      )}

      <div className="record-body">
        <div>
          <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
            Breeding
          </div>
          {breeds.length > 0 ? (
            <div style={{ marginBottom: 24 }}>
              {breeds.map((b) => (
                <div className="breed-row" key={b.breedId}>
                  <span style={{ fontSize: 15 }}>{b.name}</span>
                  <div className="breed-row__bar">
                    <div className="breed-row__fill" style={{ width: `${Math.min(100, b.percent)}%` }} />
                  </div>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                    {b.percent}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 24 }}>
              No breed composition recorded for {name}.
            </p>
          )}

          {animal.notes && (
            <>
              <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
                Notes
              </div>
              <p className="text-wrap-pretty" style={{ fontSize: 15, marginBottom: 24 }}>
                {animal.notes}
              </p>
            </>
          )}

          {/* Milk, health and cost are one note rather than four empty
              sections: lactations, test_days, treatments and cost_entries
              are all empty, so a section each would be four identical boxes
              saying nothing. */}
          <Callout>
            Milk, health and cost history aren't shown — the lactation, treatment and per-animal cost tables have
            no rows yet. They'll appear here once they do.
          </Callout>
        </div>

        <div>
          <div className="serif" style={{ fontSize: 21, margin: "0 0 12px" }}>
            Pedigree
          </div>
          <div className="pedigree-grid">
            <ParentCell label="Dam" parent={dam} recorded={Boolean(animal.dam_id)} />
            <ParentCell label="Sire" parent={sire} recorded={Boolean(animal.sire_id)} />
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** Three states worth distinguishing: no parent on file, a parent on file
 * that isn't in this herd, and one you can click through to. */
function ParentCell({ label, parent, recorded }: { label: string; parent: RealAnimal | null; recorded: boolean }) {
  return (
    <div className={`pedigree-cell ${recorded ? "" : "pedigree-cell--unknown"}`}>
      <div className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </div>
      {parent ? (
        <>
          <Link to={`/animals/${parent.ear_tag}`} className="serif" style={{ fontSize: 15, color: "var(--ink)" }}>
            {parent.barn_name ?? `Tag ${parent.ear_tag}`}
          </Link>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
            tag {parent.ear_tag}
          </div>
        </>
      ) : (
        <>
          <div className="serif" style={{ fontSize: 15, color: "var(--ink-muted)" }}>
            {recorded ? "Outside the herd" : "Not recorded"}
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
            {recorded ? "id on file, no record" : "no id on file"}
          </div>
        </>
      )}
    </div>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--paper)", minHeight: "100vh" }}>
      <div className="record-topbar">
        <Link to="/animals" className="serif" style={{ fontSize: 22, letterSpacing: "-.02em", color: "var(--ink)" }}>
          Suchomski<span style={{ color: "var(--herd-green)" }}>.</span>
        </Link>
        <div className="eyebrow">Herd · Animals · {title}</div>
      </div>
      {children}
    </div>
  );
}
