import "./logo.css";

/**
 * The Grazerbook mark: a cloven hoofprint whose two halves are the pages of
 * an open book, the cleft between the toes its spine. Drawn on a 64-unit
 * grid; the same two paths are public/favicon.svg and the home-screen icon,
 * so a change here belongs there too.
 *
 * Green by default. `color` takes any CSS colour — on dark, pass the paper.
 */
export const HOOF_LEFT = "M24 4C15 10 8 23 8.5 38C9 51 15.5 59 23 59C27 59 29 56.5 29 52.5L29 18C29 11 27 6.5 24 4Z";
export const HOOF_RIGHT = "M40 4C49 10 56 23 55.5 38C55 51 48.5 59 41 59C37 59 35 56.5 35 52.5L35 18C35 11 37 6.5 40 4Z";

export function HoofMark({
  size = 24,
  color = "var(--herd-green)",
  title,
}: {
  /** Pixels, or any CSS length — "1.15em" sizes it off the text beside it. */
  size?: number | string;
  color?: string;
  /** Leave unset where the name sits beside it — the name already says it. */
  title?: string;
}) {
  return (
    <svg
      className="hoof-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path d={HOOF_LEFT} fill={color} />
      <path d={HOOF_RIGHT} fill={color} />
    </svg>
  );
}

/**
 * The mark beside the name. The mark is sized in ems, so the font size —
 * from \`size\`, or from a class when it is left out — sets both at once and
 * a media query that shrinks the name shrinks the hoof with it.
 */
export function Wordmark({ size, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      className={`wordmark serif ${className}`.trim()}
      style={size === undefined ? undefined : { fontSize: size }}
    >
      <HoofMark size="1.15em" />
      <span>Grazerbook</span>
    </span>
  );
}
