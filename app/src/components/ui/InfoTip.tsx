import { useEffect, useId, useRef, useState } from "react";
import "./info-tip.css";

/**
 * A figure that will show its working.
 *
 * Tap or click, not hover. Half of this app is used standing in a field on a
 * phone, where there is no hover at all — a tooltip that only opens on hover
 * is a tooltip half the farm can never open.
 *
 * Closes on Escape, on a click outside it, and on a second tap of the button
 * that opened it. On a phone the panel is a sheet across the bottom of the
 * screen rather than a box hanging off the number: anchored to the number it
 * would be clipped by whichever column it happens to sit in.
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
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
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
    <span className="info-tip" ref={wrap}>
      <button
        type="button"
        className="info-tip__button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open && (
        <span className="info-tip__panel" id={panelId} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
