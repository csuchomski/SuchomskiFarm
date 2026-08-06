import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, EarTag, GridRow, Pill, StatTile } from "../components/ui";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import {
  byFreshDateDesc,
  daysInMilk,
  fetchLactations,
  statusOf,
  type RealLactation,
} from "../lib/lactations";
import { useWorkspace } from "../lib/workspace";

/**
 * The herd's milking picture: who's in milk, how far along, and who has no
 * lactation on record at all.
 *
 * That last group is the point of the second table. A cow milking today with
 * nothing recorded looks identical to a dry cow if you only list lactations,
 * so the animals *without* one are shown rather than left implicit.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; lactations: RealLactation[]; animals: RealAnimal[] };

const COLS = "60px 1fr 64px 100px 100px 64px 92px";

export default function Lactations() {
  const { farmId, business } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    if (!farmId) {
      setLoad({ state: "ok", lactations: [], animals: [] });
      return;
    }
    let cancelled = false;
    setLoad({ state: "loading" });

    Promise.all([fetchLactations(farmId), fetchAnimals()])
      .then(([lactations, animals]) => !cancelled && setLoad({ state: "ok", lactations, animals }))
      .catch(
        (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
      );

    return () => {
      cancelled = true;
    };
  }, [farmId]);

  const lactations = load.state === "ok" ? [...load.lactations].sort(byFreshDateDesc) : [];
  const animals = load.state === "ok" ? load.animals : [];
  const byId = new Map(animals.map((a) => [a.id, a]));

  const inMilk = lactations.filter((l) => statusOf(l) === "in-milk");
  const dims = inMilk.map((l) => daysInMilk(l)).filter((d): d is number => d !== null);
  const avgDim = dims.length > 0 ? Math.round(dims.reduce((s, d) => s + d, 0) / dims.length) : null;

  // Females old enough to have calved, with nothing on record.
  const withLactation = new Set(lactations.map((l) => l.animal_id));
  const missing = animals.filter(
    (a) => a.sex === "female" && a.class !== "calf" && !withLactation.has(a.id),
  );

  return (
    <OpsShell searchPlaceholder="A cow, a lactation…">
      <PageHeader
        eyebrow={business ? `${business.name} · herd` : "Herd"}
        title="Lactations"
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load lactations: {load.message}
        </p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={inMilk.length} label="In milk" />
            <StatTile value={avgDim ?? "—"} label="Average DIM" />
            <StatTile value={lactations.length} label="Lactations on record" />
            <StatTile
              value={missing.length}
              label="Cows with none"
              tone={missing.length > 0 ? "red" : "ink"}
            />
          </div>

          {lactations.length === 0 ? (
            <div style={{ marginTop: 24 }}>
              <Callout>
                No lactations recorded yet. Open a cow's record and record a freshening — the table has been in the
                schema all along, it just has no rows.
              </Callout>
            </div>
          ) : (
            <div style={{ marginTop: 24 }}>
              <GridRow cols={COLS} as="header">
                <span>Tag</span>
                <span>Animal</span>
                <span className="text-right">№</span>
                <span>Fresh</span>
                <span>Dry off</span>
                <span className="text-right">DIM</span>
                <span>Status</span>
              </GridRow>

              {lactations.map((l) => {
                const animal = byId.get(l.animal_id);
                const status = statusOf(l);
                return (
                  <Link
                    key={l.id}
                    to={animal ? `/animals/${animal.ear_tag}` : "/animals"}
                    style={{ color: "inherit", display: "contents" }}
                  >
                    <GridRow cols={COLS} as="body">
                      <EarTag tag={animal?.ear_tag ?? "—"} accent="herd" />
                      <span className="serif" style={{ fontSize: 17 }}>
                        {animal?.barn_name ?? (animal ? `Tag ${animal.ear_tag}` : "Unknown animal")}
                      </span>
                      <span className="mono text-right">{l.lactation_number}</span>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {l.fresh_date}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 13, color: l.dry_off_date ? undefined : "var(--ink-faint)" }}
                      >
                        {l.dry_off_date ?? "—"}
                      </span>
                      <span className="mono text-right">{daysInMilk(l) ?? "—"}</span>
                      <span>
                        <Pill variant={status === "in-milk" ? "outline-green" : "neutral"}>
                          {status === "in-milk" ? "In milk" : status === "dry" ? "Dry" : "Scheduled"}
                        </Pill>
                      </span>
                    </GridRow>
                  </Link>
                );
              })}
            </div>
          )}

          {missing.length > 0 && (
            <div style={{ paddingTop: 32 }}>
              <div className="serif" style={{ fontSize: 21, marginBottom: 4 }}>
                No lactation on record
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
                Females past calf age with nothing recorded. A cow milking today looks the same as a dry one until
                someone records her freshening.
              </p>
              {missing.map((a) => (
                <Link key={a.id} to={`/animals/${a.ear_tag}`} style={{ color: "inherit", display: "contents" }}>
                  <GridRow cols="60px 1fr 120px" as="body">
                    <EarTag tag={a.ear_tag} accent="herd" />
                    <span className="serif" style={{ fontSize: 17 }}>
                      {a.barn_name ?? `Tag ${a.ear_tag}`}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{a.class}</span>
                  </GridRow>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </OpsShell>
  );
}
