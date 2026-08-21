import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWorkspace } from "../lib/workspace";
import { TabbedSections, type Section } from "../components/shell/TabbedSections";
import { LifeTimeline } from "../components/herd/LifeTimeline";
import { MilkSection } from "../components/herd/MilkSection";
import { buildLife, daysBetween, lifeDate, type LifeEvent } from "../lib/animal-life";
import { fetchLactations } from "../lib/lactations";
import { fetchCalvings } from "../lib/repro";
import { fetchBreedings } from "../lib/breedings";
import { fetchWeighings, type Weighing } from "../lib/grazing";
import { todayLocal } from "../lib/local-time";
import { LactationSection } from "../components/herd/LactationSection";
import { Button, Callout, EarTag, Pill, StatTile } from "../components/ui";
import { AnimalForm } from "../components/herd/AnimalForm";
import { Pedigree } from "../components/herd/Pedigree";
import { OffspringEditor } from "../components/herd/OffspringEditor";
import { GeneticsSection } from "../components/herd/GeneticsSection";
import { MoneySection } from "../components/herd/MoneySection";
import { ValueSection } from "../components/herd/ValueSection";
import { WeightSection } from "../components/herd/WeightSection";
import { isSire } from "../lib/sires";
import { BreedEditor } from "../components/herd/BreedEditor";
import {
  describeBreeding,
  fetchAnimalByTag,
  fetchAnimals,
  fetchBreedComposition,
  formatAge,
  isMilked,
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
      /** Her calvings, lactations and services, already in order. Empty on a
       *  business with no farm, where none of the three tables can be read. */
      life: LifeEvent[];
      /** Her last weighing, for the tile. Null when she has never been on a
       *  scale, which is most of a beef herd. */
      weight: Weighing | null;
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
  const { farmId, business } = useWorkspace();
  const businessId = business?.id ?? null;

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

        // Three reads for the life. A farm is needed for all of them, and a
        // failure in any one leaves the timeline empty rather than taking
        // the whole page down — the rest of her record still reads.
        const [calvings, lactations, breedings, weighings] = farmId
          ? await Promise.all([
              fetchCalvings(farmId).catch(() => []),
              fetchLactations(farmId).catch(() => []),
              fetchBreedings(farmId).catch(() => []),
              fetchWeighings(farmId, animal.id).catch(() => [] as Weighing[]),
            ])
          : [[], [], [], [] as Weighing[]];
        if (cancelled) return;

        const byId = new Map(all.map((a) => [a.id, a]));
        setResult({
          state: "ok",
          animal,
          breeds: composition.get(animal.id) ?? [],
          allBreeds: composition,
          dam: animal.dam_id ? (byId.get(animal.dam_id) ?? null) : null,
          herd: all,
          life: buildLife({
            animal,
            calvings,
            lactations,
            breedings,
            offspring: all.filter((a) => a.dam_id === animal.id || a.sire_id === animal.id),
            today: todayLocal(),
          }),
          weight:
            [...weighings].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
        });
      } catch (err) {
        if (!cancelled) setResult({ state: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tag, reloadKey, farmId]);

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

  const { animal, breeds, allBreeds, dam, herd, life, weight } = result;
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

  /** Where she is in the lactation she is in, if she is in one. */
  const running = life.find((e) => e.current) ?? null;
  const inMilk = running
    ? { title: running.title, days: daysBetween(running.date, todayLocal()) }
    : null;

  const sections: Section[] = [
    {
      id: "record",
      label: "Record",
      hint: "Her life, her milk, what she has cost and where she came from.",
      node: () => (
        <>
          <div className="serif record-section__head">What she has done</div>
          <p className="record-section__lede">
            {/* A beef cow has calvings and no lactations. Saying "and
                lactation" on her page names something she does not have,
                which is the same reason the lactation section itself stays
                off it. */}
            {isMilked(animal)
              ? "Every calving and lactation on file, in the order they happened."
              : "Every calving on file, in the order they happened."}
          </p>
          <LifeTimeline events={life} />

          {isMilked(animal) && (
            <div className="record-section">
              <MilkSection animalId={animal.id} farmId={farmId} businessId={businessId} name={name} />
            </div>
          )}

          {isMilked(animal) && (
            <div className="record-section">
              <LactationSection
                animalId={animal.id}
                farmId={farmId}
                canWrite={animal.sex === "female" && animal.class !== "calf"}
              />
            </div>
          )}

          <div className="record-section">
            <MoneySection animalId={animal.id} name={name} />
            <ValueSection animal={animal} farmId={farmId} />
          </div>

          <div className="record-section">
            <WeightSection animal={animal} farmId={farmId} />
          </div>

          <div className="record-section two-col">
            <div>
              <div className="serif record-section__head">Where she came from</div>
              <Pedigree animal={animal} herd={herd} breeds={allBreeds} />
            </div>

            <div>
              <div className="section__head" style={{ marginBottom: 12 }}>
                <div className="serif" style={{ fontSize: 21 }}>
                  What she has left
                  {offspring.length > 0 && (
                    <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {" "}
                      · {offspring.length}
                    </span>
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
                  <RelativeRow key={child.id} animal={child} note={child.dam_id === animal.id ? "out of" : "by"} />
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
                    <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {" "}
                      · {siblings.length}
                    </span>
                  </div>
                  {siblings.map((s) => (
                    <RelativeRow key={s.id} animal={s} note={dam?.barn_name || `tag ${dam?.ear_tag}`} />
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="record-section">
            <div className="section__head" style={{ marginBottom: 12 }}>
              <div className="serif" style={{ fontSize: 21 }}>
                Breed composition
              </div>
              {farmId && !editingBreeds && (
                <button type="button" className="link-button mono" onClick={() => setEditingBreeds(true)}>
                  {breeds.length > 0 ? "edit" : "+ Record composition"}
                </button>
              )}
            </div>

            {editingBreeds && (
              <div style={{ marginBottom: 24 }}>
                {/* purpose is passed for a female only: a bull's follows his
                    breeds (migration 033), so the two can no longer disagree
                    and the mismatch note would be about nothing. */}
                <BreedEditor
                  animalId={animal.id}
                  farmId={farmId}
                  current={breeds.map((b) => ({ breedId: b.breedId, percent: b.percent }))}
                  purpose={animal.sex === "female" ? animal.purpose : undefined}
                  onCancel={() => setEditingBreeds(false)}
                  onSaved={() => {
                    setEditingBreeds(false);
                    setReloadKey((k) => k + 1);
                  }}
                />
              </div>
            )}

            {breeds.length > 0
              ? breeds.map((b) => (
                  <div className="breed-row" key={b.breedId}>
                    <span style={{ fontSize: 15 }}>{b.name}</span>
                    <div className="breed-row__bar">
                      <div className="breed-row__fill" style={{ width: `${Math.min(100, b.percent)}%` }} />
                    </div>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                      {b.percent}%
                    </span>
                  </div>
                ))
              : !editingBreeds && (
                  <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                    No breed composition recorded for {name}.
                  </p>
                )}

            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 16 }}>
              Her services, seasons and due dates are on{" "}
              <Link to="/breeding?tab=breedings">Breedings</Link>.
            </p>

            {animal.notes && (
              <>
                <div className="serif" style={{ fontSize: 21, margin: "24px 0 12px" }}>
                  Notes
                </div>
                <p className="text-wrap-pretty" style={{ fontSize: 15 }}>
                  {animal.notes}
                </p>
              </>
            )}

            <div style={{ marginTop: 24 }}>
              <Callout>
                Health history isn't shown — the treatment table has no rows yet. It'll appear here
                once it does.
              </Callout>
            </div>
          </div>
        </>
      ),
    },
    {
      id: "genetics",
      label: "Genetics",
      hint: "Her markers, and what the conditions this farm tracks say about her.",
      node: () => <GeneticsSection animalId={animal.id} farmId={farmId} />,
    },
  ];

  return (
    <Frame title={name} animal={animal}>
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
              {/* Beef or dairy, on the identity line rather than buried in the
                  edit form — it decides whether she has a lactation at all. */}
              <Pill variant={isMilked(animal) ? "outline-green" : "outline"}>{animal.purpose}</Pill>
              {animal.status !== "active" && <Pill variant="outline">{animal.status}</Pill>}
            </div>
          </div>
          <EarTag tag={animal.ear_tag} accent="herd" size="lg" />
          {/* A class rather than an inline style so the mobile rules can put
              these on their own row — inline `flex: none` won this argument
              at every width and squeezed the name to three letters. */}
          <div className="record-head__actions">
            <Button disabled title="Treatments aren't built yet">
              Log treatment
            </Button>
            <Button variant="filled" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close" : "Edit"}
            </Button>
          </div>
        </div>

        {/* Breed, age, weight and where she is in her year — the four a
            farmer reads first. Class and sex left: both are already on the
            identity line above, and a tile spent repeating them is a tile
            not spent on her weight. */}
        <div className="record-head__stats">
          <StatTile size="md" value={breeding ?? "—"} label="Breed" />
          <StatTile
            size="md"
            value={formatAge(animal.birth_date)}
            label={`Age · born ${lifeDate(animal.birth_date)}`}
          />
          <StatTile
            size="md"
            value={weight ? weight.weightLb : "—"}
            unit={weight ? "lb" : undefined}
            label={weight ? `Weighed ${lifeDate(weight.date)}` : "No weight on file"}
          />
          {inMilk ? (
            <StatTile size="md" value={inMilk.days} unit="days" label={`In milk · ${inMilk.title.toLowerCase()}`} />
          ) : (
            <StatTile size="md" value={animal.class} label="Class" />
          )}
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
                life,
                weight,
              });
            }}
          />
        </div>
      )}

      <div className="record-tabbed">
        <TabbedSections label="Animal record" sections={sections} />
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

