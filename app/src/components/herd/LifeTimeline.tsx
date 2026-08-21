import { lifeDate, type LifeEvent } from "../../lib/animal-life";

/**
 * A cow's life as a spine, not a stack of sections.
 *
 * Her calvings, lactations and services were each in a section of their own,
 * which meant the one thing you could not read off her page was the order
 * they happened in. Drawn along a line it takes a glance.
 *
 * On a phone the line turns vertical rather than the steps shrinking: seven
 * events across 390px is 55px each, which is not a step, it is a column of
 * broken words.
 */
export function LifeTimeline({ events }: { events: LifeEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="life">
      <div className="life__rule" />
      <div className="life__steps">
        {events.map((event) => (
          <div
            key={event.key}
            className={`life__step${event.current ? " life__step--now" : ""}${
              event.kind === "open" ? " life__step--open" : ""
            }`}
          >
            <div className="mono life__date">
              {event.date === ""
                ? "—"
                : event.endDate
                  ? `${lifeDate(event.date)} – ${lifeDate(event.endDate)}`
                  : lifeDate(event.date)}
            </div>
            <div className="life__dot" />
            <div className="serif life__title">{event.title}</div>
            <div className="life__detail">{event.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
