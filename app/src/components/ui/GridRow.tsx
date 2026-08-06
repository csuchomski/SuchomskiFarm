import type { CSSProperties, ReactNode } from "react";
import "./grid-row.css";

/**
 * One row of a hairline-divided rowlist/table. `cols` is a CSS
 * grid-template-columns string — every rowlist across the app (product
 * lists, ledgers, profit-per-head, batches…) shares this shape, just with
 * different column widths.
 *
 * `mobileCols` is the same thing for narrow screens. Most of the desktop
 * templates are fixed pixels totalling 500px or more, which on a phone
 * either overflows the page or squeezes every column to unreadable. Give
 * the columns worth keeping a narrow template here, and mark the cells
 * you're dropping with `className="hide-sm"` so the children still match
 * the tracks.
 *
 * Omitting it keeps the desktop template at every width — fine for two or
 * three flexible columns, wrong for anything wider.
 */
export function GridRow({
  cols,
  mobileCols,
  children,
  as = "header",
  highlight = false,
  padded = true,
  style,
  className = "",
}: {
  cols: string;
  mobileCols?: string;
  children: ReactNode;
  as?: "header" | "body" | "plain";
  highlight?: boolean;
  padded?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  const classes = [
    "grid-row",
    as === "header" ? "grid-row--header eyebrow" : "",
    as === "body" && padded ? "grid-row--body" : "",
    highlight ? "grid-row--highlight" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Passed as custom properties so the breakpoint stays in CSS. A JS media
  // query would need a resize listener and a re-render to stay correct.
  const vars = {
    "--grid-cols": cols,
    "--grid-cols-sm": mobileCols ?? cols,
  } as CSSProperties;

  return (
    <div className={classes} style={{ ...vars, ...style }}>
      {children}
    </div>
  );
}
