import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import {
  daysForBreed,
  fetchBreeds,
  fetchComposition,
  fetchOverrides,
  setOverride,
  validateGestation,
  type Breed,
  type BreedShare,
  type GestationOverride,
} from "../lib/gestation";
import { useWorkspace } from "../lib/workspace";
import "./store-orders.css";
import "./breedings.css";

/**
 * Breeds, and how long each one carries.
 *
 * The numbers were seeded with the breeds and nothing used them until due
 * dates started resolving through here — see lib/gestation.ts. A farm figure
 * overrides the breed's default for this farm only; clearing it goes back to
 * the default rather than to zero.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; breeds: Breed[]; composition: BreedShare[]; overrides: GestationOverride[]; animals: RealAnimal[] };

const COLS = "1fr 110px 130px 130px 160px";
const COLS_SM = "1fr 90px 90px";

export default function Breeds() {
  const { business, farmId } = useWorkspace();

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [days, setDays] = useState("");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", breeds: [], composition: [], overrides: [], animals: [] });
      return;
    }
    const [breeds, composition, overrides, animals] = await Promise.all([
      fetchBreeds(farmId),
      fetchComposition(farmId),
      fetchOverrides(farmId),
      fetchAnimals(),
    ]);
    setLoad({ state: "ok", breeds, composition, overrides, animals });
  }, [farmId]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    refresh().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const breeds = load.state === "ok" ? load.breeds : EMPTY_BREEDS;
  const composition = load.state === "ok" ? load.composition : EMPTY_SHARES;
  const overrides = load.state === "ok" ? load.overrides : EMPTY_OVERRIDES;
  const animals = load.state === "ok" ? load.animals : EMPTY_ANIMALS;

  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);

  /** Who on the farm is this breed, at all. A breed nobody carries is
   * vocabulary rather than something to tune. */
  const carriedBy = (breedId: string) =>
    composition
      .filter((c) => c.breed_id === breedId)
      .map((c) => byId.get(c.animal_id))
      .filter((a): a is RealAnimal => a !== undefined && a.status === "active")
      .map((a) => a.barn_name?.trim() || a.ear_tag);

  const inUse = breeds.filter((b) => carriedBy(b.id).length > 0);
  const problem = editingId ? validateGestation(days) : null;

  const startEdit = (breed: Breed) => {
    const mine = overrides.find((o) => o.breed_id === breed.id);
    setEditingId(breed.id);
    setDays(mine ? String(mine.gestation_days) : "");
    setError(null);
    setNote(null);
  };

  const save = (breed: Breed) => {
    if (!farmId || problem) return;
    setBusy(true);
    setError(null);
    setOverride({ farmId, breedId: breed.id, days })
      .then(async () => {
        await refresh();
        setEditingId(null);
        setNote(
          days.trim() === ""
            ? `${breed.name} is back to its default of ${breed.default_gestation_days} days.`
            : `${breed.name} carries ${days.trim()} days on this farm.`,
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <OpsShell searchPlaceholder="A breed…">
      <PageHeader eyebrow={business ? `${business.name} · herd` : "Herd"} title="Breeds" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load breeds: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={breeds.length || "—"} label="Breeds on file" />
            <StatTile value={inUse.length || "—"} label="In the herd" />
            <StatTile value={overrides.length || "—"} label="Farm figures" />
            <StatTile
              value={
                inUse.length > 0
                  ? `${Math.min(...inUse.map((b) => daysForBreed(b, overrides).days))}–${Math.max(
                      ...inUse.map((b) => daysForBreed(b, overrides).days),
                    )}d`
                  : "—"
              }
              label="Gestation range"
            />
          </div>

          {error && <p style={{ fontSize: 13, color: "var(--red)", padding: "12px 0" }}>{error}</p>}
          {note && <p style={{ fontSize: 13, color: "var(--herd-green)", padding: "12px 0" }}>{note}</p>}

          <div style={{ margin: "12px 0" }}>
            <Callout>
              Due dates on <Link to="/breedings">Breedings</Link> count forward from the service by the gestation of
              the dam's breed — weighted across her composition if she's a cross. Setting a figure here changes it for
              this farm only; the breed's own default is left alone.
            </Callout>
          </div>

          <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
            <span>Breed</span>
            <span className="hide-sm">Type</span>
            <span className="text-right">Default</span>
            <span className="text-right">This farm</span>
            <span className="hide-sm">Carried by</span>
          </GridRow>

          {breeds.map((b) => {
            const { days: resolved, overridden } = daysForBreed(b, overrides);
            const who = carriedBy(b.id);
            return (
              <div key={b.id}>
                <GridRow cols={COLS} mobileCols={COLS_SM} as="body" highlight={who.length === 0}>
                  <span style={{ minWidth: 0 }}>
                    <span className="serif" style={{ fontSize: 17 }}>
                      {b.name}
                    </span>
                    <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {" "}
                      {b.code}
                    </span>
                    <br />
                    <button type="button" className="link-button mono" onClick={() => startEdit(b)}>
                      {overridden ? "change" : "set a farm figure"}
                    </button>
                  </span>
                  <span className="hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                    {b.species_type}
                  </span>
                  <span className="mono text-right" style={{ color: "var(--ink-muted)" }}>
                    {b.default_gestation_days}d
                  </span>
                  <span className="mono text-right" style={{ fontWeight: overridden ? 500 : 400 }}>
                    {overridden ? (
                      <>
                        {resolved}d <Pill variant="outline-green">set</Pill>
                      </>
                    ) : (
                      <span style={{ color: "var(--ink-faint)" }}>—</span>
                    )}
                  </span>
                  <span className="hide-sm" style={{ fontSize: 13, color: "var(--ink-muted)", minWidth: 0 }}>
                    {who.length === 0 ? "nobody" : who.join(", ")}
                  </span>
                </GridRow>

                {editingId === b.id && (
                  <div className="breeding-void">
                    <div className="breeding-check__row">
                      <label style={{ fontSize: 13 }}>
                        <div className="eyebrow">Days on this farm</div>
                        <input
                          className="order-select"
                          type="number"
                          inputMode="numeric"
                          placeholder={String(b.default_gestation_days)}
                          value={days}
                          aria-label={`Gestation days for ${b.name}`}
                          onChange={(e) => setDays(e.target.value)}
                        />
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <Button variant="filled" size="sm" disabled={busy || problem !== null} onClick={() => save(b)}>
                        {busy ? "Saving…" : days.trim() === "" ? "Use the default" : "Save"}
                      </Button>
                      <Button size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                      <span style={{ fontSize: 13, color: problem ? "var(--red)" : "var(--ink-muted)" }}>
                        {problem ?? `Leave it blank to go back to ${b.default_gestation_days} days.`}
                      </span>
                    </div>
                    {who.length > 0 && (
                      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
                        This changes the due date for {who.join(", ")}.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
            A cow with no breed composition on file falls back to the species average from the farm's settings —
            283 days for beef, 279 for dairy — which is where every due date came from before breeds were read.
          </p>
        </>
      )}
    </OpsShell>
  );
}

const EMPTY_BREEDS: Breed[] = [];
const EMPTY_SHARES: BreedShare[] = [];
const EMPTY_OVERRIDES: GestationOverride[] = [];
const EMPTY_ANIMALS: RealAnimal[] = [];
