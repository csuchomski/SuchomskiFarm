import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, EarTag, GridRow, Pill, StatTile } from "../components/ui";
import { fetchAnimals, herdOnly, type RealAnimal } from "../lib/herd";
import {
  fetchConditions,
  fetchConditionStatuses,
  fetchMarkers,
  genotypeLabel,
  liveConditions,
  MARKERS,
  markerSpread,
  pairingRisks,
  worstRisk,
  type ConditionStatus,
  type GeneticCondition,
  type MarkerGenotype,
} from "../lib/genetics";
import { sireName, siresIn } from "../lib/sires";
import { useWorkspace } from "../lib/workspace";
import "./genetics-page.css";

/**
 * Genetics across the herd, and the question the data is actually for:
 * would this mating throw an affected calf?
 *
 * The pairing checker is the point of the page. The tables above it exist to
 * show you what you know and — more usefully — what you don't, because a
 * pairing that comes back "clear" only means something once you can see how
 * much of it was tested.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      animals: RealAnimal[];
      conditions: GeneticCondition[];
      statuses: ConditionStatus[];
      markers: MarkerGenotype[];
    };

const COLS = "56px 1fr 120px 120px 120px";
const COLS_SM = "44px 1fr 96px";

export default function Genetics() {
  const { business } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [sireId, setSireId] = useState("");
  const [damId, setDamId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const animals = await fetchAnimals();
      const ids = animals.map((a) => a.id);
      const [conditions, statuses, markers] = await Promise.all([
        fetchConditions(),
        fetchConditionStatuses(ids),
        fetchMarkers(ids),
      ]);
      if (!cancelled) setLoad({ state: "ok", animals, conditions, statuses, markers });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const animals = load.state === "ok" ? load.animals : EMPTY_ANIMALS;
  const conditions = load.state === "ok" ? load.conditions : EMPTY_CONDITIONS;
  const statuses = load.state === "ok" ? load.statuses : EMPTY_STATUSES;
  const markers = load.state === "ok" ? load.markers : EMPTY_MARKERS;

  const resident = useMemo(() => herdOnly(animals), [animals]);
  const sires = useMemo(() => siresIn(animals), [animals]);
  const dams = useMemo(() => resident.filter((a) => a.sex === "female"), [resident]);
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  const risks = useMemo(
    () => (sireId && damId ? pairingRisks(sireId, damId, conditions, statuses) : []),
    [sireId, damId, conditions, statuses],
  );
  const worst = worstRisk(risks);

  const carried = useMemo(() => liveConditions(conditions, statuses), [conditions, statuses]);
  const a2 = markerSpread(markers, "BETA_CASEIN");
  const a2a2 = a2.find((g) => g.genotype === "A2A2")?.count ?? 0;
  const tested = new Set(markers.map((m) => m.animal_id)).size;

  return (
    <OpsShell searchPlaceholder="A cow, a marker…">
      <PageHeader
        eyebrow={business ? `${business.name} · herd` : "Herd"}
        title="Genetics"
      />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={tested || "—"} label="Animals tested" />
            <StatTile value={a2a2 || "—"} label="A2A2" />
            <StatTile value={carried.length || "—"} label="Conditions carried" />
            <StatTile value={sires.length || "—"} label="Sires on file" />
          </div>

          {/* ── pairing check ── */}
          <div className="serif" style={{ fontSize: 21, margin: "32px 0 4px" }}>
            Check a pairing
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 12 }}>
            Pick a sire and a dam. Conditions where one parent tests free are treated as clear whatever the other is
            — for a recessive that's true, and it keeps a real warning from being lost in a wall of untested.
          </p>

          <div className="pairing-controls">
            <label style={{ fontSize: 13, flex: 1, minWidth: 160 }}>
              <div className="eyebrow">Sire</div>
              <select className="gene-select" value={sireId} onChange={(e) => setSireId(e.target.value)}>
                <option value="">Pick a sire…</option>
                {sires.map((a) => (
                  <option key={a.id} value={a.id}>
                    {sireName(a)}
                    {a.record_type === "reference" ? " (AI)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, flex: 1, minWidth: 160 }}>
              <div className="eyebrow">Dam</div>
              <select className="gene-select" value={damId} onChange={(e) => setDamId(e.target.value)}>
                <option value="">Pick a dam…</option>
                {dams.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.barn_name || `Tag ${a.ear_tag}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {sires.length === 0 && (
            <Callout>
              No sires on file. Add one from <Link to="/sires">Sires</Link> — an AI bull you only buy straws from
              counts, and only needs a name and a birth date.
            </Callout>
          )}

          {sireId && damId && (
            <div className="pairing-result">
              <div className={`pairing-verdict pairing-verdict--${worst?.level ?? "clear"}`}>
                {worst === null
                  ? "Nothing recorded rules this pairing out."
                  : worst.level === "risk"
                    ? `${worst.code}: ${worst.note}`
                    : `${worst.code}: ${worst.note}`}
              </div>
              {risks
                .filter((r) => r.level !== "clear" || r.carrierPercent !== null)
                .slice(0, 12)
                .map((r) => (
                  <div className="pairing-row" key={r.conditionId}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                      {r.code}
                    </span>
                    <span style={{ fontSize: 13, minWidth: 0 }}>{r.name}</span>
                    <span className="mono pairing-row__parents">
                      {r.sire} × {r.dam}
                    </span>
                    <RiskPill level={r.level} />
                    <span className="pairing-row__note">{r.note}</span>
                  </div>
                ))}
              {risks.every((r) => r.level === "unknown") && (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", padding: "12px 0" }}>
                  Neither animal has any condition results on file, so there's nothing to check against yet.
                </p>
              )}
            </div>
          )}

          {/* ── markers across the herd ── */}
          <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
            Markers
          </div>

          {markers.length === 0 ? (
            <Callout>
              No marker results recorded yet. Open an animal and use the Genetics section on her record to enter a
              beta-casein or kappa-casein result.
            </Callout>
          ) : (
            <>
              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Tag</span>
                <span>Animal</span>
                <span>Beta casein</span>
                <span className="hide-sm">Kappa casein</span>
                <span className="hide-sm">Red factor</span>
              </GridRow>
              {resident.map((a) => {
                const of = (code: string) => markers.find((m) => m.animal_id === a.id && m.marker_code === code);
                const beta = of("BETA_CASEIN");
                return (
                  <Link key={a.id} to={`/animals/${a.ear_tag}`} style={{ color: "inherit", display: "contents" }}>
                    <GridRow cols={COLS} mobileCols={COLS_SM} as="body">
                      <EarTag tag={a.ear_tag} accent="herd" />
                      <span className="serif" style={{ fontSize: 17 }}>
                        {a.barn_name || `Tag ${a.ear_tag}`}
                      </span>
                      <span>
                        {beta ? (
                          <Pill variant={beta.genotype === "A2A2" ? "outline-green" : "outline"}>{beta.genotype}</Pill>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>—</span>
                        )}
                      </span>
                      <Cell value={of("KAPPA_CASEIN")} />
                      <Cell value={of("RED_FACTOR")} />
                    </GridRow>
                  </Link>
                );
              })}

              <div className="marker-spreads">
                {MARKERS.map((m) => {
                  const spread = markerSpread(markers, m.code);
                  if (spread.length === 0) return null;
                  return (
                    <div className="marker-spread" key={m.code}>
                      <div className="eyebrow">{m.label}</div>
                      {spread.map((s) => (
                        <div className="marker-spread__row" key={s.genotype}>
                          <span style={{ fontSize: 13 }}>{genotypeLabel(m.code, s.genotype)}</span>
                          <span className="mono" style={{ fontSize: 13 }}>
                            {s.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── conditions carried ── */}
          <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
            Conditions in the herd
          </div>
          {carried.length === 0 ? (
            <Callout>
              Nothing in the herd is recorded as a carrier. {conditions.length} conditions are available to record
              against — open an animal's record to enter a result.
            </Callout>
          ) : (
            carried.map(({ condition, carriers, affected }) => (
              <div className="condition-row" key={condition.id}>
                <div>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
                    {condition.code}
                  </span>
                  <span style={{ display: "block", fontSize: 13, color: "var(--ink-muted)" }}>{condition.name}</span>
                </div>
                <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{condition.inheritance}</span>
                <div className="condition-row__animals">
                  {affected.map((id) => (
                    <AnimalChip key={id} animal={byId.get(id)} tone="affected" />
                  ))}
                  {carriers.map((id) => (
                    <AnimalChip key={id} animal={byId.get(id)} tone="carrier" />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </OpsShell>
  );
}

function Cell({ value }: { value: MarkerGenotype | undefined }) {
  return (
    <span className="mono hide-sm" style={{ fontSize: 13, color: value ? undefined : "var(--ink-faint)" }}>
      {value ? genotypeLabel(value.marker_code, value.genotype) : "—"}
    </span>
  );
}

function AnimalChip({ animal, tone }: { animal: RealAnimal | undefined; tone: "carrier" | "affected" }) {
  if (!animal) return null;
  return (
    <Link to={`/animals/${animal.ear_tag}`} className={`animal-chip animal-chip--${tone}`}>
      {animal.barn_name || `Tag ${animal.ear_tag}`}
      <span className="animal-chip__tone">{tone}</span>
    </Link>
  );
}

function RiskPill({ level }: { level: "risk" | "watch" | "clear" | "unknown" }) {
  if (level === "risk") return <Pill variant="outline">risk</Pill>;
  if (level === "watch") return <Pill variant="outline">carriers</Pill>;
  if (level === "clear") return <Pill variant="outline-green">clear</Pill>;
  return <Pill variant="neutral">untested</Pill>;
}

const EMPTY_ANIMALS: RealAnimal[] = [];
const EMPTY_CONDITIONS: GeneticCondition[] = [];
const EMPTY_STATUSES: ConditionStatus[] = [];
const EMPTY_MARKERS: MarkerGenotype[] = [];
