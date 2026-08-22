import { useEffect, useRef, useState } from "react";
import "./save-toast.css";

/**
 * What the farm just saved, said once and then gone.
 *
 * Every page that writes something set a `note` and rendered it as a line of
 * green text in the flow of the page. Three things were wrong with that: it
 * pushed the page down as it appeared, so the thing you had just been looking
 * at moved; it stayed until the next action, so yesterday's "Recorded." was
 * still on screen; and on a long page it appeared above the fold while you
 * were working below it, which is the same as not appearing.
 *
 * A toast fixes all three: fixed to the viewport so nothing reflows, timed so
 * it leaves on its own, and in the same place every time.
 *
 * **It animates out as well as in**, which is the part that used to need a
 * JavaScript animation library. `@starting-style` gives the browser a state
 * to animate *from* on first paint, and `transition-behavior: allow-discrete`
 * lets `display` participate in a transition so the element can be
 * `display: none` at both ends and still fade. Both are in every browser this
 * app supports; where they are not, the toast appears and disappears without
 * the fade, which is the correct thing to degrade to.
 *
 * The text comes straight from the prop and is never copied into state. The
 * caller's note is cleared only once the fade has finished, so the prop is
 * still there for the whole exit — and mirroring it into state through an
 * effect cost a render tick, which showed up as the toast appearing one beat
 * after the save rather than with it.
 */

/** How long it stays before it starts leaving. Long enough to read a sentence
 *  about a withdrawal date, short enough not to sit there. */
const LINGER_MS = 4500;

/** Must match the transition duration in save-toast.css. */
const FADE_MS = 300;

export function SaveToast({
  note,
  onDone,
}: {
  /** What was saved. Null when there is nothing to say. */
  note: string | null;
  /** Clear the caller's note. Called when the toast has finished leaving. */
  onDone: () => void;
}) {
  // Which note the exit has been started for, rather than a plain "leaving"
  // flag. A flag would still be set when the next save arrives, and the new
  // toast would paint mid-fade; comparing against the note itself is false
  // the instant the note changes, with no effect needed to reset it.
  const [leavingFor, setLeavingFor] = useState<string | null>(null);
  // Callers pass an inline arrow, so this identity changes every render. Held
  // in a ref, it can be left out of the effect's dependencies — otherwise the
  // timer below restarts on every render and the toast never leaves.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (note === null) {
      // Saving the same thing twice in a row is two toasts, so the armed note
      // has to be forgotten between them.
      setLeavingFor(null);
      return;
    }
    const leave = setTimeout(() => setLeavingFor(note), LINGER_MS);
    const clear = setTimeout(() => done.current(), LINGER_MS + FADE_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(clear);
    };
  }, [note]);

  const dismiss = () => {
    setLeavingFor(note);
    setTimeout(() => done.current(), FADE_MS);
  };

  if (note === null) return null;
  const leaving = leavingFor === note;

  return (
    <div className="save-toast__slot">
      <button
        type="button"
        className={`save-toast${leaving ? "" : " save-toast--on"}`}
        // Polite rather than assertive: this confirms something the farmer
        // just did, so it should wait its turn rather than interrupt.
        role="status"
        aria-live="polite"
        onClick={dismiss}
        title="Dismiss"
      >
        {note}
      </button>
    </div>
  );
}
