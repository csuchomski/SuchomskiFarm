import { useCallback, useEffect, useMemo, useState } from "react";
import { Callout } from "../components/ui";
import {
  datesIn,
  deflate,
  fetchMarketHistory,
  indexed,
  rollingMean,
  spread,
  tracksFrom,
  trackFullLabel,
  trackLabel,
  type Basis,
  type ClassTrack,
  type HistoryRow,
} from "../lib/market-history";
import { XYChart, type ChartSeries } from "../components/ui/XYChart";
import "./market-classes.css";

/**
 * Herd → Market → Classes: one class of cattle against another.
 *
 * Bud Williams' sell/buy turns on a comparison the sell/buy tab cannot make,
 * because that tab looks at one class at a time. His argument is that the
 * absolute price is nobody's business — you sell into a market and buy back
 * out of it inside the hour, so what pays is the **relationship between
 * classes on the same day**, and how that relationship has been moving.
 *
 * So the page is built round one question asked several ways: which class has
 * got dear relative to the others? Every control exists to strip something
 * out of the way of that answer — the weight mix, the money, the level — and
 * the page says which are on.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; rows: HistoryRow[] };

/** How the figures are drawn. */
type View = "each" | "overlay" | "ladder" | "spread" | "table";

/**
 * The line colours, in slot order.
 *
 * Not the page's own palette: the Herd tokens sit at a chroma of 0.04 to 0.09,
 * which is right for paper and cannot carry six series — checked, not
 * guessed. These are spaced round OKLCH at a chroma that clears the floor,
 * with alternating lightness, and **green and red are never adjacent slots**,
 * which is where red-green colour blindness collapses a pair. The set passes
 * the lightness band, the chroma floor, adjacent-pair separation under
 * deutan, protan and tritan simulation, the normal-vision floor, and 3:1
 * against the paper.
 *
 * Assigned in fixed order and never cycled. Past six the page stops adding
 * colours and says so, because a seventh would have to repeat one.
 */
const SLOTS = ["#2e7c35", "#3072c1", "#d5a13c", "#8a3785", "#00b5b5", "#c0453b"];
const MAX_OVERLAY = SLOTS.length;

/** The rolling average, in every panel. One colour, because it is the same
 *  thing in each: a line through the noise, not a series of its own. */
const MEAN_COLOUR = "#8a6a2e";

const short = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const shortYear = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** One array, so a render while loading does not look like new data and
 *  send every memo below it round again. */
const NO_ROWS: HistoryRow[] = [];

const num = (s: string, fallback: number): number => {
  const v = Number(s.trim());
  return Number.isFinite(v) ? v : fallback;
};

