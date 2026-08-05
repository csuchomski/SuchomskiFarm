import type { CSSProperties, ReactNode } from "react";
import "./grid-row.css";

/**
 * One row of a hairline-divided rowlist/table. `cols` is a CSS
 * grid-template-columns string — every rowlist across the app (product
 * lists, ledgers, profit-per-head, batches…) shares this shape, just with
 * different column widths.
 */
export function GridRow({
  cols,
  children,
  as = "header",
  highlight = false,
  padded = true,
  style,
  className = "",
}: {
  cols: string;
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

  return (
    <div className={classes} style={{ gridTemplateColumns: cols, ...style }}>
      {children}
    </div>
  );
}
