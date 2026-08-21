import type { TagAccent } from "../../lib/types";
import "./ear-tag.css";

const accentVar: Record<TagAccent, string> = {
  herd: "var(--herd-green)",
  guernsey: "var(--ink-faint)",
  withdrawal: "var(--hazard-yellow)",
  "at-risk": "var(--red)",
};

export function EarTag({
  tag,
  accent,
  size = "md",
}: {
  tag: string;
  accent: TagAccent;
  size?: "sm" | "md" | "lg";
}) {
  // An animal with no tag renders as an empty chip, which reads as a layout
  // fault rather than as missing information. Migration 059 stops new ones
  // being written; the rows that predate it still have to say what they are.
  const blank = tag.trim() === "";
  return (
    <span
      className={`ear-tag ear-tag--${size} mono`}
      style={{ borderLeftColor: accentVar[accent], ...(blank ? { color: "var(--ink-faint)" } : null) }}
    >
      {blank ? "no tag" : tag}
    </span>
  );
}
