import { useCallback, useEffect, useMemo, useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, StatTile } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import { fetchWeighings } from "../lib/grazing";
import {
  gainFrom,
  priceAt,
  projection,
  SAMPLE_SLIDE,
  SAMPLE_WEIGHTS,
  sellBuy,
  sellWindow,
  valueAt,
  type ProjectionPoint,
  type SlidePoint,
  type WeightPoint,
} from "../lib/sell-buy";
import "./sell-buy.css";

/**
 * Herd → Market: the sell/buy analyzer.
 *
 * Two questions the grazing pages cannot answer, because both need a price.
 *
 * **When does the gain stop paying?** Cattle get cheaper per hundredweight as
 * they get heavier, so there is a weight past which another month of grass
 * adds less value than it costs — while the animal goes on getting heavier
 * and going on being worth more in total, which is what makes it easy to miss.
 *
 * **Is trading down the ladder better than keeping them?** Sell heavy, buy
 * light, pocket the spread, and put the pounds back on. Whether that beats
 * standing still is one division: cash freed over pounds given up, against
 * cost of gain.
 *
 * The maths is in `sell-buy.ts` and tested there. This page is the form and
 * the drawing.
 *
 * **The slide is play data** until there is a market feed, and every figure
 * here is gross — commission, yardage, freight, shrink and death loss are not
 * modelled. Both are said on the page rather than only here, because a
 * printout of invented prices that does not admit it is worse than no page.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; animals: RealAnimal[] };

/** The farm's own slide, per browser. Not a schema: there is no feed yet, and
 *  a table for figures that will be replaced by one is a table to migrate
 *  away. Same storage the wire's unit uses. */
const SLIDE_KEY = "grazer.priceSlide";

