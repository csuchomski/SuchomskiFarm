import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Callout } from "../ui";
import { fetchBreeds, fetchComposition, fetchOverrides, gestationFor, type GestationInputs } from "../../lib/gestation";
import { fetchBreedings } from "../../lib/breedings";
import { fetchLactations } from "../../lib/lactations";
import {
  fetchCalfOutcomes,
  fetchCalvings,
  daysBetween,
  fetchGestationDays,
  fetchPregnancyChecks,
  fetchVoluntaryWaitDays,
} from "../../lib/repro";
import {
  atDay,
  axisDays,
  summarise,
  toSeasons,
  toYears,
  whatsNext,
  type Season,
  type Service,
  type TimelineInput,
  type YearRow,
} from "../../lib/repro-timeline";
import type { RealAnimal } from "../../lib/herd";
import "./repro-timeline.css";

/**
 * Her breeding record, drawn.
 *
 * Two readings of the same events — seasons stacked on one clock, or the
 * calendar years they happened in. Every season row starts the day she
 * calved, which is what makes "day 84" mean the same thing in every row and
 * lets the columns be compared by eye.
 *
 * The assembly is in lib/repro-timeline.ts and is pure. This file turns days
 * into percentages and decides what a marker looks like, which is all it
 * should be doing.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; input: TimelineInput };

type View = "seasons" | "years";

export function ReproTimeline({ animal, herd, farmId }: { animal: RealAnimal; herd: RealAnimal[]; farmId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [view, setView] = useState<View>("seasons");
  const [showWait, setShowWait] = useState(true);

  const names = useMemo(
    () => new Map(herd.map((a) => [a.id, a.barn_name?.trim() || a.ear_tag || "unnamed"])),
    [herd],
  );

  const refresh = useCallback(async () => {
    const [calvings, outcomes, breedings, checks, lactations, breeds, composition, overrides, bySpecies, wait] =
      await Promise.all([
        fetchCalvings(farmId),
        fetchCalfOutcomes(farmId),
        fetchBreedings(farmId),
        fetchPregnancyChecks(farmId),
        fetchLactations(farmId),
        fetchBreeds(farmId),
        fetchComposition(farmId),
        fetchOverrides(farmId),
        fetchGestationDays(),
        fetchVoluntaryWaitDays(),
      ]);

    const gestation: GestationInputs = { breeds, composition, overrides, bySpecies };
    setLoad({
      state: "ok",
      input: {
        animal,
        calvings,
        outcomes,
        breedings,
        checks,
        lactations,
        names,
        gestationDays: gestationFor(animal, gestation)?.days ?? null,
        voluntaryWaitDays: wait,
        today: todayIso(),
      },
    });
  }, [farmId, animal, names]);

  useEffect(() => {
    if (!farmId) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    refresh().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [farmId, refresh]);

  if (!farmId) return null;

  if (load.state === "loading") {
    return (
      <section className="rt">
        <Head />
        <p className="rt-quiet">Loading her record…</p>
      </section>
    );
  }

  if (load.state === "error") {
    return (
      <section className="rt">
        <Head />
        <p style={{ fontSize: 13, color: "var(--red)" }}>Couldn't load her record: {load.message}</p>
      </section>
    );
  }

  const { input } = load;
  const seasons = toSeasons(input);
  const years = toYears(input);
  const axis = axisDays(seasons);
  const stats = summarise(seasons);
  const open = seasons[seasons.length - 1];
  const outstanding = whatsNext(open, { today: input.today, voluntaryWaitDays: input.voluntaryWaitDays });
  const nothingYet = seasons.length === 1 && seasons[0].anchor === "birth";

  return (
    <section className="rt">
      <Head>
        <div className="rt-views" role="group" aria-label="How to lay the rows out">
          <button
            type="button"
            className={`rt-view${view === "seasons" ? " is-on" : ""}`}
            aria-pressed={view === "seasons"}
            onClick={() => setView("seasons")}
          >
            Seasons
          </button>
          <button
            type="button"
            className={`rt-view${view === "years" ? " is-on" : ""}`}
            aria-pressed={view === "years"}
            onClick={() => setView("years")}
          >
            Calendar years
          </button>
        </div>
      </Head>

      <p className="rt-lede">
        {view === "seasons"
          ? "Each row runs from one calving to the next, so the columns compare — day 84 in one row is day 84 in the next."
          : "The same events on the year they happened, with a pregnancy carrying across the break."}
      </p>

      {nothingYet ? (
        <Callout>
          Nothing bred or calved for her yet. A service logged on <Link to="/breedings">Breedings</Link> starts the
          record; a check and a calving fill it in.
        </Callout>
      ) : (
        <>
          {outstanding && <p className="rt-outstanding">{outstanding}</p>}

          <dl className="rt-stats">
            <Stat label="Calvings" value={stats.calvings || "—"} />
            <Stat label="Services" value={stats.services || "—"} />
            <Stat label="Per conception" value={stats.perConception ?? "—"} />
            <Stat label="Avg days open" value={stats.averageDaysOpen ?? "—"} />
            <Stat label="Avg interval" value={stats.averageInterval ? `${stats.averageInterval} d` : "—"} />
          </dl>

          {view === "seasons" ? (
            <SeasonTable seasons={seasons} axis={axis} input={input} showWait={showWait} />
          ) : (
            <YearTable years={years} />
          )}

          {view === "seasons" && input.voluntaryWaitDays !== null && (
            <label className="rt-toggle">
              <input type="checkbox" checked={showWait} onChange={(e) => setShowWait(e.target.checked)} />
              Shade the voluntary waiting period ({input.voluntaryWaitDays} days after calving)
            </label>
          )}

          <Legend />
        </>
      )}
    </section>
  );
}

function Head({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rt-head">
      <div className="serif rt-title">Her record, row by row</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rt-stat">
      <dt className="eyebrow">{label}</dt>
      <dd className="mono rt-stat__value">{value}</dd>
    </div>
  );
}

// ─── seasons ───────────────────────────────────────────────────────────

function SeasonTable({
  seasons,
  axis,
  input,
  showWait,
}: {
  seasons: Season[];
  axis: number;
  input: TimelineInput;
  showWait: boolean;
}) {
  // A line every 50 days, a number every 100 — and none within 10% of either
  // end, where it would sit on top of "day 0" or the axis length.
  const ticks = Array.from({ length: axis / 50 - 1 }, (_, i) => (i + 1) * 50);

  return (
    <div className="rt-grid">
      <div className="rt-axis-spacer" />
      <div className="rt-axis">
        <span className="mono rt-axis__end rt-axis__start">
          day 0<span className="rt-axis__long"> · calving</span>
        </span>
        {ticks.map((t) => (
          <span key={t} className="rt-axis__tick" style={{ left: `${atDay(t, axis)}%` }}>
            {t % 100 === 0 && t / axis > 0.1 && t / axis < 0.9 && <span className="mono">{t}</span>}
          </span>
        ))}
        <span className="mono rt-axis__end rt-axis__finish">
          {axis}
          <span className="rt-axis__long"> days</span>
        </span>
      </div>
      <div className="rt-axis-label">Days open · interval</div>

      {seasons.map((season) => (
        <SeasonRow key={season.key} season={season} axis={axis} input={input} showWait={showWait} />
      ))}
    </div>
  );
}

function SeasonRow({
  season,
  axis,
  input,
  showWait,
}: {
  season: Season;
  axis: number;
  input: TimelineInput;
  showWait: boolean;
}) {
  const running = season.ending === null;
  const todayDay = running ? Math.max(0, Math.min(axis, season.runningDays ?? 0)) : null;

  // The pregnancy bar: from the service that took, to the calving it made —
  // or to the projected due date while she's still carrying, drawn dotted
  // because a due date is arithmetic, not an event.
  const carryTo = season.ending ? season.ending.day : season.dueOn ? daysBetween(season.startsOn, season.dueOn) : null;

  const notes: { key: string; day: number; text: string; tone: "quiet" | "accent" }[] = season.services.map((s) => ({
    key: s.id,
    day: s.day,
    text: `day ${s.day} · ${s.sire} — ${s.checkStory}`,
    tone: s.conceived || s.outcome === "pregnant" ? "accent" : "quiet",
  }));

  return (
    <>
      <div className="rt-rowhead">
        <div className="serif rt-rowhead__title">{season.title}</div>
        <div className="mono rt-rowhead__meta">
          {season.anchor === "calving"
            ? `calved ${season.startsOn}`
            : season.anchor === "first-service"
              ? `first bred ${season.startsOn}`
              : `born ${season.startsOn}`}
        </div>
        {season.lactationNumber !== null && (
          <div className="mono rt-rowhead__meta">lactation {season.lactationNumber}</div>
        )}
        {running && <div className="mono rt-rowhead__meta is-accent">running now</div>}
      </div>

      <div className="rt-track">
        <div className="rt-lane">
          {showWait && season.anchor === "calving" && input.voluntaryWaitDays !== null && (
            <div className="rt-wait" style={{ width: `${atDay(input.voluntaryWaitDays, axis)}%` }}>
              <span className="mono rt-wait__label">voluntary wait</span>
            </div>
          )}

          {season.conception && carryTo !== null && (
            <div
              className={`rt-carry${season.ending ? "" : " is-projected"}`}
              style={{
                left: `${atDay(season.conception.day, axis)}%`,
                width: `${Math.max(0, atDay(carryTo, axis) - atDay(season.conception.day, axis))}%`,
              }}
            />
          )}

          {season.services.map((s) => (
            <Marker key={s.id} service={s} axis={axis} />
          ))}

          {season.ending && (
            <div className="rt-calving" style={{ left: `${atDay(season.ending.day, axis)}%` }} aria-hidden="true" />
          )}

          {/* Past the middle of the row the label has to read backwards, or
              it hangs off the end of a phone. */}
          {todayDay !== null && (
            <div
              className={`rt-today${atDay(todayDay, axis) > 55 ? " is-late" : ""}`}
              style={{ left: `${atDay(todayDay, axis)}%` }}
            >
              <span className="mono rt-today__label">today</span>
            </div>
          )}
        </div>

        {/* Below the lane on a narrow screen, positioned against it on a wide
            one — same DOM either way. The inline left/top are inert until the
            wide media query turns these absolute. */}
        <div className="rt-notes" style={{ ["--notes-h" as string]: `${notes.length * 16 + 4}px` }}>
          {notes.map((n, i) => (
            <div
              key={n.key}
              className={`rt-note${n.tone === "accent" ? " is-accent" : ""}`}
              style={{ left: `${atDay(n.day, axis)}%`, top: `${i * 16}px` }}
            >
              {n.text}
            </div>
          ))}
          {season.ending && (
            <div className="rt-note rt-note--calving" style={{ left: `${atDay(season.ending.day, axis)}%`, top: 0 }}>
              <span className="serif rt-note__headline">
                {season.ending.headline} · {season.ending.on}
              </span>
              {season.ending.detail && <span className="rt-note__detail">{season.ending.detail}</span>}
            </div>
          )}
          {!season.ending && season.dueOn && (
            <div className="rt-note rt-note--calving" style={{ left: `${atDay(carryTo ?? 0, axis)}%`, top: 0 }}>
              <span className="mono rt-note__detail">due {season.dueOn} if it holds</span>
            </div>
          )}
        </div>
      </div>

      <div className="rt-figures">
        <div className="mono rt-figures__big">
          {season.daysOpen !== null ? (
            <>{season.daysOpen} d</>
          ) : running && season.runningDays !== null ? (
            <>
              {season.runningDays} d<span className="rt-figures__qual"> so far</span>
            </>
          ) : (
            "—"
          )}
        </div>
        <div className="mono rt-figures__sub">
          {season.services.length} {season.services.length === 1 ? "service" : "services"}
          {season.intervalDays !== null ? ` · ${season.intervalDays} d interval` : running ? " standing" : ""}
        </div>
      </div>
    </>
  );
}

