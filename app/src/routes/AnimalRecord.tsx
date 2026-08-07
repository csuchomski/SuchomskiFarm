import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWorkspace } from "../lib/workspace";
import { LactationSection } from "../components/herd/LactationSection";
import { Button, Callout, EarTag, Pill, StatTile } from "../components/ui";
import { AnimalForm } from "../components/herd/AnimalForm";
import { Pedigree } from "../components/herd/Pedigree";
import { OffspringEditor } from "../components/herd/OffspringEditor";
import { GeneticsSection } from "../components/herd/GeneticsSection";
import { BreedEditor } from "../components/herd/BreedEditor";
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
      /** Composition for the whole herd, so the pedigree can label ancestors. */
      allBreeds: Map<string, BreedShare[]>;
      dam: RealAnimal | null;
      herd: RealAnimal[];
    };

export default function AnimalRecord() {
  const { tag = "" } = useParams();
  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [editingBreeds, setEditingBreeds] = useState(false);
  // Bumped after a breed edit to re-run the fetch below. Composition is
  // written as a delete-then-insert, so the ids change and there's no saved
  // row to merge into state — a re-read is the honest way to show the result.
  const [reloadKey, setReloadKey] = useState(0);
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

        // The herd is small enough to fetch whole — it resolves parents,
        // offspring and every ancestor in the chart from one read.
        const all = await fetchAnimals();
        const composition = await fetchBreedComposition(all.map((a) => a.id));
        if (cancelled) return;

        const byId = new Map(all.map((a) => [a.id, a]));
        setResult({
          state: "ok",
          animal,
          breeds: composition.get(animal.id) ?? [],
          allBreeds: composition,
          dam: animal.dam_id ? (byId.get(animal.dam_id) ?? null) : null,
          herd: all,
        });
      } catch (err) {
        if (!cancelled) setResult({ state: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tag, reloadKey]);

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

  const { animal, breeds, allBreeds, dam, herd } = result;
  const name = animal.barn_name ?? `Tag ${animal.ear_tag}`;
  const breeding = describeBreeding(breeds);

  // Both directions of the pedigree come from the same herd fetch, so these
  // cost nothing extra.
  const offspring = herd
    .filter((a) => a.dam_id === animal.id || a.sire_id === animal.id)
    .sort((a, b) => b.birth_date.localeCompare(a.birth_date)); // newest first

  const siblings = animal.dam_id
    ? herd
        .filter((a) => a.id !== animal.id && a.dam_id === animal.dam_id)
        .sort((a, b) => b.birth_date.localeCompare(a.birth_date))
    : [];

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
              const nextHerd = herd.map((a) => (a.id === updated.id ? updated : a));
              const byId = new Map(nextHerd.map((a) => [a.id, a]));
              setResult({
                state: "ok",
                animal: updated,
                breeds,
                allBreeds,
                dam: updated.dam_id ? (byId.get(updated.dam_id) ?? null) : null,
                herd: nextHerd,
              });
            }}
          />
        </div>
      )}

      <div className="record-body">
        <div>
          <div className="section__head" style={{ marginBottom: 12 }}>
            <div className="serif" style={{ fontSize: 21 }}>
              Breeding
            </div>
            {farmId && !editingBreeds && (
              <button type="button" className="link-button mono" onClick={() => setEditingBreeds(true)}>
                {breeds.length > 0 ? "edit" : "+ Record composition"}
              </button>
            )}
          </div>

          {editingBreeds && (
            <div style={{ marginBottom: 24 }}>
              <BreedEditor
                animalId={animal.id}
                farmId={farmId}
                current={breeds.map((b) => ({ breedId: b.breedId, percent: b.percent }))}
                onCancel={() => setEditingBreeds(false)}
                onSaved={() => {
                  setEditingBreeds(false);
                  setReloadKey((k) => k + 1);
                }}
              />
            </div>
          )}

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
            !editingBreeds && (
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 24 }}>
                No breed composition recorded for {name}.
              </p>
            )
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

          {/* Lactations are real now. Treatments and per-animal costs are
              still empty, so they stay a single note rather than two boxes
              that can only say the same thing. */}
          <LactationSection
            animalId={animal.id}
            farmId={farmId}
            canWrite={animal.sex === "female" && animal.class !== "calf"}
          />

          <GeneticsSection animalId={animal.id} farmId={farmId} />

          <div style={{ marginTop: 24 }}>
            <Callout>
              Health and cost history aren't shown — the treatment and per-animal cost tables have no rows yet.
              They'll appear here once they do.
            </Callout>
          </div>
        </div>

        <div>
          <div className="serif" style={{ fontSize: 21, margin: "0 0 12px" }}>
            Pedigree
          </div>
          <Pedigree animal={animal} herd={herd} breeds={allBreeds} />

          <div className="section__head" style={{ margin: "24px 0 12px" }}>
            <div className="serif" style={{ fontSize: 21 }}>
              Offspring
              {offspring.length > 0 && (
                <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}> · {offspring.length}</span>
              )}
            </div>
            <button type="button" className="link-button mono" onClick={() => setLinking((v) => !v)}>
              {linking ? "Cancel" : "+ Record one"}
            </button>
          </div>

          {linking && (
            <OffspringEditor
              parent={animal}
              herd={herd}
              farmId={farmId}
              onClose={() => setLinking(false)}
              onChanged={(child) =>
                setResult({ ...result, herd: herd.map((a) => (a.id === child.id ? child : a)) })
              }
              onCreated={(child) => setResult({ ...result, herd: [...herd, child] })}
            />
          )}
          {offspring.length > 0 ? (
            offspring.map((child) => (
              <RelativeRow
                key={child.id}
                animal={child}
                note={child.dam_id === animal.id ? "out of" : "by"}
              />
            ))
          ) : (
            <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
              No offspring recorded — nothing in the herd lists {name} as a parent.
            </p>
          )}

          {siblings.length > 0 && (
            <>
              <div className="serif" style={{ fontSize: 21, margin: "24px 0 12px" }}>
                Out of the same dam
                <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}> · {siblings.length}</span>
              </div>
              {siblings.map((s) => (
                <RelativeRow key={s.id} animal={s} note={dam?.barn_name || `tag ${dam?.ear_tag}`} />
              ))}
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}

/** A related animal, linked. Same shape for offspring and siblings so the
 * two lists read as one idea rather than two designs. */
function RelativeRow({ animal, note }: { animal: RealAnimal; note: string }) {
  return (
    <Link to={`/animals/${animal.ear_tag}`} className="relative-row">
      <EarTag tag={animal.ear_tag} accent="herd" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="serif" style={{ fontSize: 15 }}>
          {animal.barn_name || `Tag ${animal.ear_tag}`}
        </span>
        <br />
        <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
          {note} · {animal.class} · {formatAge(animal.birth_date)}
        </span>
      </span>
    </Link>
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
