import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import "./info-tip.css";

/**
 * Whether this environment can actually show a popover.
 *
 * Opting into popover semantics is not free: the UA stylesheet hides
 * `[popover]` until it is shown. Somewhere that carries the rule without the
 * API — jsdom is exactly that — the panel would be display:none for ever and
 * `showPopover()` would be a no-op. So the attribute goes on only where it
 * can be honoured, and everywhere else the panel is an ordinary fixed
 * element that is still positioned and still readable.
 */
const CAN_POPOVER =
  typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";

/**
 * A figure that will show its working.
 *
 * Tap or click, not hover. Half of this app is used standing in a field on a
 * phone, where there is no hover at all — a tooltip that only opens on hover
 * is a tooltip half the farm can never open.
 *
 * **The panel is a popover, and it is tethered to its button by CSS anchor
 * positioning.** Between them those replace the two workarounds this had
 * before. The top layer means no ancestor can clip it and no z-index has to
 * be picked, so the panel no longer has to become a bottom sheet on a phone
 * to escape its column. `position-try-fallbacks` means the browser flips it
 * when it would run off an edge, so nothing here measures the viewport, and
 * it keeps following its anchor on scroll with no scroll handler.
 *
 * `popover="manual"` rather than `"auto"`. Auto brings light dismiss and
 * Escape for free, but light dismiss fires on pointerdown *outside* the
 * popover — which includes the button that opened it — so a tap on that
 * button closes and immediately reopens. The dismissal below is a few lines,
 * already tested, and does not have that argument with itself.
 *
 * Where anchor positioning is missing the panel is still a popover: it lands
 * centred in the viewport, which is a reasonable thing for a small panel of
 * figures to do. Where popovers are missing too it is an ordinary fixed
 * element. Neither case is clipped and neither is unreadable.
 */
export function InfoTip({
  label,
  children,
}: {
  /** What the button says to a screen reader — name the figure it explains. */
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const rawId = useId();
  // useId returns something like ":r7:", and a dashed-ident may not contain
  // colons. The name has to be per-instance: two tips sharing one anchor name
  // would both resolve to whichever element came last.
  const anchor = `--tip-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const panelId = `tip-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  // Layout effect, not an effect: a popover is display:none until it is
  // shown, and doing that after paint is a frame of nothing.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el || !open) return;
    if (CAN_POPOVER) el.showPopover();
    return () => {
      // It may already have been closed by the browser — hidePopover throws
      // on a popover that is not open.
      if (CAN_POPOVER && el.isConnected) {
        try {
          el.hidePopover();
        } catch {
          /* already closed */
        }
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      // The panel is in the top layer but still a DOM child of the wrapper,
      // so one containment check covers the button and the panel both.
      if (!wrap.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <span className="info-tip" ref={wrap} style={{ ["--tip-anchor" as string]: anchor }}>
      <button
        type="button"
        className="info-tip__button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <div
          className="info-tip__panel"
          id={panelId}
          ref={panel}
          popover={CAN_POPOVER ? "manual" : undefined}
          role="note"
        >
          {children}
        </div>
      )}
    </span>
  );
}
