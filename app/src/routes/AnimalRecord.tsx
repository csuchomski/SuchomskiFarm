import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Callout, EarTag, Pill } from "../components/ui";
import { fetchAnimalByTag, formatAge, type RealAnimal } from "../lib/herd";
import "./animal-record.css";

type Fetch = { state: "loading" } | { state: "error"; message: string } | { state: "notfound" } | { state: "ok"; animal: RealAnimal };

/** A section of the record that isn't wired to real data yet — says so
 * plainly rather than showing empty stats or implying we checked and
 * found nothing. See IMPLEMENTATION_PLAN.md for the wiring sequence. */
function NotWiredYet({ needs }: { needs: string }) {
  return (
    <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
      Not wired up yet on this screen — needs <code className="mono">{needs}</code>.
    </p>
  );
}

export default function AnimalRecord() {
  const { tag = "" } = useParams();
  const [result, setResult] = useState<Fetch>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    setResult({ state: "loading" });
    fetchAnimalByTag(tag)
      .then((animal) => !cancelled && setResult(animal ? { state: "ok", animal } : { state: "notfound" }))
      .catch((err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [tag]);

  if (result.state === "loading") {
    return (
      <div style={{ padding: 48 }}>
        <p style={{ color: "var(--ink-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (result.state === "error") {
    return (
      <div style={{ padding: 48 }}>
        <p style={{ color: "var(--red)" }}>Couldn't load tag {tag}: {result.message}</p>
        <Link to="/animals">← back to Animals</Link>
      </div>
    );
  }

  if (result.state === "notfound") {
    return (
      <div style={{ padding: 48 }}>
        <p>No animal on tag {tag}.</p>
        <Link to="/animals">← back to Animals</Link>
      </div>
    );
  }

  const animal = result.animal;

  return (
    <div style={{ background: "var(--paper)" }}>
      <div className="record-topbar">
        <div className="serif" style={{ fontSize: 22, letterSpacing: "-.02em" }}>
          Suchomski<span style={{ color: "var(--herd-green)" }}>.</span>
        </div>
        <div className="eyebrow">Herd · Animals · {animal.barn_name ?? animal.ear_tag}</div>
      </div>

      {/* No real withdrawal signal yet — herd.treatments isn't wired up on
          this screen, so this banner never renders for a real animal
          rather than guessing. */}

      <div className="record-head">
        <div className="record-head__top">
          <div className="record-photo">
            <span className="eyebrow" style={{ fontSize: 10 }}>
              Photo
            </span>
          </div>
          <div className="record-head__id">
            <div className="serif record-head__name">{animal.barn_name ?? `Tag ${animal.ear_tag}`}</div>
            <div className="record-head__meta">
              <span>{animal.sex}</span>
              <span>·</span>
              <span>{animal.class}</span>
              <span>·</span>
              <span>born {animal.birth_date}</span>
              <span>·</span>
              <span>{formatAge(animal.birth_date)} old</span>
              <Pill variant={animal.status === "active" ? "outline-green" : "outline"}>{animal.status}</Pill>
            </div>
          </div>
          <EarTag tag={animal.ear_tag} accent="herd" size="lg" />
          <div style={{ display: "flex", gap: 8, flex: "none" }}>
            <Button>Log treatment</Button>
            <Button variant="filled">Log milking</Button>
          </div>
        </div>

        <Callout>
          <strong style={{ fontWeight: 500 }}>Real animal identity, not yet the rest.</strong> Lactation, cost, and
          net stats need <code className="mono">herd.lactations</code>, <code className="mono">herd.cost_entries</code>{" "}
          and <code className="mono">herd.revenue_entries</code> — not wired up on this page yet.
        </Callout>

        <div className="record-tabs">
          <span className="eyebrow record-tab">Record</span>
          <span className="eyebrow record-tab record-tab--active">Milk &amp; money</span>
          <span className="eyebrow record-tab">Health</span>
          <span className="eyebrow record-tab">Lactations</span>
          <span className="eyebrow record-tab">Pedigree</span>
          <span className="eyebrow record-tab">Calves</span>
        </div>
      </div>

      <div className="record-body">
        <div>
          <div style={{ paddingBottom: 24, borderBottom: "1px solid var(--hairline)" }}>
            <div className="section__head" style={{ marginBottom: 16 }}>
              <div className="serif" style={{ fontSize: 21 }}>
                Lactation curve
              </div>
            </div>
            <NotWiredYet needs="herd.lactations, herd.test_days or herd.production_records" />
          </div>

          <div style={{ paddingTop: 24 }}>
            <div className="section__head" style={{ marginBottom: 12 }}>
              <div className="serif" style={{ fontSize: 21 }}>
                Where the milk went
              </div>
            </div>
            <NotWiredYet needs="herd.production_records / public.inventory_batches" />
          </div>
        </div>

        <div>
          <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
            Costs on the line
          </div>
          <NotWiredYet needs="herd.cost_entries, herd.cost_allocations" />

          <div className="serif" style={{ fontSize: 21, margin: "24px 0 12px" }}>
            Health
          </div>
          <NotWiredYet needs="herd.treatments, herd.vaccinations" />

          <div className="serif" style={{ fontSize: 21, margin: "24px 0 12px" }}>
            Pedigree
          </div>
          <NotWiredYet needs="animals.sire_id / animals.dam_id" />
        </div>
      </div>
    </div>
  );
}
