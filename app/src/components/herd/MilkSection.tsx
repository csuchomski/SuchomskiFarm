import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GridRow, Pill, StatTile } from "../ui";
import { fetchProductionRecords, type RealProductionRecord } from "../../lib/milkings";
import {
  buildMilkDays,
  fetchMilkContext,
  summariseMilk,
  type MilkContext,
  type MilkDay,
} from "../../lib/animal-milk";
import { lifeDate } from "../../lib/animal-life";
import { todayLocal } from "../../lib/local-time";

/**
 * What she is giving, and what became of it.
 *
 * The day range is the control: 30 days is what a farmer checks, but a cow
 * fresh a fortnight ago has only a fortnight to show, and a question about
 * last season needs 90. The table always shows the same days as the chart —
 * two ranges would be two answers to one question.
 *
 * **Status is drawn twice on purpose**: as the bar's fill and again in words
 * in the table. Sold is solid, on-hand is an outline and binned is red, so
 * the three are distinguishable in shape as well as colour.
 */

const RANGES = [7, 14, 30, 60, 90];

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLS = "minmax(0, 1fr) 96px 168px 96px";
const COLS_SM = "minmax(0, 1fr) 76px 96px";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; records: RealProductionRecord[]; context: MilkContext };

export function MilkSection({
  animalId,
  farmId,
  businessId,
  name,
}: {
  animalId: string;
  farmId: string | null;
  businessId: number | null;
  name: string;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [days, setDays] = useState(30);
  const [hover, setHover] = useState<string | null>(null);
  const today = todayLocal();

  const read = useCallback(async () => {
    if (!farmId || businessId === null) {
      setLoad({ state: "ok", records: [], context: { priceCents: 0, productId: null, liveBatchIds: new Set(), discardedDates: new Set() } });
      return;
    }
    const [records, context] = await Promise.all([
      fetchProductionRecords(farmId),
      fetchMilkContext(businessId),
    ]);
    setLoad({ state: "ok", records: records.filter((r) => r.animal_id === animalId), context });
  }, [animalId, farmId, businessId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    read().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [read]);

  const rows: MilkDay[] = useMemo(() => {
    if (load.state !== "ok") return [];
    return buildMilkDays({
      records: load.records,
      liveBatchIds: load.context.liveBatchIds,
      discardedDates: load.context.discardedDates,
      priceCents: load.context.priceCents,
      days,
      today,
    });
  }, [load, days, today]);

  const summary = useMemo(() => summariseMilk(rows), [rows]);
  const milked = rows.filter((r) => r.recorded);

  if (load.state === "loading") {
    return <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Loading her milk…</p>;
  }
  if (load.state === "error") {
    return <p style={{ fontSize: 13, color: "var(--red)" }}>{load.message}</p>;
  }

  return (
    <>
      <div className="section__head">
        <div className="serif" style={{ fontSize: 21 }}>
          Milk
        </div>
        <div className="milk-ranges">
          {RANGES.map((n) => (
            <button
              key={n}
              type="button"
              className={`milk-range${n === days ? " milk-range--on" : ""}`}
              aria-pressed={n === days}
              onClick={() => {
                setDays(n);
                setHover(null);
              }}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: -8, marginBottom: 16 }}>
        {days} days to {lifeDate(today)} · the table below shows the same days.
      </p>

      {milked.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 16 }}>
          Nothing recorded for {name} in these {days} days.
        </p>
      ) : (
        <>
          <MilkChart rows={rows} hover={hover} onHover={setHover} />

          <div className="milk-legend">
            <span>
              <span className="milk-key milk-key--sold" /> Sold
            </span>
            <span>
              <span className="milk-key milk-key--held" /> In inventory
            </span>
            <span>
              <span className="milk-key milk-key--binned" /> Discarded
            </span>
          </div>

          <div className="stat-row" style={{ borderTop: "1px solid var(--hairline)", marginTop: 12 }}>
            <StatTile size="md" value={summary.gallons} unit="gal" label={`She gave · ${summary.days} days`} />
            <StatTile size="md" value={money(summary.soldCents)} label="Sold" />
            <StatTile
              size="md"
              value={money(summary.onHandCents)}
              label={`On hand · ${summary.onHandGallons} gal`}
            />
            <StatTile
              size="md"
              tone={summary.discardedGallons > 0 ? "red" : undefined}
              value={summary.discardedGallons}
              unit="gal"
              label={`Discarded · ${money(summary.discardedCents)} lost`}
            />
          </div>

          <div className="milk-table">
            <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
              <span>Date</span>
              <span className="text-right">Gallons</span>
              <span className="hide-sm">Status</span>
              <span className="text-right">Value</span>
            </GridRow>
            {milked.map((row) => (
              <GridRow key={row.key} cols={COLS} mobileCols={COLS_SM} as="body">
                <span className="mono">
                  {lifeDate(row.date)}
                  {/* The status column is dropped on a phone, and colour on
                      its own is not a label. It comes back under the date. */}
                  <span className="show-sm milk-status-sm">
                    {row.status === "sold" ? "Sold" : row.status === "inventory" ? "In inventory" : "Discarded"}
                  </span>
                </span>
                <span className="mono text-right">{row.gallons.toFixed(1)}</span>
                <span className="hide-sm">
                  <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
                    {row.status === "sold" ? "Sold" : row.status === "inventory" ? "In inventory" : "Discarded"}
                  </span>
                </span>
                <span className="mono text-right">
                  {row.status === "discarded" ? (
                    <Pill variant="withdrawal">binned</Pill>
                  ) : (
                    money(row.valueCents)
                  )}
                </span>
              </GridRow>
            ))}
          </div>

          <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 12, maxWidth: "68ch" }}>
            A day is valued at the milk price today. What a pickup actually paid is attributed across
            the days it drew from, so the money below is the earned figure and this is the estimate.
          </p>
        </>
      )}
    </>
  );
}

