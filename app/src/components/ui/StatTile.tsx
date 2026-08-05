import type { ReactNode } from "react";
import "./stat-tile.css";

export function StatTile({
  value,
  unit,
  label,
  tone = "ink",
  size = "lg",
}: {
  value: ReactNode;
  unit?: ReactNode;
  label: ReactNode;
  tone?: "ink" | "red";
  size?: "lg" | "md";
}) {
  return (
    <div className="stat-tile">
      <div className={`serif mono stat-tile__value stat-tile__value--${size} stat-tile__value--${tone}`}>
        {value} {unit && <span className="stat-tile__unit">{unit}</span>}
      </div>
      <div className="eyebrow stat-tile__label">{label}</div>
    </div>
  );
}
