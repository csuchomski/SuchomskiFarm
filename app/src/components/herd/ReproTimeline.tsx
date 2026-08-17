import { Link } from "react-router-dom";
import { Callout } from "../ui";
import { daysBetween } from "../../lib/repro";
import {
  atDay,
  axisDays,
  fitInWords,
  summarise,
  toSeasons,
  unattributedCalvings,
  untiedCalves,
  whatsNext,
  type Season,
  type Service,
  type TimelineInput,
} from "../../lib/repro-timeline";
import type { RealAnimal } from "../../lib/herd";
import "./repro-timeline.css";

/**
 * Her breeding record, drawn.
 *
 * Seasons stacked on one clock: every row starts the day she calved, which is
 * what makes "day 84" mean the same thing in every row and lets the columns
 * be compared by eye.
 *
 * Presentational. It used to fetch its own ten tables, which was right when
 * it lived alone on an animal's page and wrong the moment Breedings started
 * drawing one of these per cow — the same reads, once per expand. The caller
 * assembles the input now; lib/alerts.ts has timelineFor() for exactly that.
 */

export function ReproTimeline({
  input,
  herd,
  showWait,
  onShowWait,
  onAttachService,
  busy = false,
}: {
  input: TimelineInput;
  herd: RealAnimal[];
  showWait: boolean;
  onShowWait: (v: boolean) => void;
  /** Point a calving at the service that made it. Omitted where there's
   *  nothing to write with, and the prompt then just explains. */
  onAttachService?: (calvingId: string, serviceId: string) => void;
  busy?: boolean;
}) {
  const seasons = toSeasons(input);
  const axis = axisDays(seasons);
  const stats = summarise(seasons);
  const open = seasons[seasons.length - 1];
  const outstanding = whatsNext(open, { today: input.today, voluntaryWaitDays: input.voluntaryWaitDays });
  // Calves on file, out of her, that no calving accounts for. The pedigree
  // link and the calving link are different things and only the second closes
  // a season — so without this the page reports her overdue with the calf
  // standing next to her.
  const untied = untiedCalves(input, herd);
  // The mirror image: a calving recorded before its service was logged keeps
  // a null link, so the calf has no sire even though the breeding is right
  // there on the page.
  const unattributed = unattributedCalvings(input);
  const nothingYet = seasons.length === 1 && seasons[0].anchor === "birth";

  return (
    <section className="rt">
      <Head />

      <p className="rt-lede">
        Each row runs from one calving to the next, so the columns compare — day 84 in one row is day 84 in the
        next.
      </p>

      {nothingYet ? (
        <Callout>
          Nothing bred or calved for her yet. A service logged on <Link to="/breeding?tab=breedings">Breedings</Link> starts the
          record; a check and a calving fill it in.
        </Callout>
      ) : (
        <>
          {outstanding && <p className="rt-outstanding">{outstanding}</p>}

          {untied.map((calf) => (
            <p className="rt-untied" key={calf.animalId}>
              <strong>{calf.name}</strong> is on file as born {calf.bornOn}, out of her, with no calving recorded.
              {calf.serviceId ? ` That fits the service she was due from — ${fitInWords(calf.daysOff)}.` : ""}{" "}
              <Link
                to={{
                  pathname: "/calvings",
                  search: new URLSearchParams({
                    dam: input.animal.id,
                    date: calf.bornOn,
                    calf: calf.animalId,
                    ...(calf.serviceId ? { service: calf.serviceId } : {}),
                  }).toString(),
                }}
              >
                Record the calving
              </Link>{" "}
              to tie them together — it attaches her rather than creating a second record.
            </p>
          ))}

          {unattributed.map((c) => (
            <p className="rt-untied" key={c.calvingId}>
              Her calving on <strong>{c.on}</strong> names no service, so the calf has no sire. The closest fit is{" "}
              {c.serviceDate} · {c.sire} — {fitInWords(c.daysOff)}.{" "}
              {onAttachService ? (
                <button
                  type="button"
                  className="link-button mono"
                  disabled={busy}
                  onClick={() => onAttachService(c.calvingId, c.serviceId)}
                >
                  attach it
                </button>
              ) : (
                <>Attach it on <Link to="/breeding?tab=breedings">Breedings</Link>.</>
              )}{" "}
              The calf's sire follows, and its breeds if both parents have them on file.
            </p>
          ))}

          <dl className="rt-stats">
            <Stat label="Calvings" value={stats.calvings || "—"} />
            <Stat label="Services" value={stats.services || "—"} />
            <Stat label="Per conception" value={stats.perConception ?? "—"} />
            <Stat label="Avg days open" value={stats.averageDaysOpen ?? "—"} />
            <Stat label="Avg interval" value={stats.averageInterval ? `${stats.averageInterval} d` : "—"} />
          </dl>

          <SeasonTable seasons={seasons} axis={axis} input={input} showWait={showWait} />

          {input.voluntaryWaitDays !== null && (
            <label className="rt-toggle">
              <input type="checkbox" checked={showWait} onChange={(e) => onShowWait(e.target.checked)} />
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