export default function MarketClasses() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  /**
   * Which drawing, once somebody has chosen one.
   *
   * Null until then, and the default is worked out from the data at render
   * rather than set by an effect: an effect runs after the commit, so the
   * page would paint the wrong view and then correct itself, and there is no
   * ordering to get wrong if nothing is stored.
   */
  const [view, setView] = useState<View | null>(null);

  const [commodity, setCommodity] = useState<string>("Feeder Cattle");
  const [basisKind, setBasisKind] = useState<"average" | "atWeight">("average");
  const [atLb, setAtLb] = useState("600");
  const [real, setReal] = useState(false);
  const [rate, setRate] = useState("3");
  const [scale, setScale] = useState<"dollars" | "indexed">("dollars");
  const [meanWindow, setMeanWindow] = useState(0);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [ladderDate, setLadderDate] = useState<string | null>(null);
  const [spreadPair, setSpreadPair] = useState<[string, string] | null>(null);

  const refresh = useCallback(async () => {
    const rows = await fetchMarketHistory();
    setLoad({ state: "ok", rows });
  }, []);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  const rows = load.state === "ok" ? load.rows : NO_ROWS;

  const basis: Basis = useMemo(
    () => (basisKind === "average" ? { kind: "average" } : { kind: "atWeight", lb: num(atLb, 600) }),
    [basisKind, atLb],
  );

  const allTracks = useMemo(() => tracksFrom(rows, basis), [rows, basis]);

  const commodities = useMemo(
    () => [...new Set(allTracks.map((t) => t.commodity ?? "Uncategorised"))].sort(),
    [allTracks],
  );

  /** The chosen commodity, or the first there is when it does not appear in
   *  this data — derived, so the select is never pointing at nothing. */
  const commodityOn = commodities.includes(commodity) ? commodity : (commodities[0] ?? commodity);

  const tracks = useMemo(
    () => allTracks.filter((t) => (t.commodity ?? "Uncategorised") === commodityOn),
    [allTracks, commodityOn],
  );

  const dates = useMemo(() => datesIn(allTracks), [allTracks]);
  const asOf = dates.length > 0 ? dates[dates.length - 1] : null;

  // With one report there is no trend to draw, and a page opening on a row of
  // single dots has wasted the reader's first look. The ladder is the view a
  // single report can fill, so that is where it opens until there are two.
  const shown: View = view ?? (dates.length < 2 ? "ladder" : "each");

  /** Which classes are drawn. Defaults to the deepest markets in the
   *  commodity — the ones with cattle behind them rather than a lot of four. */
  const chosen = useMemo(() => {
    if (picked === null) return tracks.slice(0, Math.min(3, tracks.length));
    const set = new Set(picked);
    return tracks.filter((t) => set.has(t.key));
  }, [picked, tracks]);

  /** The figures for one track, after the money and the level are settled. */
  const valuesFor = useCallback(
    (t: ClassTrack): (number | null)[] => {
      const nominal = real && asOf !== null ? deflate(t.points, num(rate, 0) / 100, asOf) : t.points.map((p) => p.cwt);
      return scale === "indexed" ? indexed(nominal) : nominal;
    },
    [real, rate, asOf, scale],
  );

  /** A track's figures aligned to every date on the page, so two classes
   *  quoted on different weeks still line up on one axis. */
  const alignedFor = useCallback(
    (t: ClassTrack): (number | null)[] => {
      const by = new Map(t.points.map((p, i) => [p.date, valuesFor(t)[i]]));
      return dates.map((d) => by.get(d) ?? null);
    },
    [dates, valuesFor],
  );

  const yLabel =
    scale === "indexed"
      ? "Index, first report = 100"
      : real
        ? `$ per cwt, in ${asOf === null ? "today's" : new Date(`${asOf}T00:00:00`).getFullYear()} dollars`
        : "$ per cwt, as reported";

  const fmtY = (v: number) => (scale === "indexed" ? v.toFixed(0) : `$${v.toFixed(0)}`);

  if (load.state === "loading") return <p className="mc-dim">Loading…</p>;
  if (load.state === "error") {
    return (
      <Callout tone="dashed">
        Couldn't read the market reports: {load.message}. The sell/buy tab still works on your own
        figures.
      </Callout>
    );
  }
  if (allTracks.length === 0) {
    return (
      <Callout>
        No market reports on file yet. Once the puller has run there will be classes here to
        compare.
      </Callout>
    );
  }

  return (
    <>
      <p className="mc-lede">
        Which class has got dear relative to the others — the only question Bud Williams' sell/buy
        actually turns on. Everything below strips something out of the way of it.
      </p>

      {dates.length < 2 && (
        <Callout>
          <strong>One report so far</strong>, from {shortYear(dates[0])}. The ladder below is drawn
          from it and is the whole of what a single report can say. A trend, a rolling average and
          an inflation adjustment all need more reports than one — they are here and will fill in
          as the puller runs.
        </Callout>
      )}

      {/* ── the controls, in one row above everything they scope ────────── */}
      <div className="mc-controls">
        <label className="grz-field">
          <span className="eyebrow">Cattle</span>
          <select value={commodityOn} onChange={(e) => { setCommodity(e.target.value); setPicked(null); }}>
            {commodities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="grz-field">
          <span className="eyebrow">Priced</span>
          <select
            value={basisKind}
            onChange={(e) => setBasisKind(e.target.value as "average" | "atWeight")}
          >
            <option value="average">By the week's average</option>
            <option value="atWeight">At one weight</option>
          </select>
        </label>

        {basisKind === "atWeight" && (
          <label className="grz-field mc-narrow">
            <span className="eyebrow">Weight, lb</span>
            <input value={atLb} inputMode="numeric" onChange={(e) => setAtLb(e.target.value)} />
          </label>
        )}

        <label className="grz-field">
          <span className="eyebrow">Money</span>
          <select value={real ? "real" : "nominal"} onChange={(e) => setReal(e.target.value === "real")}>
            <option value="nominal">As reported</option>
            <option value="real">In today's dollars</option>
          </select>
        </label>

        {real && (
          <label className="grz-field mc-narrow">
            <span className="eyebrow">Inflation %/yr</span>
            <input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} />
          </label>
        )}

        <label className="grz-field">
          <span className="eyebrow">Level</span>
          <select value={scale} onChange={(e) => setScale(e.target.value as "dollars" | "indexed")}>
            <option value="dollars">Dollars</option>
            <option value="indexed">Indexed to 100</option>
          </select>
        </label>

        <label className="grz-field mc-narrow">
          <span className="eyebrow">Rolling avg</span>
          <select value={meanWindow} onChange={(e) => setMeanWindow(Number(e.target.value))}>
            <option value={0}>Off</option>
            <option value={3}>3 reports</option>
            <option value={5}>5 reports</option>
            <option value={8}>8 reports</option>
          </select>
        </label>
      </div>

      {basisKind === "atWeight" && (
        <p className="mc-note mc-dim">
          Every week priced at {num(atLb, 600)} lb off that week's own ladder, so a week that
          happened to sell light calves does not read as a rally. A class with no rung either side
          of {num(atLb, 600)} lb that week has no figure, and the line breaks rather than guessing.
        </p>
      )}

      {real && (
        <p className="mc-note mc-dim">
          Older money lifted to {asOf === null ? "the latest report" : new Date(`${asOf}T00:00:00`).getFullYear()} dollars at{" "}
          {num(rate, 0)}% a year — <strong>your figure, not an index</strong>; there is no price
          index in this database and this does not invent one. Across a season it is a small
          correction: cattle move thirty percent in a year and this moves three. It earns its keep
          across years, not weeks. Indexing to 100 needs no rate at all — inflation is in both
          halves of a ratio and divides out.
        </p>
      )}

      {/* ── which classes ───────────────────────────────────────────────── */}
      <fieldset className="mc-pick">
        <legend className="eyebrow">Classes ({chosen.length} of {tracks.length})</legend>
        <div className="mc-pick__list">
          {tracks.map((t, i) => {
            const on = chosen.some((c) => c.key === t.key);
            const slot = chosen.findIndex((c) => c.key === t.key);
            const full = !on && shown === "overlay" && chosen.length >= MAX_OVERLAY;
            return (
              <label key={t.key} className={`mc-chip${on ? " mc-chip--on" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={full}
                  onChange={() => {
                    const now = chosen.map((c) => c.key);
                    setPicked(on ? now.filter((k) => k !== t.key) : [...now, t.key]);
                  }}
                />
                <span className="mc-chip__body">
                  <span className="mc-chip__name">
                    {/* The colour only where colour means something. In the
                        per-class view every panel is drawn alike, and a
                        swatch there would promise a key that is not there. */}
                    {on && shown === "overlay" && (
                      <span
                        className="mc-swatch"
                        style={{ background: SLOTS[slot % SLOTS.length] }}
                        aria-hidden="true"
                      />
                    )}
                    {trackLabel(t)}
                  </span>
                  <span className="mc-chip__n">
                    {t.head.toLocaleString()} hd · {t.lowLb}–{t.highLb} lb
                    {i === 0 && t.isLocal ? " · nearest barn" : ""}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {shown === "overlay" && chosen.length >= MAX_OVERLAY && (
          <p className="mc-dim mc-note">
            Six lines is as many as this chart has colours that stay apart for a colour-blind
            reader. A seventh would have to repeat one — use the per-class view for more.
          </p>
        )}
      </fieldset>

      {/* ── which drawing ───────────────────────────────────────────────── */}
      <div className="mc-views" role="group" aria-label="How to draw it">
        {(
          [
            ["each", "One chart each"],
            ["overlay", "All on one"],
            ["ladder", "Price by weight"],
            ["spread", "One against another"],
            ["table", "Figures"],
          ] as const
        ).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            className={`grz-preset${shown === k ? " grz-preset--on" : ""}`}
            aria-pressed={shown === k}
            onClick={() => setView(k)}
          >
            {lab}
          </button>
        ))}
      </div>

      {chosen.length === 0 ? (
        <Callout>Tick a class above and it will be drawn.</Callout>
      ) : shown === "each" ? (
        <EachClass
          tracks={chosen}
          dates={dates}
          alignedFor={alignedFor}
          meanWindow={meanWindow}
          yLabel={yLabel}
          fmtY={fmtY}
        />
      ) : shown === "overlay" ? (
        <Overlay
          tracks={chosen}
          dates={dates}
          alignedFor={alignedFor}
          meanWindow={meanWindow}
          yLabel={yLabel}
          fmtY={fmtY}
        />
      ) : shown === "ladder" ? (
        <Ladder tracks={chosen} dates={dates} at={ladderDate} setAt={setLadderDate} />
      ) : shown === "spread" ? (
        <Spread tracks={tracks} chosen={chosen} pair={spreadPair} setPair={setSpreadPair} dates={dates} />
      ) : (
        <Figures tracks={chosen} dates={dates} alignedFor={alignedFor} fmtY={fmtY} />
      )}

      <p className="mc-foot">
        USDA AMS auction summaries — what cattle actually sold for at those barns on those days,
        which is not a quote for yours. Every figure is gross: commission, yardage, freight, pencil
        shrink and death loss come out before any of it is money.
      </p>
    </>
  );
}

/* ── one chart per class ─────────────────────────────────────────────── */

function EachClass({
  tracks,
  dates,
  alignedFor,
  meanWindow,
  yLabel,
  fmtY,
}: {
  tracks: ClassTrack[];
  dates: string[];
  alignedFor: (t: ClassTrack) => (number | null)[];
  meanWindow: number;
  yLabel: string;
  fmtY: (v: number) => string;
}) {
  return (
    <div className="mc-grid">
      {tracks.map((t) => {
        const values = alignedFor(t);
        const mean = meanWindow > 0 ? rollingMean(values, meanWindow) : null;
        const seen = values.filter((v): v is number => v !== null);
        const last = seen.length > 0 ? seen[seen.length - 1] : null;
        const first = seen.length > 0 ? seen[0] : null;
        const move = first !== null && last !== null && first !== 0 ? (last / first - 1) * 100 : null;

        const series: ChartSeries[] = [
          { label: trackLabel(t), colour: SLOTS[0], values },
          ...(mean
            ? [{ label: `${meanWindow}-report average`, colour: MEAN_COLOUR, values: mean, dashed: true }]
            : []),
        ];

        return (
          <figure key={t.key} className="mc-panel">
            <figcaption className="mc-panel__head">
              <h3 className="serif mc-panel__title">{trackLabel(t)}</h3>
              <p className="mc-dim mc-panel__sub">
                {t.label} · {t.head.toLocaleString()} head · {t.lowLb}–{t.highLb} lb
              </p>
              <p className="mc-panel__now">
                <strong className="mono">{last === null ? "—" : fmtY(last)}</strong>
                {move !== null && seen.length > 1 && (
                  <span className={`mc-move${move >= 0 ? " mc-move--up" : " mc-move--down"}`}>
                    {move >= 0 ? "▲" : "▼"} {Math.abs(move).toFixed(1)}% since {short(dates[0])}
                  </span>
                )}
              </p>
            </figcaption>
            <XYChart
              series={series}
              xLabels={dates.map(short)}
              xTitle="Report date"
              yTitle={yLabel}
              fmtY={fmtY}
              height={240}
              legend={mean !== null}
              compact
            />
          </figure>
        );
      })}
    </div>
  );
}

/* ── all on one ──────────────────────────────────────────────────────── */

function Overlay({
  tracks,
  dates,
  alignedFor,
  meanWindow,
  yLabel,
  fmtY,
}: {
  tracks: ClassTrack[];
  dates: string[];
  alignedFor: (t: ClassTrack) => (number | null)[];
  meanWindow: number;
  yLabel: string;
  fmtY: (v: number) => string;
}) {
  const series: ChartSeries[] = tracks.slice(0, MAX_OVERLAY).flatMap((t, i) => {
    const values = alignedFor(t);
    const line: ChartSeries = { label: trackLabel(t), colour: SLOTS[i % SLOTS.length], values };
    if (meanWindow <= 0) return [line];
    return [
      line,
      {
        label: `${trackLabel(t)}, ${meanWindow}-report average`,
        colour: SLOTS[i % SLOTS.length],
        values: rollingMean(values, meanWindow),
        dashed: true,
      },
    ];
  });

  return (
    <figure className="mc-panel mc-panel--wide">
      <XYChart
        series={series}
        xLabels={dates.map(short)}
        xTitle="Report date"
        yTitle={yLabel}
        fmtY={fmtY}
        height={300}
        legend
      />
      <figcaption className="mc-caption">
        Levels, side by side. Where two classes sit at different money the shapes are hard to
        compare — set <strong>Level</strong> to indexed and both start at 100, which is the
        comparison that answers which one has got dear.
      </figcaption>
    </figure>
  );
}

/* ── price by weight, on one report ──────────────────────────────────── */

function Ladder({
  tracks,
  dates,
  at,
  setAt,
}: {
  tracks: ClassTrack[];
  dates: string[];
  at: string | null;
  setAt: (d: string) => void;
}) {
  const date = at !== null && dates.includes(at) ? at : dates[dates.length - 1];

  const drawn = tracks
    .map((t, i) => ({ t, i, day: t.points.find((p) => p.date === date) }))
    .filter((d) => d.day !== undefined && d.day.rungs.length > 0);

  // Every ladder shares one weight axis, so a heavier class sits to the right
  // of a lighter one rather than being stretched to the same width.
  const all = drawn.flatMap((d) => d.day!.rungs);
  const lo = all.length > 0 ? Math.min(...all.map((r) => r.weightLb)) : 0;
  const hi = all.length > 0 ? Math.max(...all.map((r) => r.weightLb)) : 1;
  const steps = 40;
  const xs = Array.from({ length: steps + 1 }, (_, k) => lo + ((hi - lo) * k) / steps);

  const series: ChartSeries[] = drawn.map(({ t, i, day }) => ({
    label: trackLabel(t),
    colour: SLOTS[i % SLOTS.length],
    // Only inside the rungs that class brought: past them the interpolation
    // goes flat, and a flat tail is a price nobody was paid.
    values: xs.map((w) => {
      const rungs = day!.rungs;
      if (w < rungs[0].weightLb || w > rungs[rungs.length - 1].weightLb) return null;
      const j = rungs.findIndex((r) => r.weightLb >= w);
      if (j <= 0) return rungs[0].cwt;
      const a = rungs[j - 1];
      const b = rungs[j];
      return b.weightLb === a.weightLb
        ? b.cwt
        : a.cwt + ((b.cwt - a.cwt) * (w - a.weightLb)) / (b.weightLb - a.weightLb);
    }),
  }));

  return (
    <figure className="mc-panel mc-panel--wide">
      {dates.length > 1 && (
        <label className="grz-field mc-pick-date">
          <span className="eyebrow">Report</span>
          <select value={date} onChange={(e) => setAt(e.target.value)}>
            {[...dates].reverse().map((d) => (
              <option key={d} value={d}>{shortYear(d)}</option>
            ))}
          </select>
        </label>
      )}
      <XYChart
        series={series}
        xValues={xs}
        xTitle="Weight, lb"
        yTitle="$ per cwt"
        fmtY={(v) => `$${v.toFixed(0)}`}
        fmtX={(v) => String(Math.round(v))}
        height={300}
        legend
      />
      <figcaption className="mc-caption">
        The ladders as reported on {shortYear(date)} — the sell/buy picture in one drawing. Each
        class falls as it gets heavier, and the gap between two ladders at a weight is what trading
        one for the other is worth that day. A class is drawn only across the weights it actually
        brought to town.
      </figcaption>
    </figure>
  );
}

/* ── one against another ─────────────────────────────────────────────── */

function Spread({
  tracks,
  chosen,
  pair,
  setPair,
  dates,
}: {
  tracks: ClassTrack[];
  chosen: ClassTrack[];
  pair: [string, string] | null;
  setPair: (p: [string, string]) => void;
  dates: string[];
}) {
  const fallback: [string, string] = [
    chosen[0]?.key ?? tracks[0]?.key ?? "",
    chosen[1]?.key ?? tracks[1]?.key ?? tracks[0]?.key ?? "",
  ];
  const [aKey, bKey] = pair ?? fallback;
  const a = tracks.find((t) => t.key === aKey) ?? tracks[0];
  const b = tracks.find((t) => t.key === bKey) ?? tracks[1] ?? tracks[0];

  if (a === undefined || b === undefined) return <Callout>Two classes are needed for a ratio.</Callout>;

  const ratios = spread(a.points, b.points);
  const byDate = new Map(ratios.map((r) => [r.date, r.ratio]));
  const values = dates.map((d) => byDate.get(d) ?? null);
  const latest = [...ratios].reverse().find((r) => Number.isFinite(r.ratio));

  return (
    <figure className="mc-panel mc-panel--wide">
      <div className="mc-controls mc-controls--inner">
        <label className="grz-field">
          <span className="eyebrow">This class</span>
          <select value={a.key} onChange={(e) => setPair([e.target.value, b.key])}>
            {tracks.map((t) => (
              <option key={t.key} value={t.key}>{trackLabel(t)}</option>
            ))}
          </select>
        </label>
        <label className="grz-field">
          <span className="eyebrow">Against</span>
          <select value={b.key} onChange={(e) => setPair([a.key, e.target.value])}>
            {tracks.map((t) => (
              <option key={t.key} value={t.key}>{trackLabel(t)}</option>
            ))}
          </select>
        </label>
      </div>

      {ratios.length === 0 ? (
        <Callout>Those two were never quoted on the same report, so there is nothing to divide.</Callout>
      ) : (
        <>
          <p className="mc-panel__now">
            <strong className="mono">{latest === undefined ? "—" : latest.ratio.toFixed(3)}</strong>
            <span className="mc-dim">
              {" "}
              — a pound of {trackLabel(a).toLowerCase()} is worth {latest?.ratio.toFixed(2)} pounds
              of {trackLabel(b).toLowerCase()} on {latest === undefined ? "" : shortYear(latest.date)}
            </span>
          </p>
          <XYChart
            series={[{ label: `${trackLabel(a)} ÷ ${trackLabel(b)}`, colour: SLOTS[0], values }]}
            xLabels={dates.map(short)}
            xTitle="Report date"
            yTitle="Pounds of the second, per pound of the first"
            fmtY={(v) => v.toFixed(2)}
            height={280}
            rule={1}
            ruleLabel="even"
          />
          <figcaption className="mc-caption">
            The sell/buy ratio, and the one view that needs no inflation adjustment at all: the
            money is in both halves and divides out. Above the even line the first class is the
            dearer animal — the one to be selling — whatever either is worth in dollars. A ratio
            drifting up is a trade getting better; the level itself is nobody's business.
          </figcaption>
        </>
      )}
    </figure>
  );
}

/* ── the figures ─────────────────────────────────────────────────────── */

function Figures({
  tracks,
  dates,
  alignedFor,
  fmtY,
}: {
  tracks: ClassTrack[];
  dates: string[];
  alignedFor: (t: ClassTrack) => (number | null)[];
  fmtY: (v: number) => string;
}) {
  const cols = tracks.map((t) => ({ t, values: alignedFor(t) }));
  return (
    <div className="mc-figures">
      <table className="mc-table">
        <thead>
          <tr>
            <th scope="col">Report</th>
            {cols.map(({ t }) => (
              <th key={t.key} scope="col">{trackLabel(t)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...dates].reverse().map((d) => {
            const i = dates.indexOf(d);
            return (
              <tr key={d}>
                <th scope="row" className="mono">{shortYear(d)}</th>
                {cols.map(({ t, values }) => (
                  <td key={t.key} className="mono">
                    {values[i] === null ? <span className="mc-dim">—</span> : fmtY(values[i])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mc-dim mc-note">
        A dash is a report that did not quote that class — or, priced at one weight, a week it did
        not bring cattle of that weight. Not a zero.
      </p>
      <p className="mc-dim mc-note">
        {tracks.map((t) => trackFullLabel(t)).join(" · ")}
      </p>
    </div>
  );
}