/**
 * Where "back" goes.
 *
 * A bull is reached from Sires, and a catalogue bull isn't on the Animals
 * list at all — sending him there is a link to a page he doesn't appear on.
 * `isSire` is the same predicate that builds the Sires list, so the way back
 * always lands on the page that lists him.
 */
function backTo(animal: RealAnimal | null): { to: string; label: string } {
  return animal && isSire(animal) ? { to: "/sires", label: "Sires" } : { to: "/animals", label: "Animals" };
}

function Frame({
  title,
  animal = null,
  children,
}: {
  title: string;
  animal?: RealAnimal | null;
  children: React.ReactNode;
}) {
  const back = backTo(animal);
  return (
    <div style={{ background: "var(--paper)", minHeight: "100vh" }}>
      <div className="record-topbar">
        <div className="record-topbar__left">
          <Link to={back.to} className="serif" style={{ fontSize: 22, letterSpacing: "-.02em", color: "var(--ink)" }}>
            Suchomski<span style={{ color: "var(--herd-green)" }}>.</span>
          </Link>
          {/* An animal's record sits outside OpsShell, so it has no nav rail
              and the wordmark was the only way back — a link that doesn't
              look like one. This is the way back. */}
          <Link to={back.to} className="record-back mono">
            ← {back.label}
          </Link>
        </div>
        <div className="eyebrow">Herd · {back.label} · {title}</div>
      </div>
      {children}
    </div>
  );
}
