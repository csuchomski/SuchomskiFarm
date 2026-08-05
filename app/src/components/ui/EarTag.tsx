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
  return (
    <span
      className={`ear-tag ear-tag--${size} mono`}
      style={{ borderLeftColor: accentVar[accent] }}
    >
      {tag}
    </span>
  );
}
