import { useEffect, useState } from "react";
import "./xy-chart.css";

/**
 * A line chart, with a hover readout.
 *
 * The app draws its own charts — four runtime dependencies, and a charting
 * one for a handful of polylines would be more code than this, not less. This
 * is the shape the Market pages need in five places, so it is written once:
 * several series over a shared x, gaps drawn as gaps, and a crosshair that
 * gives every series' figure at the weight or the week under the pointer.
 *
 * **x comes two ways.** `xLabels` for a categorical axis — report dates, laid
 * out evenly, because the gap between two weekly reports is a week whatever
 * the calendar says. `xValues` for a real number line — weights, where 500 to
 * 600 and 900 to 1,600 are not the same distance and drawing them as though
 * they were would flatten the far end of every ladder.
 */

export interface ChartSeries {
  label: string;
  colour: string;
  /** One figure per x, `null` where there is none. A gap, never a zero. */
  values: (number | null)[];
  dashed?: boolean;
}

interface Props {
  series: ChartSeries[];
  /** Evenly spaced categories — report dates. */
  xLabels?: string[];
  /** A real number line — weights. */
  xValues?: number[];
  xTitle: string;
  yTitle: string;
  fmtY: (v: number) => string;
  fmtX?: (v: number) => string;
  height?: number;
  legend?: boolean;
  /** A horizontal reference line — the even mark on a ratio, say. */
  rule?: number;
  ruleLabel?: string;
  /**
   * Drawn small — in a panel a few hundred pixels wide, rather than across
   * the page.
   *
   * Told rather than measured. Everything in an SVG scales with its viewBox,
   * so a 720-wide chart in a 440px panel renders its 11px labels at seven;
   * and the viewport is wide in that case, so `matchMedia` cannot see it. The
   * caller is the only one that knows how much room it gave.
   */
  compact?: boolean;
}

function niceTicks(min: number, max: number, count: number): { step: number; values: number[] } {
  const span = max - min;
  if (!(span > 0)) return { step: 1, values: [min] };
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    values.push(Number(v.toFixed(10)));
  }
  return values.length > 1 ? { step, values } : { step, values: [min, max] };
}