/**
 * One service. Hollow and dashed for one that didn't take, filled for the one
 * that did, dotted while nobody has checked — the shape carries the result so
 * the row reads without the label underneath it.
 */
function Marker({ service, axis }: { service: Service; axis: number }) {
  const kind =
    service.conceived || service.outcome === "pregnant"
      ? "is-took"
      : service.outcome === "unchecked"
        ? "is-unchecked"
        : "is-open";
  return (
    <span
      className={`rt-mark ${kind}`}
      style={{ left: `${atDay(service.day, axis)}%` }}
      title={`${service.date} · ${service.sire} — ${service.checkStory}`}
    />
  );
}

// ─── calendar years ────────────────────────────────────────────────────

const YEAR_TICKS = [
  { label: "Apr", day: 90 },
  { label: "Jul", day: 181 },
  { label: "Oct", day: 273 },
];

function YearTable({ years }: { years: YearRow[] }) {
  const span = 365;
  return (
    <div className="rt-grid">
      <div className="rt-axis-spacer" />
      <div className="rt-axis">
        <span className="mono rt-axis__end rt-axis__start">Jan</span>
        {YEAR_TICKS.map((t) => (
          <span key={t.label} className="rt-axis__tick" style={{ left: `${atDay(t.day, span)}%` }}>
            <span className="mono">{t.label}</span>
          </span>
        ))}
        <span className="mono rt-axis__end rt-axis__finish">Dec<span className="rt-axis__long"> 31</span></span>
      </div>
      <div className="rt-axis-label">In the year</div>

      {years.map((row) => (
        <YearBand key={row.year} row={row} span={span} />
      ))}
    </div>
  );
}

