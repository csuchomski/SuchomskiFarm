import "./sparkline.css";

export interface SparkBar {
  h: number; // 0-100
  tone: "tint" | "green" | "ink" | "yellow" | "flat";
}

const toneVar: Record<SparkBar["tone"], string> = {
  tint: "var(--paper-tint)",
  green: "var(--herd-green)",
  ink: "var(--ink)",
  yellow: "var(--hazard-yellow)",
  flat: "var(--page)",
};

export function Sparkline({ bars, height = 64 }: { bars: SparkBar[]; height?: number }) {
  return (
    <div className="sparkline" style={{ height }}>
      {bars.map((bar, i) => (
        <div
          key={i}
          className="sparkline__bar"
          style={{ height: `${Math.max(bar.h, 2)}%`, background: toneVar[bar.tone] }}
        />
      ))}
    </div>
  );
}

/** Two-series variant for the lactation curve: a faint prior-lactation trace
 * behind a solid current-lactation trace, per bar. */
export interface CurvePoint {
  prior: number; // 0-100
  current: number; // 0-100
  tone: "green" | "yellow" | "flat";
}

export function CurveChart({ points, height = 184 }: { points: CurvePoint[]; height?: number }) {
  return (
    <div className="curve-chart" style={{ height }}>
      {points.map((p, i) => (
        <div className="curve-chart__col" key={i}>
          <div className="curve-chart__bar curve-chart__bar--prior" style={{ height: `${p.prior}%` }} />
          <div
            className={`curve-chart__bar curve-chart__bar--${p.tone}`}
            style={{ height: `${Math.max(p.current, 2)}%` }}
          />
        </div>
      ))}
    </div>
  );
}
