import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, Pill } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import {
  createKeyArea,
  fetchActivePlan,
  fetchGrazingEvents,
  fetchGrazingPhotos,
  fetchKeyAreas,
  fetchMonitoringRecords,
  fetchPaddocks,
  recordMonitoring,
  rotationRounds,
  type GrazingPhoto,
  type GrazingPlan,
  type KeyArea,
  type MonitoringRecord,
  type Paddock,
} from "../lib/grazing";
import {
  cadenceInWords,
  coverTotal,
  monitoringDue,
  photoPointGaps,
  type DueState,
} from "../lib/monitoring";
import { photoRejection, signedPhotoUrls, uploadMonitoringPhoto } from "../lib/grazing-photos";
import "./grazing.css";

/**
 * Herd → Monitoring: key areas, what was seen there, and the photo series.
 *
 * "Due", never "overdue" and never "non-compliant". The cadence is the farm's
 * own, written into its plan; this page says how long it has been and what the
 * plan asked for, and stops. There is no default cadence anywhere — a farm
 * with no plan gets silence rather than a number this app invented.
 *
 * A photo point needs a location *and* a bearing. Without both, successive
 * photographs are just pictures of grass: you cannot tell a change in the
 * sward from a change in where somebody stood. The page says which half is
 * missing rather than letting a series quietly mean nothing.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      paddocks: Paddock[];
      areas: KeyArea[];
      records: MonitoringRecord[];
      photos: GrazingPhoto[];
      plan: GrazingPlan | null;
      roundsSince: (lastOn: string) => number;
    };

type Sheet = null | "area" | "record";

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export default function Monitoring() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  const [paddockId, setPaddockId] = useState("");
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [description, setDescription] = useState("");

  const [areaId, setAreaId] = useState("");
  const [observedOn, setObservedOn] = useState(today);
  const [protocol, setProtocol] = useState("");
  const [residual, setResidual] = useState("");
  const [cover, setCover] = useState("");
  const [litter, setLitter] = useState("");
  const [bare, setBare] = useState("");
  const [species, setSpecies] = useState("");
  const [vigor, setVigor] = useState("");
  const [erosion, setErosion] = useState("");
  const [compaction, setCompaction] = useState("");
  const [observer, setObserver] = useState("");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const [paddocks, areas, records, photos, plan, events] = await Promise.all([
      fetchPaddocks(farmId),
      fetchKeyAreas(farmId),
      fetchMonitoringRecords(farmId),
      fetchGrazingPhotos(farmId),
      fetchActivePlan(farmId),
      fetchGrazingEvents(farmId),
    ]);

    // "Every rotation" is a count of rounds, not of days — so the rounds have
    // to be worked out before the cadence can say anything.
    const rounds = rotationRounds({ events, paddocks, nowIso: nowIso() });
    const roundsSince = (lastOn: string) =>
      rounds.filter((r) => r.startedAt.slice(0, 10) > lastOn).length;

    setLoad({ state: "ok", paddocks, areas, records, photos, plan, roundsSince });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  // Signed URLs, refreshed with the data. Short-lived by design — see
  // lib/grazing-photos.ts.
  useEffect(() => {
    if (load.state !== "ok" || load.photos.length === 0) return;
    let live = true;
    signedPhotoUrls(load.photos.map((p) => p.storagePath))
      .then((m) => live && setUrls(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [load]);

  const num = (s: string): number | null => {
    const t = s.trim();
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  };

  const due = useMemo(() => {
    if (load.state !== "ok") return new Map<string, DueState>();
    const m = new Map<string, DueState>();
    for (const a of load.areas) {
      m.set(a.id, monitoringDue({
        keyAreaId: a.id, records: load.records, plan: load.plan,
        nowIso: nowIso(), roundsSince: load.roundsSince,
      }));
    }
    return m;
  }, [load]);

  const openArea = () => {
    setError(null); setNote(null);
    setPaddockId(""); setName(""); setLat(""); setLon(""); setAzimuth(""); setDescription("");
    setSheet("area");
  };

  const openRecord = (preselect?: string) => {
    setError(null); setNote(null);
    setAreaId(preselect ?? "");
    setObservedOn(today());
    setProtocol(""); setResidual(""); setCover(""); setLitter(""); setBare("");
    setSpecies(""); setVigor(""); setErosion(""); setCompaction("");
    setObserver(""); setNotes(""); setPhoto(null);
    setSheet("record");
  };

  const saveArea = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      await createKeyArea(farmId!, {
        paddockId, name,
        latitude: num(lat), longitude: num(lon),
        photoAzimuthDeg: num(azimuth), description,
      });
      setSheet(null);
      setNote(`${name.trim()} added as a key area.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveRecord = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      const id = await recordMonitoring(farmId!, {
        keyAreaId: areaId,
        planId: load.state === "ok" ? load.plan?.id ?? null : null,
        observedOn, protocol,
        residualHeightIn: num(residual),
        groundCoverPct: num(cover), litterPct: num(litter), bareGroundPct: num(bare),
        speciesComposition: species, keyPlantVigor: vigor,
        erosionObservations: erosion, compactionObservations: compaction,
        observer, notes,
      });

      // The reading is saved before the photo goes up, so a failed upload
      // costs a picture rather than the observation somebody walked out to
      // make.
      if (photo !== null) {
        try {
          await uploadMonitoringPhoto({ farmId: farmId!, monitoringRecordId: id, file: photo });
        } catch (err) {
          setError(
            `The reading was saved, but the photo was not: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      setSheet(null);
      setNote("Recorded.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const nameOfPaddock = (id: string) =>
    load.state === "ok" ? (load.paddocks.find((p) => p.id === id)?.name ?? "a paddock") : "";

  const cadence = load.state === "ok" ? cadenceInWords(load.plan) : null;
  const dueCount = [...due.values()].filter((d) => d.state === "due").length;

  return (
    <OpsShell>
      <PageHeader
        eyebrow={
          load.state === "ok"
            ? [
                `${load.areas.filter((a) => a.active).length} key area${load.areas.filter((a) => a.active).length === 1 ? "" : "s"}`,
                cadence,
                dueCount > 0 ? `${dueCount} due` : null,
              ].filter(Boolean).join(" · ")
            : "Herd"
        }
        title="Monitoring"
        actions={
          <>
            <Link to="/grazing" className="rot-back mono">← the board</Link>
            <Button onClick={() => (sheet === "area" ? setSheet(null) : openArea())} disabled={load.state !== "ok"}>
              {sheet === "area" ? "Cancel" : "Add a key area"}
            </Button>
            <Button
              variant="filled"
              onClick={() => (sheet === "record" ? setSheet(null) : openRecord())}
              disabled={load.state !== "ok" || load.areas.length === 0}
            >
              {sheet === "record" ? "Cancel" : "Record a look"}
            </Button>
          </>
        }
      />

      {error && <div style={{ paddingTop: 16 }}><Callout tone="dashed">{error}</Callout></div>}
      {note && <div style={{ paddingTop: 16 }}><Callout>{note}</Callout></div>}

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          {sheet === "area" && (
            <div className="grz-form">
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">In which paddock</span>
                  <select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="In which paddock">
                    <option value="">Pick a paddock…</option>
                    {load.paddocks.filter((p) => p.active).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Call it</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Call it" placeholder="Gate corner" />
                </label>
              </div>
              <p className="grz-optional">
                A photo point needs a spot and a direction. Without both, a series of photographs is
                just pictures of grass — there is no telling a change in the sward from a change in
                where somebody stood.
              </p>
              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Latitude</span>
                  <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" aria-label="Latitude" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Longitude</span>
                  <input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" aria-label="Longitude" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Camera bearing, °</span>
                  <input value={azimuth} onChange={(e) => setAzimuth(e.target.value)} inputMode="decimal" aria-label="Camera bearing" />
                </label>
              </div>
              <label className="grz-field grz-field--wide">
                <span className="eyebrow">What to look at</span>
                <input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="What to look at" />
              </label>
              <div className="grz-form__actions">
                <Button variant="filled" disabled={busy || paddockId === "" || name.trim() === ""} onClick={saveArea}>
                  {busy ? "Saving…" : "Add it"}
                </Button>
              </div>
            </div>
          )}

          {sheet === "record" && (
            <div className="grz-form">
              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Which key area</span>
                  <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Which key area">
                    <option value="">Pick one…</option>
                    {load.areas.filter((a) => a.active).map((a) => (
                      <option key={a.id} value={a.id}>{a.name} — {nameOfPaddock(a.paddockId)}</option>
                    ))}
                  </select>
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Seen on</span>
                  <input type="date" value={observedOn} onChange={(e) => setObservedOn(e.target.value)} aria-label="Seen on" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Protocol</span>
                  <input value={protocol} onChange={(e) => setProtocol(e.target.value)} aria-label="Protocol" />
                </label>
              </div>

              <p className="grz-optional">All of this is optional. Record what you looked at.</p>

              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Residual, in</span>
                  <input value={residual} onChange={(e) => setResidual(e.target.value)} inputMode="decimal" aria-label="Residual, in" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Ground cover, %</span>
                  <input value={cover} onChange={(e) => setCover(e.target.value)} inputMode="decimal" aria-label="Ground cover, %" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Litter, %</span>
                  <input value={litter} onChange={(e) => setLitter(e.target.value)} inputMode="decimal" aria-label="Litter, %" />
                </label>
                <label className="grz-field">
                  <span className="eyebrow">Bare ground, %</span>
                  <input value={bare} onChange={(e) => setBare(e.target.value)} inputMode="decimal" aria-label="Bare ground, %" />
                </label>
              </div>

              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Species composition</span>
                  <input value={species} onChange={(e) => setSpecies(e.target.value)} aria-label="Species composition" />
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Key plant vigour</span>
                  <input value={vigor} onChange={(e) => setVigor(e.target.value)} aria-label="Key plant vigour" />
                </label>
              </div>

              <div className="grz-form__row">
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Erosion</span>
                  <input value={erosion} onChange={(e) => setErosion(e.target.value)} aria-label="Erosion" />
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Compaction</span>
                  <input value={compaction} onChange={(e) => setCompaction(e.target.value)} aria-label="Compaction" />
                </label>
              </div>

              <div className="grz-form__row">
                <label className="grz-field">
                  <span className="eyebrow">Who looked</span>
                  <input value={observer} onChange={(e) => setObserver(e.target.value)} aria-label="Who looked" />
                </label>
                <label className="grz-field grz-field--wide">
                  <span className="eyebrow">Notes</span>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
                </label>
              </div>

              <label className="grz-field grz-field--wide">
                <span className="eyebrow">Photo</span>
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Photo"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    const bad = f === null ? null : photoRejection(f);
                    setError(bad);
                    setPhoto(bad === null ? f : null);
                  }}
                />
              </label>
              <p className="grz-optional">
                Photos are kept privately and shown through a short-lived link — never a public URL.
              </p>

              <div className="grz-form__actions">
                <Button variant="filled" disabled={busy || areaId === ""} onClick={saveRecord}>
                  {busy ? "Saving…" : "Record it"}
                </Button>
              </div>
            </div>
          )}

          {load.plan === null && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                No grazing plan is on file, so this page shows when each key area was last looked at
                without saying whether that is often enough. How often to monitor is in the plan —
                this app doesn't supply a figure, because that would be an agronomic recommendation
                it has no standing to make.
              </Callout>
            </div>
          )}

          {load.areas.filter((a) => a.active).length === 0 && (
            <div style={{ paddingTop: 8 }}>
              <Callout>
                No key areas yet. A key area is the spot you judge a paddock by — the place that shows
                stress first, or the one that has to hold up. Monitoring records hang off them, so this
                is the first thing to add.
              </Callout>
            </div>
          )}

          {load.areas.filter((a) => a.active).map((a) => {
            const state = due.get(a.id);
            const gaps = photoPointGaps(a);
            const mine = load.records.filter((r) => r.keyAreaId === a.id);
            return (
              <section key={a.id} className="rot-round">
                <div className="rot-round__head">
                  <span className="serif rot-round__n">{a.name}</span>
                  <span className="mono rot-round__when">{nameOfPaddock(a.paddockId)}</span>
                  {state && <DuePill state={state} />}
                </div>

                {gaps.length > 0 && (
                  <p className="grz-warn">
                    Photo point has {gaps.join(" and ")}. A series from a spot that moves shows the
                    walking, not the grass.
                  </p>
                )}
                {a.description && <p className="mon-desc">{a.description}</p>}

                {mine.length === 0 && (
                  <p className="pm-unit__sub" style={{ padding: "8px 0" }}>
                    Nothing recorded here yet.{" "}
                    <button type="button" className="mon-link" onClick={() => openRecord(a.id)}>
                      Record one now
                    </button>
                  </p>
                )}

                {mine.map((r) => {
                  const shots = load.photos.filter((p) => p.monitoringRecordId === r.id);
                  const total = coverTotal(r);
                  return (
                    <div key={r.id} className="mon-rec">
                      <p className="mon-rec__head">
                        <strong className="mono">{shortDate(r.observedOn)}</strong>
                        {r.observer && <span className="pm-unit__sub"> · {r.observer}</span>}
                        {r.protocol && <span className="pm-unit__sub"> · {r.protocol}</span>}
                      </p>
                      <p className="pm-unit__sub">
                        {[
                          r.residualHeightIn === null ? null : `residual ${r.residualHeightIn}″`,
                          r.groundCoverPct === null ? null : `cover ${r.groundCoverPct}%`,
                          r.litterPct === null ? null : `litter ${r.litterPct}%`,
                          r.bareGroundPct === null ? null : `bare ${r.bareGroundPct}%`,
                          // Shown, never enforced: a reading is what somebody
                          // saw, and refusing 97% would lose it to protect a sum.
                          total === null ? null : `${total}% accounted for`,
                          r.keyPlantVigor,
                          r.speciesComposition,
                        ].filter(Boolean).join(" · ") || "No figures taken."}
                      </p>
                      {(r.erosionObservations || r.compactionObservations || r.notes) && (
                        <p className="pm-unit__sub">
                          {[r.erosionObservations, r.compactionObservations, r.notes].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {shots.length > 0 && (
                        <div className="mon-shots">
                          {shots.map((s) => {
                            const url = urls.get(s.storagePath);
                            return url === undefined ? (
                              <span key={s.id} className="mon-shot mon-shot--pending" />
                            ) : (
                              <img key={s.id} className="mon-shot" src={url} alt={s.caption ?? `Photo at ${a.name}`} />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </>
      )}
    </OpsShell>
  );
}

/** Due, or how long it has been. Never "overdue", never "non-compliant". */
function DuePill({ state }: { state: DueState }) {
  switch (state.state) {
    case "due":
      return <Pill variant="outline-ochre">due · {state.daysSince} days</Pill>;
    case "ok":
      return <Pill variant="outline">{state.daysSince} days ago</Pill>;
    case "never":
      return <Pill variant="outline">never looked at</Pill>;
    default:
      return null;
  }
}

function shortDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
