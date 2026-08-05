import "./progress-bar.css";

export function ProgressBar({
  label,
  valueLabel,
  pct,
}: {
  label: string;
  valueLabel: string;
  pct: number;
}) {
  return (
    <div className="progress-bar">
      <div className="progress-bar__row mono">
        <span>{label}</span>
        <span className="progress-bar__value">{valueLabel}</span>
      </div>
      <div className="progress-bar__track">
        <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