function YearBand({ row, span }: { row: YearRow; span: number }) {
  const notes = row.services.map((s) => ({
    key: s.id,
    day: s.day,
    text: `${s.date.slice(5)} · ${s.sire} — ${s.checkStory}`,
    accent: s.conceived || s.outcome === "pregnant",
  }));

  return (
    <>
      <div className="rt-rowhead">
        <div className="serif rt-rowhead__title">{row.year}</div>
        {row.lactationLabel && <div className="mono rt-rowhead__meta">{row.lactationLabel}</div>}
      </div>

      <div className="rt-track">
        <div className="rt-lane">
          {row.carrying.map((c, i) => (
            <div
              key={i}
              className="rt-carry"
              style={{ left: `${atDay(c.fromDay, span)}%`, width: `${atDay(c.toDay - c.fromDay, span)}%` }}
            />
          ))}
          {row.carrying.some((c) => c.fromPriorYear) && (
            <span className="mono rt-carry__from">← carrying from last year</span>
          )}
          {row.services.map((s) => (
            <Marker key={s.id} service={s} axis={span} />
          ))}
          {row.calvings.map((c) => (
            <div key={c.calvingId} className="rt-calving" style={{ left: `${atDay(c.day, span)}%` }} aria-hidden="true" />
          ))}
        </div>

        <div className="rt-notes" style={{ ["--notes-h" as string]: `${(notes.length + row.calvings.length) * 16 + 4}px` }}>
          {row.calvings.map((c) => (
            <div key={c.calvingId} className="rt-note rt-note--calving" style={{ left: `${atDay(c.day, span)}%`, top: 0 }}>
              <span className="serif rt-note__headline">
                Calved {c.on.slice(5)} · {c.headline.toLowerCase()}
              </span>
              {c.detail && <span className="rt-note__detail">{c.detail}</span>}
            </div>
          ))}
          {notes.map((n, i) => (
            <div
              key={n.key}
              className={`rt-note${n.accent ? " is-accent" : ""}`}
              style={{ left: `${atDay(n.day, span)}%`, top: `${(row.calvings.length + i) * 16}px` }}
            >
              {n.text}
              {row.carrying.some((c) => c.intoNextYear) && n.accent ? " · carrying into next year →" : ""}
            </div>
          ))}
        </div>
      </div>

      <div className="rt-figures">
        <div className="mono rt-figures__big">
          {row.calvings.length} · {row.services.length}
        </div>
        <div className="mono rt-figures__sub">calvings · services</div>
      </div>
    </>
  );
}

function Legend() {
  return (
    <div className="rt-legend">
      <span>
        <span className="rt-mark is-open rt-legend__mark" /> served, didn't take
      </span>
      <span>
        <span className="rt-mark is-unchecked rt-legend__mark" /> served, not checked
      </span>
      <span>
        <span className="rt-mark is-took rt-legend__mark" /> the service that took
      </span>
      <span>
        <span className="rt-legend__bar" /> carrying
      </span>
      <span>
        <span className="rt-legend__calving" /> calving
      </span>
    </div>
  );
}
