// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SaveToast } from "./SaveToast";

/**
 * The toast every save now uses.
 *
 * The animation itself is CSS and cannot be driven here — jsdom has no layout
 * and no transitions. What is worth pinning is the behaviour around it: that
 * it says what was saved, that it leaves on its own, that it stays readable
 * while it is leaving, that saving the same thing twice shows it twice, and
 * that the caller's note is cleared only once it has gone.
 *
 * The class it carries is the contract with save-toast.css: `--on` is the
 * state @starting-style animates towards, and dropping it is what starts the
 * exit.
 *
 * "appears with the save, not a tick after it" is the one that caught a real
 * defect: the text used to be mirrored into state by an effect, which cost a
 * render, and a page asserting on its own confirmation right after the write
 * saw nothing.
 */

const toast = () => document.querySelector(".save-toast");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("saying what was saved", () => {
  it("shows nothing at all until there is something to say", () => {
    render(<SaveToast note={null} onDone={vi.fn()} />);
    expect(toast()).toBeNull();
  });

  it("appears with the note, in the state the animation ends at", () => {
    render(<SaveToast note="Recorded." onDone={vi.fn()} />);
    expect(screen.getByText("Recorded.")).toBeTruthy();
    expect(toast()!.className).toContain("save-toast--on");
  });

  it("appears with the save, not a tick after it", () => {
    // The text is the prop, not a copy of it made in an effect. With the copy
    // the toast needed a second render before it said anything, and a page
    // that asserted on its own confirmation straight after the write found an
    // empty screen. @starting-style supplies the from-state, so painting in
    // the `--on` state immediately is what animates it in.
    const { container } = render(<SaveToast note="Off the list." onDone={vi.fn()} />);
    const first = container.querySelector(".save-toast");
    expect(first).toBeTruthy();
    expect(first!.textContent).toBe("Off the list.");
    expect(first!.className).toContain("save-toast--on");
  });

  it("is announced politely rather than interrupting", () => {
    // It confirms something the farmer just did; it should wait its turn.
    render(<SaveToast note="Recorded." onDone={vi.fn()} />);
    expect(toast()!.getAttribute("role")).toBe("status");
    expect(toast()!.getAttribute("aria-live")).toBe("polite");
  });
});

describe("leaving on its own", () => {
  it("starts leaving after a while, and keeps its text while it goes", () => {
    render(<SaveToast note="Saved · withdrawal ends 04 Sep" onDone={vi.fn()} />);
    act(() => void vi.advanceTimersByTime(4500));

    // Still mounted and still readable — the exit is a fade, not a removal,
    // and blanking the text mid-fade is what reading the prop would do.
    expect(screen.getByText("Saved · withdrawal ends 04 Sep")).toBeTruthy();
    expect(toast()!.className).not.toContain("save-toast--on");
  });

  it("clears the caller's note only once it has finished going", () => {
    const onDone = vi.fn();
    render(<SaveToast note="Recorded." onDone={onDone} />);

    act(() => void vi.advanceTimersByTime(4500));
    expect(onDone).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(300));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("doesn't restart its timer every render", () => {
    // Callers pass an inline arrow for onDone, so its identity changes on
    // every render. Held in the effect's dependencies it would reset the
    // timer each time and the toast would never leave.
    const onDone = vi.fn();
    const { rerender } = render(<SaveToast note="Recorded." onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(3000));
    for (let i = 0; i < 5; i++) rerender(<SaveToast note="Recorded." onDone={() => onDone()} />);
    act(() => void vi.advanceTimersByTime(1800));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("dismissing it by hand", () => {
  it("goes when it is clicked, without waiting out the timer", () => {
    const onDone = vi.fn();
    render(<SaveToast note="Recorded." onDone={onDone} />);
    fireEvent.click(toast()!);
    expect(toast()!.className).not.toContain("save-toast--on");
    act(() => void vi.advanceTimersByTime(300));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("saving twice", () => {
  /** A page as the routes have it: a note, and a toast that clears it. */
  function Page() {
    const [note, setNote] = useState<string | null>(null);
    return (
      <>
        <button type="button" onClick={() => setNote("Recorded.")}>
          Record it
        </button>
        <SaveToast note={note} onDone={() => setNote(null)} />
      </>
    );
  }

  it("says the same thing again the second time", () => {
    // The note goes back to null between saves, so setting it to the same
    // string is a real change and the effect runs again. If the note were
    // cleared the moment the toast appeared, the second save would set an
    // unchanged value and nothing would happen.
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    expect(toast()!.className).toContain("save-toast--on");

    // Mid-fade: still there, still readable, no longer in the --on state.
    act(() => void vi.advanceTimersByTime(4600));
    expect(toast()!.className).not.toContain("save-toast--on");

    // And once the fade is over the note is cleared and it unmounts.
    act(() => void vi.advanceTimersByTime(300));
    expect(toast()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    expect(toast()!.className).toContain("save-toast--on");
  });
});