/**
 * A first guess at the chart's width, refined by the observer once it is on
 * screen. Guessing rather than starting at 1120 is what keeps a phone's
 * first paint from being a 60px strip that then jumps to full height — and
 * it is the whole answer in a browser with no ResizeObserver.
 */
function guessWidth(): number {
  if (typeof window === "undefined") return 1120;
  const rail = window.innerWidth > 860 ? 208 : 0;
  const padding = window.innerWidth > 860 ? 64 : 32;
  return Math.max(320, Math.min(1120, window.innerWidth - rail - padding));
}

/**
 * Bars, one slot per day in the window.
 *
 * A day she was not milked keeps its slot and draws nothing: the gap is the
 * fact. Rounded tops anchored to the baseline, 2px between fills, and the
 * peak carries the only direct label — a number over every bar is noise at
 * 90 days and unreadable at 7.
 */
function MilkChart({
  rows,
  hover,
  onHover,
}: {
  rows: MilkDay[];
  hover: string | null;
  onHover: (key: string | null) => void;
}) {
  /**
   * The chart is drawn at the width it actually has.
   *
   * A fixed 1120-wide viewBox scaled to a 358px phone is 61px tall — a strip
   * too short to read a gallon off. Measuring means the bars are 1:1 with
   * their pixels and the height stays 190 at every width.
   */
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(guessWidth);

  useEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(320, Math.round(entry.contentRect.width));
      setWidth((current) => (Math.abs(current - next) > 1 ? next : current));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const W = width;
  const H = 190;
  const PAD_L = 46;
  const PLOT_H = 154;
  const TOP_Y = 10;

  const geometry = useMemo(() => {
    const plotW = W - PAD_L - 8;
    const top = Math.max(1, Math.ceil(Math.max(...rows.map((r) => r.gallons), 1)));
    const slot = plotW / rows.length;
    const barW = Math.max(2, Math.min(26, slot - 2));
    const peak = rows.reduce((m, r) => (r.gallons > m.gallons ? r : m), rows[0]);

    const bars = rows
      .filter((r) => r.recorded)
      .map((r) => {
        const i = rows.indexOf(r);
        const h = Math.max(1, (r.gallons / top) * PLOT_H);
        const x = PAD_L + i * slot + (slot - barW) / 2;
        const y = TOP_Y + PLOT_H - h;
        const radius = Math.min(4, barW / 2, h);
        return {
          row: r,
          d:
            `M${x},${y + h} L${x},${y + radius} Q${x},${y} ${x + radius},${y}` +
            ` L${x + barW - radius},${y} Q${x + barW},${y} ${x + barW},${y + radius}` +
            ` L${x + barW},${y + h} Z`,
          hitX: PAD_L + i * slot,
          hitW: slot,
          midX: x + barW / 2,
          labelY: y - 6,
          isPeak: r.key === peak.key && peak.recorded,
        };
      });

    // A day she was not milked keeps its slot and gets a tick on the
    // baseline. Twenty-eight blank pixels read as a broken chart; twenty-eight
    // ticks read as twenty-eight days she was not milked.
    const gaps = rows
      .filter((r) => !r.recorded)
      .map((r) => ({ key: r.key, x: PAD_L + rows.indexOf(r) * slot + slot / 2 }));

    return {
      bars,
      gaps,
      top,
      lines: [0, 0.5, 1].map((f) => {
        const value = top * f;
        return {
          f,
          y: TOP_Y + PLOT_H - f * PLOT_H,
          // 2.5 on a scale that tops out at 5 — rounding it to 3 would put a
          // number against a line that is not there.
          label: Number.isInteger(value) ? String(value) : value.toFixed(1),
        };
      }),
    };
  }, [rows, W]);

  const hovered = geometry.bars.find((b) => b.row.key === hover) ?? null;

  return (
    <div className="milk-chart" ref={box} onMouseLeave={() => onHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label="Gallons a day">
        {geometry.lines.map((line) => (
          <g key={line.f}>
            <line x1={PAD_L} y1={line.y} x2={W - 8} y2={line.y} stroke="var(--hairline)" strokeWidth={1} />
            <text
              x={PAD_L - 8}
              y={line.y}
              textAnchor="end"
              dominantBaseline="middle"
              className="mono"
              fontSize={11}
              fill="var(--ink-faint)"
            >
              {line.label}
            </text>
          </g>
        ))}

        {geometry.gaps.map((gap) => (
          <line
            key={gap.key}
            x1={gap.x}
            y1={TOP_Y + PLOT_H - 2}
            x2={gap.x}
            y2={TOP_Y + PLOT_H}
            stroke="var(--ink-faint)"
            strokeWidth={1}
          />
        ))}

        {geometry.bars.map((bar) => (
          <g key={bar.row.key}>
            <path
              d={bar.d}
              fill={
                bar.row.status === "sold"
                  ? "var(--herd-green)"
                  : bar.row.status === "discarded"
                    ? "var(--red)"
                    : "var(--paper)"
              }
              stroke={bar.row.status === "inventory" ? "var(--ink-faint)" : "none"}
              strokeWidth={1}
            />
            {bar.isPeak && (
              <text x={bar.midX} y={bar.labelY} textAnchor="middle" className="mono" fontSize={11} fill="var(--ink-soft)">
                {bar.row.gallons.toFixed(1)}
              </text>
            )}
            <rect
              x={bar.hitX}
              y={0}
              width={bar.hitW}
              height={TOP_Y + PLOT_H}
              fill="transparent"
              onMouseEnter={() => onHover(bar.row.key)}
            />
          </g>
        ))}

        <line x1={PAD_L} y1={TOP_Y + PLOT_H} x2={W - 8} y2={TOP_Y + PLOT_H} stroke="var(--ink)" strokeWidth={1} />
        <text x={PAD_L} y={TOP_Y + PLOT_H + 18} fontSize={11} fill="var(--ink-muted)">
          gallons a day
        </text>
      </svg>

      {hovered && (
        <div className="milk-tip" style={{ left: `${((hovered.hitX + hovered.hitW / 2) / W) * 100}%` }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
            {lifeDate(hovered.row.date)}
          </div>
          <div className="serif mono" style={{ fontSize: 19, margin: "2px 0 4px" }}>
            {hovered.row.gallons.toFixed(1)} gal
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
            <span>
              {hovered.row.status === "sold"
                ? "Sold"
                : hovered.row.status === "inventory"
                  ? "In inventory"
                  : "Discarded"}
            </span>
            <span className="mono">
              {hovered.row.status === "discarded" ? "—" : money(hovered.row.valueCents)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