/** Whether the page is narrow enough that a wide chart would shrink its own
 *  labels to nothing. Everything in an SVG scales with its viewBox. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === "function" && matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(max-width: 700px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function XYChart({
  series,
  xLabels,
  xValues,
  xTitle,
  yTitle,
  fmtY,
  fmtX,
  height = 240,
  legend = false,
  rule,
  ruleLabel,
  compact = false,
}: Props) {
  const [at, setAt] = useState<number | null>(null);
  const narrow = useNarrow() || compact;

  const n = xLabels?.length ?? xValues?.length ?? 0;
  const W = narrow ? 380 : 720;
  const H = narrow ? Math.max(height, 240) : height;
  const PAD = narrow
    ? { top: 14, right: 14, bottom: 46, left: 54 }
    : { top: 14, right: 18, bottom: 46, left: 62 };
  const plotBottom = H - PAD.bottom;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const withRule = rule === undefined ? all : [...all, rule];

  if (n === 0 || all.length === 0) {
    return <p className="xy-empty">Nothing to draw here yet.</p>;
  }

  const rawMin = Math.min(...withRule);
  const rawMax = Math.max(...withRule);
  const pad = (rawMax - rawMin) * 0.12 || Math.abs(rawMax) * 0.1 || 1;
  const minY = rawMin - pad;
  const maxY = rawMax + pad;

  const minX = xValues ? Math.min(...xValues) : 0;
  const maxX = xValues ? Math.max(...xValues) : Math.max(1, n - 1);

  const xAt = (i: number) => {
    const v = xValues ? xValues[i] : i;
    const t = maxX === minX ? 0.5 : (v - minX) / (maxX - minX);
    return PAD.left + t * (W - PAD.left - PAD.right);
  };
  const y = (v: number) =>
    PAD.top + (1 - (v - minY) / (maxY - minY || 1)) * (H - PAD.top - PAD.bottom);

  /** One path per unbroken run, so a gap is a gap rather than a line drawn
   *  straight across a week nobody sold into. */
  const paths = (s: ChartSeries): string[] => {
    const out: string[] = [];
    let cur: string[] = [];
    s.values.forEach((v, i) => {
      if (v === null) {
        if (cur.length > 1) out.push(cur.join(" "));
        cur = [];
        return;
      }
      cur.push(`${cur.length === 0 ? "M" : "L"}${xAt(i).toFixed(1)} ${y(v).toFixed(1)}`);
    });
    if (cur.length > 1) out.push(cur.join(" "));
    return out;
  };

  /** A run of one has no line to draw, so it gets a dot instead — otherwise a
   *  single report, or a lone week between two gaps, renders as nothing. */
  const lonely = (s: ChartSeries): number[] =>
    s.values
      .map((v, i) => (v !== null && (s.values[i - 1] ?? null) === null && (s.values[i + 1] ?? null) === null ? i : -1))
      .filter((i) => i >= 0);

  const ticksY = niceTicks(minY, maxY, narrow ? 3 : 4);
  const every = Math.max(1, Math.ceil(n / (narrow ? 4 : 7)));
  const tickIx = Array.from({ length: n }, (_, i) => i).filter(
    (i) => i === n - 1 || (i % every === 0 && n - 1 - i >= every),
  );

  const moveTo = (clientX: number, rect: DOMRect) => {
    if (rect.width === 0) return;
    const ux = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < n; i += 1) {
      if (Math.abs(xAt(i) - ux) < Math.abs(xAt(best) - ux)) best = i;
    }
    setAt(best);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cur = at ?? 0;
    const go = (i: number) => {
      setAt(Math.max(0, Math.min(n - 1, i)));
      e.preventDefault();
    };
    if (e.key === "ArrowRight") go(cur + 1);
    else if (e.key === "ArrowLeft") go(cur - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "Escape") setAt(null);
  };

  const xName = (i: number) =>
    xLabels ? xLabels[i] : fmtX ? fmtX(xValues![i]) : String(xValues![i]);

  return (
    <div className={`xy${compact ? " xy--compact" : ""}`}>
      {legend && series.length > 1 && (
        <ul className="xy-legend">
          {series.map((s) => (
            <li key={s.label}>
              <svg className="xy-key" viewBox="0 0 22 8" aria-hidden="true">
                <line
                  x1="1"
                  x2="21"
                  y1="4"
                  y2="4"
                  stroke={s.colour}
                  strokeWidth="2"
                  strokeDasharray={s.dashed === true ? "5 4" : undefined}
                />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <div
        className="xy-plot"
        tabIndex={0}
        role="group"
        aria-label={`${yTitle} against ${xTitle}. Arrow keys read the figures along it.`}
        onPointerMove={(e) => moveTo(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        onKeyDown={onKey}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="xy-svg" role="img" aria-label={yTitle}>
          {ticksY.values.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="xy-grid" />
              <text x={PAD.left - 8} y={y(v) + 4} className="xy-axis" textAnchor="end">
                {fmtY(v)}
              </text>
            </g>
          ))}

          {tickIx.map((i) => (
            <text key={i} x={xAt(i)} y={plotBottom + 17} className="xy-axis" textAnchor="middle">
              {xName(i)}
            </text>
          ))}

          <text
            x={PAD.left + (W - PAD.left - PAD.right) / 2}
            y={H - 8}
            className="xy-axis xy-axis--title"
            textAnchor="middle"
          >
            {xTitle}
          </text>
          <text
            className="xy-axis xy-axis--title"
            textAnchor="middle"
            transform={`translate(14 ${PAD.top + (H - PAD.top - PAD.bottom) / 2}) rotate(-90)`}
          >
            {yTitle}
          </text>

          {rule !== undefined && rule >= minY && rule <= maxY && (
            <>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(rule)} y2={y(rule)} className="xy-rule" />
              {ruleLabel !== undefined && (
                <text x={W - PAD.right} y={y(rule) - 6} className="xy-axis" textAnchor="end">
                  {ruleLabel}
                </text>
              )}
            </>
          )}

          {series.map((s) => (
            <g key={s.label}>
              {paths(s).map((d) => (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  stroke={s.colour}
                  strokeWidth={s.dashed === true ? 1.5 : 2}
                  strokeDasharray={s.dashed === true ? "5 4" : undefined}
                />
              ))}
              {lonely(s).map((i) => (
                <circle key={i} cx={xAt(i)} cy={y(s.values[i]!)} r={3.5} fill={s.colour} />
              ))}
            </g>
          ))}

          {at !== null && (
            <g>
              <line x1={xAt(at)} x2={xAt(at)} y1={PAD.top} y2={plotBottom} className="xy-hair" />
              {series.map((s) =>
                s.values[at] === null ? null : (
                  <circle
                    key={s.label}
                    cx={xAt(at)}
                    cy={y(s.values[at])}
                    r={5}
                    fill={s.colour}
                    className="xy-dot"
                  />
                ),
              )}
            </g>
          )}
        </svg>

        {at !== null && (
          <div
            className={`xy-tip${xAt(at) > W * 0.6 ? " xy-tip--left" : ""}`}
            style={{ left: `${(xAt(at) / W) * 100}%` }}
            role="status"
            aria-live="polite"
          >
            <p className="xy-tip__head mono">{xName(at)}</p>
            <dl className="xy-tip__rows">
              {series.map((s) => (
                <div className="xy-tip__row" key={s.label}>
                  <dt>
                    <svg className="xy-key" viewBox="0 0 22 8" aria-hidden="true">
                      <line
                        x1="1"
                        x2="21"
                        y1="4"
                        y2="4"
                        stroke={s.colour}
                        strokeWidth="2"
                        strokeDasharray={s.dashed === true ? "5 4" : undefined}
                      />
                    </svg>
                    {s.label}
                  </dt>
                  <dd className="mono">
                    {s.values[at] === null ? "not quoted" : fmtY(s.values[at])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