function readSlide(): SlidePoint[] {
  try {
    const raw = localStorage.getItem(SLIDE_KEY);
    if (raw === null) return SAMPLE_SLIDE;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return SAMPLE_SLIDE;
    const rungs = parsed
      .map((r) => r as Record<string, unknown>)
      .filter((r) => Number.isFinite(r.weightLb) && Number.isFinite(r.cwt))
      .map((r) => ({ weightLb: Number(r.weightLb), cwt: Number(r.cwt) }));
    return rungs.length > 0 ? rungs : SAMPLE_SLIDE;
  } catch {
    // A private window, blocked site data, or something else's key under this
    // name. The sample is the right answer to all three.
    return SAMPLE_SLIDE;
  }
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const money2 = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const nameOf = (a: RealAnimal) => a.barn_name || `Tag ${a.ear_tag}`;

const num = (s: string): number => {
  const v = Number(s.trim());
  return Number.isFinite(v) ? v : 0;
};

const today = () => new Date().toISOString().slice(0, 10);

/** What the table holds, as typed rather than as parsed — same reason the
 *  wire's width box holds a draft: "5" on its way to "550" must not be read
 *  as a five-pound calf mid-keystroke. */
interface WeightRow {
  date: string;
  lb: string;
}

const rowsFrom = (points: WeightPoint[]): WeightRow[] =>
  points.map((p) => ({ date: p.date, lb: String(p.weightLb) }));

export default function SellBuy() {
  const { business, farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const [rows, setRows] = useState<WeightRow[]>(() => rowsFrom(SAMPLE_WEIGHTS));
  /** Which animal the weights were taken from, when they came from one.
   *  Null while the sample is showing or the table has been hand-edited. */
  const [fromAnimal, setFromAnimal] = useState<string | null>(null);
  const [slide, setSlide] = useState<SlidePoint[]>(readSlide);
  const [editingSlide, setEditingSlide] = useState(false);
  const [cog, setCog] = useState("1.15");
  const [replacement, setReplacement] = useState("500");
  /**
   * Margin first.
   *
   * The value-of-gain view shows the mechanism, and on a real slide that
   * mechanism is a sawtooth — the marginal line crosses cost of gain four or
   * five times, because the slide eases at every weight class. Read first, it
   * invites the wrong answer: "it is back above the line at 840, so grow them
   * to 840". The margin curve is one hump and its peak is the answer.
   */
  const [mode, setMode] = useState<"vog" | "margin">("margin");

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "error", message: "No farm on this business." });
      return;
    }
    const animals = await fetchAnimals(farmId);
    setLoad({ state: "ok", animals: animals.filter((a) => a.status === "active") });
  }, [farmId]);

  useEffect(() => {
    setLoad({ state: "loading" });
    refresh().catch((err) =>
      setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(SLIDE_KEY, JSON.stringify(slide));
    } catch {
      // Nothing to do about it and nothing worth saying: the slide still works
      // for this visit, it just will not be here next time.
    }
  }, [slide]);

  /** Load one animal's weighings over the table. */
  const takeFrom = async (animalId: string) => {
    if (!farmId || animalId === "") {
      setFromAnimal(null);
      setRows(rowsFrom(SAMPLE_WEIGHTS));
      return;
    }
    const weighings = await fetchWeighings(farmId, animalId);
    setFromAnimal(animalId);
    setRows(
      weighings.length === 0
        ? []
        : rowsFrom(
            weighings
              .map((w) => ({ date: w.date, weightLb: w.weightLb }))
              .sort((a, b) => a.date.localeCompare(b.date)),
          ),
    );
  };

  const gain = useMemo(
    () => gainFrom(rows.map((r) => ({ date: r.date, weightLb: num(r.lb) }))),
    [rows],
  );

  const currentLb = gain.currentLb ?? 0;
  const costOfGain = num(cog);
  const replacementLb = num(replacement);

  /**
   * The heaviest weight the slide has anything to say about.
   *
   * The road stops here rather than running the usual 350 lb ahead. Past the
   * last rung `priceAt` goes flat, so gain up there looks worth full price
   * for ever — and drawn, that artifact is the biggest thing on the chart and
   * the eye goes straight to it. Better to draw only what the farm has
   * priced, and say when that is not far enough.
   */
  const topRung = slide.length === 0 ? 0 : Math.max(...slide.map((r) => r.weightLb));

  const points = useMemo(
    () =>
      projection({
        slide,
        fromLb: currentLb,
        costOfGain,
        adg: gain.adg,
        aheadLb: Math.max(0, Math.min(350, topRung - currentLb)),
      }),
    [slide, currentLb, costOfGain, gain.adg, topRung],
  );

  const window_ = useMemo(() => sellWindow(points, costOfGain), [points, costOfGain]);
  const trade = useMemo(
    () => sellBuy({ slide, sellLb: currentLb, replacementLb, costOfGain, adg: gain.adg }),
    [slide, currentLb, replacementLb, costOfGain, gain.adg],
  );

  /**
   * Whether the slide has run out before the question has.
   *
   * Either the animal is already at the top rung, or the road was cut short
   * by it and the gain was still paying when it stopped. Asked as "did the
   * peak land on the last step" rather than by comparing weights: the road
   * steps ten pounds at a time and rarely lands on the rung exactly — from
   * 676 it stops at 866, nine short of 875, and a weight comparison never
   * fires.
   */
  const roadCutShort = currentLb > 0 && topRung - currentLb <= 350;
  const stillPayingAtTheEnd =
    window_ !== null && points.length > 0 && window_.weightLb === points[points.length - 1].weightLb;
  const slideRunsOut = currentLb > 0 && (currentLb >= topRung || (roadCutShort && stillPayingAtTheEnd));

  const setRow = (i: number, patch: Partial<WeightRow>) => {
    setRows((rs) => rs.map((r, j) => (i === j ? { ...r, ...patch } : r)));
    setFromAnimal(null);
  };

  const setRung = (i: number, cwt: string) =>
    setSlide((rs) => rs.map((r, j) => (i === j ? { ...r, cwt: num(cwt) } : r)));

  const animals = load.state === "ok" ? load.animals : [];

  return (
    <OpsShell>
      <PageHeader
        eyebrow={business?.name ?? "Herd"}
        title="Sell/buy analyzer"
        actions={
          slide !== SAMPLE_SLIDE ? (
            <Button onClick={() => setSlide(SAMPLE_SLIDE)}>Reset the slide</Button>
          ) : undefined
        }
      />

      <p className="sb-lede">
        What the next hundred pounds are worth, and whether trading down the weight ladder pays
        better than keeping the cattle you have.
      </p>

      {load.state === "error" && (
        <div style={{ paddingTop: 8 }}>
          <Callout>{load.message}</Callout>
        </div>
      )}

      {/* ── 01 the animal ─────────────────────────────────────────────── */}
      <section className="sb-section">
        <h2 className="sb-h">
          <span className="mono sb-h__n">01</span>
          <span className="serif">Weight history</span>
          <span className="sb-h__note">
            {fromAnimal === null ? "sample figures — pick an animal to use real ones" : "from the weights table"}
          </span>
        </h2>

        <div className="sb-two">
          <div>
            {animals.length > 0 && (
              <label className="grz-field sb-pick">
                <span className="eyebrow">Take the weights from</span>
                <select
                  value={fromAnimal ?? ""}
                  onChange={(e) => void takeFrom(e.target.value)}
                  aria-label="Take the weights from"
                >
                  <option value="">Sample figures</option>
                  {animals.map((a) => (
                    <option key={a.id} value={a.id}>
                      {nameOf(a)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <table className="sb-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Weight</th>
                  <th>Interval gain</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const step = gain.intervals.find((x) => x.to === r.date) ?? null;
                  return (
                    <tr key={i}>
                      <td>
                        <input
                          type="date"
                          value={r.date}
                          onChange={(e) => setRow(i, { date: e.target.value })}
                          aria-label={`Weighing ${i + 1} date`}
                        />
                      </td>
                      <td>
                        <input
                          className="sb-lb"
                          value={r.lb}
                          inputMode="decimal"
                          onChange={(e) => setRow(i, { lb: e.target.value })}
                          aria-label={`Weighing ${i + 1} weight`}
                        />
                        <span className="sb-unit">lb</span>
                      </td>
                      <td className="mono sb-dim">
                        {step === null ? "—" : `${step.adg.toFixed(2)} lb/d`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length === 0 && (
              <p className="sb-dim sb-empty">
                Nothing weighed on this animal yet. Add a row, or pick another.
              </p>
            )}

            <Button
              onClick={() =>
                setRows((rs) => [...rs, { date: today(), lb: String(currentLb || "") }])
              }
            >
              Add a weighing
            </Button>
          </div>

          <div className="stat-row sb-stats">
            <StatTile
              value={currentLb > 0 ? currentLb : "—"}
              unit={currentLb > 0 ? "lb" : undefined}
              label="Weight now"
              size="md"
            />
            <StatTile
              value={gain.adg === null ? "—" : gain.adg.toFixed(2)}
              unit={gain.adg === null ? undefined : "lb/d"}
              label={gain.adg === null ? "Gain — needs two weighings" : `Gain over ${Math.round(gain.days)} days`}
              size="md"
            />
            <StatTile
              value={currentLb > 0 ? priceAt(slide, currentLb).toFixed(2) : "—"}
              unit={currentLb > 0 ? "$/cwt" : undefined}
              label="Price at this weight"
              size="md"
            />
            <StatTile
              value={currentLb > 0 ? money(valueAt(slide, currentLb)) : "—"}
              label="Worth today, gross"
              size="md"
            />
          </div>
        </div>
      </section>

      {/* ── 02 the slide ──────────────────────────────────────────────── */}
      <section className="sb-section">
        <h2 className="sb-h">
          <span className="mono sb-h__n">02</span>
          <span className="serif">Price slide</span>
          <span className="sb-h__note">play data — no market feed yet</span>
        </h2>

        <div className="sb-panel">
          <div className="sb-panel__head">
            <p className="sb-dim" style={{ margin: 0 }}>
              What cattle fetch per hundredweight at each weight. Prices between rungs are
              worked out in a straight line; above and below the ends they go flat.
            </p>
            <Button onClick={() => setEditingSlide(!editingSlide)}>
              {editingSlide ? "Done" : "Edit the slide"}
            </Button>
          </div>

          {editingSlide ? (
            <div className="sb-rungs">
              {slide.map((r, i) => (
                <label key={r.weightLb} className="sb-rung">
                  <span className="eyebrow">{r.weightLb} lb</span>
                  <input
                    value={String(r.cwt)}
                    inputMode="decimal"
                    onChange={(e) => setRung(i, e.target.value)}
                    aria-label={`Price at ${r.weightLb} lb`}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="sb-slide-read mono">
              {slide.map((r) => (
                <span key={r.weightLb}>
                  <span className="sb-dim">{r.weightLb}</span> {r.cwt.toFixed(0)}
                </span>
              ))}
            </p>
          )}
        </div>
      </section>

      {/* ── 03 the crossing ───────────────────────────────────────────── */}
      <section className="sb-section">
        <h2 className="sb-h">
          <span className="mono sb-h__n">03</span>
          <span className="serif">When does the gain stop paying?</span>
        </h2>

        <div className="sb-controls">
          <label className="grz-field sb-narrow">
            <span className="eyebrow">Cost of gain</span>
            <input
              value={cog}
              inputMode="decimal"
              onChange={(e) => setCog(e.target.value)}
              aria-label="Cost of gain"
            />
          </label>
          <span className="sb-unit sb-unit--tall">$/lb</span>
          <div className="sb-modes" role="group" aria-label="What to draw">
            {(
              [
                ["vog", "Value of gain"],
                ["margin", "Margin per head"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`grz-preset${mode === k ? " grz-preset--on" : ""}`}
                aria-pressed={mode === k}
                onClick={() => setMode(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {points.length === 0 ? (
          <Callout>Give the animal a weight and there is something to work out.</Callout>
        ) : (
          <div className="sb-panel">
            <GainChart points={points} costOfGain={costOfGain} window_={window_} mode={mode} />

            <div className="stat-row sb-stats">
              <StatTile
                value={window_ === null ? "Now" : `${window_.weightLb}`}
                unit={window_ === null ? undefined : "lb"}
                label="Sell window closes"
                tone={window_ === null ? "red" : "ink"}
                size="md"
              />
              <StatTile
                value={window_?.days == null ? "—" : Math.round(window_.days)}
                unit={window_?.days == null ? undefined : "days"}
                label={gain.adg === null ? "Days out — needs a gain rate" : "Days out at that rate"}
                size="md"
              />
              <StatTile
                value={money2(window_?.margin ?? 0)}
                label="Margin to there, per head"
                size="md"
              />
            </div>

            <p className="sb-dim sb-note">
              {window_ === null ? (
                <>
                  Nothing ahead of today's weight pays for itself at {money2(costOfGain)} a pound.
                  These cattle are costing money to keep, even as they go on getting heavier and
                  going on being worth more in total — which is what makes it easy to miss.
                </>
              ) : (
                <>
                  Growing them to {window_.weightLb} lb earns{" "}
                  <strong className="mono">{money2(window_.margin)}</strong> a head over cost of
                  gain, and that is the most there is. Past it the margin falls — and where the
                  marginal line climbs back above cost at heavier weights, it never makes up the
                  ground lost getting there.
                </>
              )}
            </p>

            {slideRunsOut && (
              <p className="grz-warn sb-note">
                The slide stops at {topRung} lb and the question does not. Above its last rung the
                price goes flat, which would make gain up there look worth full price for ever — so
                the road stops there too. Add a heavier rung to see past it.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── 04 sell/buy ───────────────────────────────────────────────── */}
      <section className="sb-section">
        <h2 className="sb-h">
          <span className="mono sb-h__n">04</span>
          <span className="serif">Trade down the ladder</span>
          <span className="sb-h__note">Bud Williams' sell/buy</span>
        </h2>

        <div className="sb-two sb-two--narrow-first">
          <div className="sb-panel sb-panel--tight">
            <label className="grz-field">
              <span className="eyebrow">Buy back in at</span>
              <input
                value={replacement}
                inputMode="decimal"
                onChange={(e) => setReplacement(e.target.value)}
                aria-label="Buy back in at"
              />
            </label>
            <p className="sb-dim" style={{ marginBottom: 0 }}>
              Sell at {currentLb} lb for {priceAt(slide, currentLb).toFixed(0)} $/cwt, buy back at{" "}
              {replacementLb} lb for {priceAt(slide, replacementLb).toFixed(0)} $/cwt.
            </p>
          </div>

          <div>
            <div className="stat-row sb-stats">
              <StatTile value={money(trade.proceeds)} label={`Sale, at ${currentLb} lb`} size="md" />
              <StatTile
                value={money(trade.replacementCost)}
                label={`Replacement, at ${replacementLb} lb`}
                size="md"
              />
              <StatTile
                value={money(trade.cashFreed)}
                label={trade.cashFreed >= 0 ? "Cash freed" : "Cash it costs"}
                tone={trade.cashFreed >= 0 ? "ink" : "red"}
                size="md"
              />
              <StatTile
                value={trade.poundsToReplace}
                unit="lb"
                label={
                  trade.daysToReplace === null
                    ? "To put back on"
                    : `To put back on — ${Math.round(trade.daysToReplace)} days`
                }
                size="md"
              />
            </div>

            <div className={`sb-verdict${trade.worthIt ? " sb-verdict--yes" : ""}`}>
              <span className="eyebrow">The number that decides it</span>
              {trade.breakevenCog === null ? (
                <p className="serif sb-verdict__say">
                  That replacement is not lighter, so nothing is being bought back and there is no
                  rate to quote. Trading <em>up</em> the ladder costs {money(-trade.cashFreed)} now
                  for cattle nearer their sale weight, which is a different decision from this one.
                </p>
              ) : (
                <>
                  <p className="serif sb-verdict__say">
                    The trade pays you <strong className="mono">{money2(trade.breakevenCog)}</strong>{" "}
                    a pound to put those {trade.poundsToReplace} pounds back on. Your cost of gain is{" "}
                    <strong className="mono">{money2(costOfGain)}</strong>.
                  </p>
                  <p className="sb-dim" style={{ marginBottom: 0 }}>
                    {trade.worthIt ? (
                      <>
                        Worth doing:{" "}
                        <strong className="mono">{money(trade.tradeMargin ?? 0)}</strong> a head by
                        the time the replacement reaches {currentLb} lb — before commission,
                        freight, shrink and death loss.
                      </>
                    ) : (
                      <>
                        The spread does not cover your cost of gain. At this slide, keeping the
                        cattle you have beats the trade.
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <p className="sb-foot">
        Every figure here is gross. Commission, yardage, brand and health paper, freight, pencil
        shrink and death loss come out before any of it is money, and none of them is worked in.
        The slide is the farm's own typed figures, not a quote.
      </p>
    </OpsShell>
  );
}

/**
 * The crossing, drawn.
 *
 * Two lines and the place they cross, which is the whole point — so it is a
 * line chart rather than the bars the rest of the app uses, and hand-drawn
 * rather than pulled from a library. The app has four runtime dependencies;
 * a charting one for two polylines would be more code than this, not less.
 */
function GainChart({
  points,
  costOfGain,
  window_,
  mode,
}: {
  points: ProjectionPoint[];
  costOfGain: number;
  window_: ProjectionPoint | null;
  mode: "vog" | "margin";
}) {
  const W = 720;
  const H = 260;
  const PAD = { top: 14, right: 16, bottom: 34, left: 54 };

  const xs = points.map((p) => p.weightLb);
  const ys =
    mode === "vog"
      ? [...points.map((p) => p.marginalVog), costOfGain]
      : points.map((p) => p.margin);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  // Nought is on the axis in margin mode: a margin chart that does not show
  // where it turns negative is a chart of the wrong thing.
  const rawMin = Math.min(...ys, mode === "margin" ? 0 : Infinity);
  const rawMax = Math.max(...ys, mode === "margin" ? 0 : -Infinity);
  const pad = (rawMax - rawMin) * 0.12 || 1;
  const minY = rawMin - pad;
  const maxY = rawMax + pad;

  const x = (w: number) =>
    PAD.left + ((w - minX) / (maxX - minX || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - minY) / (maxY - minY || 1)) * (H - PAD.top - PAD.bottom);

  const line = (pick: (p: ProjectionPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.weightLb).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join(" ");

  const ticksX = points.filter((_, i) => i % Math.ceil(points.length / 6) === 0);
  const ticksY = [minY, (minY + maxY) / 2, maxY];
  const fmtY = (v: number) => (mode === "vog" ? `$${v.toFixed(2)}` : `$${Math.round(v)}`);

  return (
    <figure className="sb-figure">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="sb-svg"
        role="img"
        aria-label={
          mode === "vog"
            ? "What the next ten pounds add, against cost of gain, as weight rises"
            : "Margin per head over cost of gain, as weight rises"
        }
      >
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="sb-grid" />
            <text x={PAD.left - 8} y={y(v) + 4} className="sb-axis" textAnchor="end">
              {fmtY(v)}
            </text>
          </g>
        ))}

        {ticksX.map((p) => (
          <text key={p.weightLb} x={x(p.weightLb)} y={H - 12} className="sb-axis" textAnchor="middle">
            {p.weightLb}
          </text>
        ))}

        {/* The ground the gain still pays for. */}
        {mode === "vog" && window_ !== null && (
          <rect
            x={x(minX)}
            y={PAD.top}
            width={Math.max(0, x(window_.weightLb) - x(minX))}
            height={H - PAD.top - PAD.bottom}
            className="sb-window"
          />
        )}

        {mode === "vog" ? (
          <>
            <path d={line((p) => p.marginalVog)} className="sb-line sb-line--vog" />
            <line
              x1={x(minX)}
              x2={x(maxX)}
              y1={y(costOfGain)}
              y2={y(costOfGain)}
              className="sb-line sb-line--cog"
            />
          </>
        ) : (
          <>
            {minY < 0 && maxY > 0 && (
              <line x1={x(minX)} x2={x(maxX)} y1={y(0)} y2={y(0)} className="sb-zero" />
            )}
            <path d={line((p) => p.margin)} className="sb-line sb-line--vog" />
          </>
        )}

        {window_ !== null && (
          <>
            <line
              x1={x(window_.weightLb)}
              x2={x(window_.weightLb)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="sb-mark"
            />
            <text x={x(window_.weightLb)} y={PAD.top - 2} className="sb-mark__label" textAnchor="middle">
              {window_.weightLb} lb
            </text>
          </>
        )}
      </svg>

      <figcaption className="sb-caption">
        {mode === "vog" ? (
          <>
            The solid line is what the next ten pounds add, per pound; the dashed line is what they
            cost. It crosses more than once — the slide eases at every weight class, so the
            marginal value steps back up each time one is passed. The mark is where total margin
            peaks, which is what those crossings add up to.
          </>
        ) : (
          <>
            Value gained less what it cost to gain it, per head, from today's weight. The top of
            the hump is the weight worth growing to.
          </>
        )}
      </figcaption>
    </figure>
  );
}
