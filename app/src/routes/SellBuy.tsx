import { useCallback, useEffect, useMemo, useState } from "react";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, StatTile } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import { fetchAnimals, type RealAnimal } from "../lib/herd";
import { fetchWeighings } from "../lib/grazing";
import { fetchMarketSeries, seriesLabel, type MarketSeries } from "../lib/market";
import {
  gainFrom,
  priceAt,
  projection,
  SAMPLE_SLIDE,
  SAMPLE_WEIGHTS,
  sellBuy,
  sellBuyHerd,
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
  | { state: "ok"; animals: RealAnimal[]; series: MarketSeries[] };

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

/** A report's date. Day-only, so midnight is appended rather than parsed as
 *  UTC and shown a day early. */
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

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
  /**
   * Which report the slide came from, when it came from one.
   *
   * Null means the figures on screen are the farm's own — either typed, or
   * the sample nobody has replaced yet. Kept apart from the slide itself
   * because the page has to be able to say which it is looking at, and a
   * slide with a report's name on it that has since been hand-edited would
   * be the worst of both.
   */
  const [fromReport, setFromReport] = useState<string | null>(null);
  const [cog, setCog] = useState("1.15");
  const [replacement, setReplacement] = useState("500");
  /** How many are going. One is the per-head trade; a draft is the argument. */
  const [head, setHead] = useState("40");
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
    // The market reports are not farm data and not required: a farm can work
    // this page on its own typed figures, and a puller that has not run must
    // not take the page down with it.
    const [animals, series] = await Promise.all([
      fetchAnimals(farmId),
      fetchMarketSeries().catch(() => [] as MarketSeries[]),
    ]);
    setLoad({ state: "ok", animals: animals.filter((a) => a.status === "active"), series });
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

  const headSold = num(head);
  const draft = useMemo(
    () => sellBuyHerd({ slide, sellLb: currentLb, replacementLb, headSold, adg: gain.adg }),
    [slide, currentLb, replacementLb, headSold, gain.adg],
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

  const setRung = (i: number, cwt: string) => {
    setSlide((rs) => rs.map((r, j) => (i === j ? { ...r, cwt: num(cwt) } : r)));
    // Edited, so it is the farm's slide now rather than the report's.
    setFromReport(null);
  };

  const animals = load.state === "ok" ? load.animals : [];
  const series = load.state === "ok" ? load.series : [];
  const report = series.find((x) => x.key === fromReport) ?? null;

  /** Take a report's rungs as the slide. Hand-editing one afterwards drops
   *  the report's name, because it is no longer that report. */
  const takeReport = (key: string) => {
    const chosen = series.find((x) => x.key === key) ?? null;
    setFromReport(chosen === null ? null : key);
    if (chosen !== null) setSlide(chosen.rungs);
    else setSlide(SAMPLE_SLIDE);
    setEditingSlide(false);
  };

  return (
    <OpsShell>
      <PageHeader
        eyebrow={business?.name ?? "Herd"}
        title="Sell/buy analyzer"
        actions={
          slide !== SAMPLE_SLIDE ? (
            <Button
              onClick={() => {
                setSlide(SAMPLE_SLIDE);
                setFromReport(null);
              }}
            >
              Reset the slide
            </Button>
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
          <span className="sb-h__note">
            {report === null
              ? series.length > 0
                ? "your own figures — or take a report below"
                : "your own figures — no report on file"
              : `${report.label}, ${shortDate(report.reportDate)}`}
          </span>
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

          {/* The reports, when the puller has run. A series is one auction,
              one class and one grade: mixing classes puts slaughter cows in
              with feeders, and mixing grades compares cattle that are not the
              same cattle. */}
          {series.length > 0 && (
            <label className="grz-field sb-report">
              <span className="eyebrow">Take the prices from</span>
              <select
                value={fromReport ?? ""}
                onChange={(e) => takeReport(e.target.value)}
                aria-label="Take the prices from"
              >
                <option value="">My own figures</option>
                {series.map((x) => (
                  <option key={x.key} value={x.key}>
                    {seriesLabel(x)} — {x.rungs.length} weights, {x.head.toLocaleString()} head
                  </option>
                ))}
              </select>
            </label>
          )}

          {report !== null && (
            <p className="sb-dim sb-note" style={{ marginTop: 0 }}>
              {report.label}, {shortDate(report.reportDate)} — {report.klass}
              {report.grade !== null && report.grade !== "N/A" && <> grade {report.grade}</>}, across{" "}
              {report.head.toLocaleString()} head.{" "}
              {report.isLocal ? "A local barn." : "Not a local barn — freight is on you."} Editing a
              rung makes it your slide rather than the report's.
            </p>
          )}

          {/* Never dropped silently: a farmer who knows their barn will spot a
              misread row faster than any rule does, and a slide quietly
              missing its lightest cattle is worse than one with a hole you
              can see. */}
          {report !== null && report.dropped.length > 0 && (
            <p className="grz-warn sb-note" style={{ marginTop: 0 }}>
              {report.dropped.length === 1 ? "One row was" : `${report.dropped.length} rows were`}{" "}
              left out as impossible —{" "}
              {report.dropped.map((d, i) => (
                <span key={d.weightLb} className="mono">
                  {i > 0 && ", "}
                  {d.weightLb} lb at ${d.cwt.toFixed(0)}
                </span>
              ))}
              . At that price a {report.dropped[0].weightLb} lb head would be worth{" "}
              {money((report.dropped[0].weightLb * report.dropped[0].cwt) / 100)}, so it is a
              per-head figure in the per-hundredweight column rather than a price.
            </p>
          )}

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
              <span className="eyebrow">Head to sell</span>
              <input
                value={head}
                inputMode="numeric"
                onChange={(e) => setHead(e.target.value)}
                aria-label="Head to sell"
              />
            </label>
            <label className="grz-field" style={{ marginTop: 12 }}>
              <span className="eyebrow">Buy back in at</span>
              <input
                value={replacement}
                inputMode="decimal"
                onChange={(e) => setReplacement(e.target.value)}
                aria-label="Buy back in at"
              />
            </label>
            <p className="sb-dim" style={{ margin: "12px 0 0" }}>
              Sell at {currentLb} lb for {priceAt(slide, currentLb).toFixed(0)} $/cwt, buy back at{" "}
              {replacementLb} lb for {priceAt(slide, replacementLb).toFixed(0)} $/cwt.
            </p>
          </div>

          <div>
            <div className="stat-row sb-stats">
              <StatTile
                value={draft.headBought}
                unit="head"
                label={
                  draft.extraHead === 0
                    ? "Bought back, same number"
                    : draft.extraHead > 0
                      ? `Bought back — ${draft.extraHead} more`
                      : `Bought back — ${-draft.extraHead} fewer`
                }
                size="md"
              />
              <StatTile value={money(draft.proceeds)} label={`Draft of ${draft.headSold}, gross`} size="md" />
              <StatTile
                value={money(draft.cashLeft)}
                label="Left over after buying"
                size="md"
              />
              <StatTile
                value={Math.abs(draft.poundsGivenUp).toLocaleString()}
                unit="lb"
                label={draft.poundsGivenUp >= 0 ? "Inventory given up" : "Inventory gained"}
                size="md"
              />
            </div>

            {/* The argument the per-head view cannot make: more mouths on the
                same grass, all gaining at the same rate. */}
            {draft.gainPerDayAfter !== null && draft.gainPerDayBefore !== null && draft.headSold > 0 && (
              <p className="sb-dim sb-note">
                {draft.headBought} head at {gain.adg!.toFixed(2)} lb a day is{" "}
                <strong className="mono">{Math.round(draft.gainPerDayAfter)} lb</strong> a day
                across the draft, against{" "}
                <strong className="mono">{Math.round(draft.gainPerDayBefore)} lb</strong> from the{" "}
                {draft.headSold} you sold
                {draft.daysToRegain !== null && (
                  <>
                    {" "}
                    — so the {draft.poundsGivenUp.toLocaleString()} lb of inventory comes back in
                    about {Math.round(draft.daysToRegain)} days, and the extra keeps accruing after
                    that
                  </>
                )}
                .
              </p>
            )}

            <div className="stat-row sb-stats sb-stats--second">
              <StatTile value={money(trade.proceeds)} label={`Sale, at ${currentLb} lb, each`} size="md" />
              <StatTile
                value={money(trade.replacementCost)}
                label={`Replacement, at ${replacementLb} lb, each`}
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
        {report === null
          ? "The slide is your own typed figures, not a quote."
          : "The slide is a USDA auction summary — what cattle actually sold for at that barn on that day, which is not a quote for yours."}
      </p>
    </OpsShell>
  );
}

/**
 * Round tick steps.
 *
 * The axis used to label whatever the padded extremes happened to be —
 * `$0.17`, `$0.43` — which are not numbers anybody holds in their head. These
 * step 1, 2, 2.5 or 5 times a power of ten, so the gridlines land on figures
 * you can read a value off between.
 */
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
  return { step, values };
}

/**
 * Money at the precision the tick step needs.
 *
 * A step of 2.5 labelled to the nearest dollar prints `$-2` against a
 * gridline that is at −2.50, which is a chart quietly lying about where its
 * own rules are. The step decides the decimals.
 */
function tickMoney(v: number, step: number): string {
  const places = step >= 1 ? (Number.isInteger(step) ? 0 : 1) : 2;
  const n = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: places });
  return `${v < 0 ? "-" : ""}$${n}`;
}

/** Whether the page is narrow enough that a 720-wide chart would shrink its
 *  own labels to nothing. */
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

/** Per hundredweight, back out of what the animal is worth at that weight. */
const cwtAt = (p: ProjectionPoint) => (p.weightLb > 0 ? (p.value * 100) / p.weightLb : 0);

const perLb = (n: number) => `$${n.toFixed(2)}`;

/**
 * The crossing, drawn.
 *
 * Two lines and the place they cross, which is the whole point — so it is a
 * line chart rather than the bars the rest of the app uses, and hand-drawn
 * rather than pulled from a library. The app has four runtime dependencies;
 * a charting one for two polylines would be more code than this, not less.
 *
 * **Everything the hover shows is also reachable without hovering** — the
 * figures table under the chart carries every column, so a printout, a
 * keyboard and a phone all get the same numbers. A tooltip that is the only
 * way to read a value is a chart with its data hidden in it.
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
  /** Which point the pointer or the arrow keys are on. Null is not hovering. */
  const [at, setAt] = useState<number | null>(null);
  const narrow = useNarrow();

  // Two geometries, not one scaled down. Everything in an SVG scales with its
  // viewBox, so a 720-wide chart in a 330px phone column renders its 11px
  // labels at five — present, unreadable, and worse than absent because the
  // page looks like it said something. The narrow one is drawn at close to
  // the size it is shown.
  const W = narrow ? 380 : 720;
  const H = narrow ? 300 : 276;
  // Room at the bottom for a tick row and an axis title under it, and at the
  // left for the rotated one: an axis of bare numbers does not say $ of what.
  const PAD = narrow
    ? { top: 18, right: 14, bottom: 48, left: 54 }
    : { top: 18, right: 18, bottom: 50, left: 64 };
  const plotBottom = H - PAD.bottom;

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
  const y = (v: number) => PAD.top + (1 - (v - minY) / (maxY - minY || 1)) * (H - PAD.top - PAD.bottom);

  const line = (pick: (p: ProjectionPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.weightLb).toFixed(1)} ${y(pick(p)).toFixed(1)}`).join(" ");

  const ticksY = niceTicks(minY, maxY, narrow ? 3 : 4);

  // The last weight always gets a tick — it is the end of the road and the
  // question is how far to go — but not on top of the one before it.
  const every = Math.max(1, Math.ceil(points.length / (narrow ? 4 : 7)));
  const last = points.length - 1;
  const ticksX = points.filter(
    (_, i) => i === last || (i % every === 0 && last - i >= every),
  );

  const fmtY = (v: number) => (mode === "vog" ? perLb(v) : tickMoney(v, ticksY.step));

  const yTitle = mode === "vog" ? "$ per pound of gain" : "$ per head, over cost of gain";
  const drawn = mode === "vog" ? "What the next 10 lb add" : "Margin per head";

  /** The pointer lands on a weight, not on a 2px line: nearest point wins. */
  const moveTo = (clientX: number, rect: DOMRect) => {
    if (rect.width === 0 || points.length === 0) return;
    const ux = ((clientX - rect.left) / rect.width) * W;
    const w = minX + ((ux - PAD.left) / Math.max(1, W - PAD.left - PAD.right)) * (maxX - minX);
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i].weightLb - w) < Math.abs(points[best].weightLb - w)) best = i;
    }
    setAt(best);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return;
    const cur = at ?? 0;
    const go = (i: number) => {
      setAt(Math.max(0, Math.min(points.length - 1, i)));
      e.preventDefault();
    };
    if (e.key === "ArrowRight") go(cur + 1);
    else if (e.key === "ArrowLeft") go(cur - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(points.length - 1);
    else if (e.key === "Escape") setAt(null);
  };

  const hovered = at === null ? null : (points[at] ?? null);

  return (
    <figure className="sb-figure">
      {/* Two lines get a legend; one does not — the caption names it. */}
      {mode === "vog" && (
        <ul className="sb-legend">
          <li>
            <svg className="sb-key" viewBox="0 0 22 8" aria-hidden="true">
              <line x1="1" x2="21" y1="4" y2="4" className="sb-line--vog" />
            </svg>
            What the next 10 lb add, per pound
          </li>
          <li>
            <svg className="sb-key" viewBox="0 0 22 8" aria-hidden="true">
              <line x1="1" x2="21" y1="4" y2="4" className="sb-line--cog" />
            </svg>
            Cost of gain, {perLb(costOfGain)} a pound
          </li>
        </ul>
      )}

      <div
        className="sb-plot"
        tabIndex={0}
        role="group"
        aria-label={`${drawn}, from ${minX} to ${maxX} lb. Arrow keys read the figures along it.`}
        onPointerMove={(e) => moveTo(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setAt(null)}
        onKeyDown={onKey}
        onBlur={() => setAt(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="sb-svg" role="img" aria-label={drawn}>
          {ticksY.values.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="sb-grid" />
              <text x={PAD.left - 8} y={y(v) + 4} className="sb-axis" textAnchor="end">
                {fmtY(v)}
              </text>
            </g>
          ))}

          {ticksX.map((p) => (
            <text
              key={p.weightLb}
              x={x(p.weightLb)}
              y={plotBottom + 17}
              className="sb-axis"
              textAnchor="middle"
            >
              {p.weightLb}
            </text>
          ))}

          {/* The axis titles. Without them the numbers are dollars of nothing
              in particular, which is most of what makes a chart unreadable. */}
          <text
            x={PAD.left + (W - PAD.left - PAD.right) / 2}
            y={H - 8}
            className="sb-axis sb-axis--title"
            textAnchor="middle"
          >
            {narrow ? `Weight, lb — today's ${minX} at the left` : `Weight, lb — today's ${minX} lb at the left`}
          </text>
          <text
            className="sb-axis sb-axis--title"
            textAnchor="middle"
            transform={`translate(15 ${PAD.top + (H - PAD.top - PAD.bottom) / 2}) rotate(-90)`}
          >
            {yTitle}
          </text>

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
                <>
                  <line x1={x(minX)} x2={x(maxX)} y1={y(0)} y2={y(0)} className="sb-zero" />
                  <text x={W - PAD.right} y={y(0) - 6} className="sb-axis" textAnchor="end">
                    break even
                  </text>
                </>
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
                y2={plotBottom}
                className="sb-mark"
              />
              <circle
                cx={x(window_.weightLb)}
                cy={y(mode === "vog" ? window_.marginalVog : window_.margin)}
                r={5}
                className="sb-peak"
              />
              <text x={x(window_.weightLb)} y={PAD.top - 4} className="sb-mark__label" textAnchor="middle">
                sell by {window_.weightLb} lb
              </text>
            </>
          )}

          {/* The hover layer. The hairline finds the weight; the dots say
              which figure on the readout is which line. */}
          {hovered !== null && (
            <g className="sb-cursor">
              <line
                x1={x(hovered.weightLb)}
                x2={x(hovered.weightLb)}
                y1={PAD.top}
                y2={plotBottom}
                className="sb-hair"
              />
              {mode === "vog" ? (
                <>
                  <circle cx={x(hovered.weightLb)} cy={y(hovered.marginalVog)} r={5} className="sb-dot sb-dot--vog" />
                  <circle cx={x(hovered.weightLb)} cy={y(costOfGain)} r={5} className="sb-dot sb-dot--cog" />
                </>
              ) : (
                <circle cx={x(hovered.weightLb)} cy={y(hovered.margin)} r={5} className="sb-dot sb-dot--vog" />
              )}
            </g>
          )}
        </svg>

        {hovered !== null && (
          <div
            className={`sb-tip${x(hovered.weightLb) > W * 0.6 ? " sb-tip--left" : ""}`}
            style={{ left: `${(x(hovered.weightLb) / W) * 100}%` }}
            role="status"
            aria-live="polite"
          >
            <p className="sb-tip__head">
              <strong className="mono">{hovered.weightLb} lb</strong>
              {hovered.days !== null && hovered.days > 0 && (
                <span className="sb-tip__when"> · {Math.round(hovered.days)} days out</span>
              )}
            </p>
            <dl className="sb-tip__rows">
              {mode === "vog" ? (
                <>
                  <TipRow keyClass="vog" label="Next 10 lb add" value={`${perLb(hovered.marginalVog)}/lb`} />
                  <TipRow keyClass="cog" label="Cost of gain" value={`${perLb(costOfGain)}/lb`} />
                  <TipRow label="Margin so far" value={money2(hovered.margin)} />
                </>
              ) : (
                <>
                  <TipRow keyClass="vog" label="Margin over cost of gain" value={money2(hovered.margin)} />
                  <TipRow label="Next 10 lb add" value={`${perLb(hovered.marginalVog)}/lb`} />
                </>
              )}
              <TipRow label="Price" value={`$${cwtAt(hovered).toFixed(2)}/cwt`} />
              <TipRow label="Worth, gross" value={money(hovered.value)} />
            </dl>
          </div>
        )}
      </div>

      <figcaption className="sb-caption">
        {mode === "vog" ? (
          <>
            The solid line is what the next ten pounds add, per pound; the dashed line is what they
            cost. It crosses more than once — the slide eases at every weight class, so the
            marginal value steps back up each time one is passed. The mark is where total margin
            peaks, which is what those crossings add up to. Point at the chart, or tab to it and
            use the arrow keys, for the figures at any weight.
          </>
        ) : (
          <>
            Value gained less what it cost to gain it, per head, from today's weight. The top of
            the hump is the weight worth growing to. Point at the chart, or tab to it and use the
            arrow keys, for the figures at any weight.
          </>
        )}
      </figcaption>

      {/* The same numbers without a pointer: for print, for a screen reader,
          and for anyone who wants to read down them rather than hunt. */}
      <details className="sb-figures">
        <summary>The figures behind the line</summary>
        <div className="sb-figures__scroll">
          <table className="sb-table sb-table--read">
            <thead>
              <tr>
                <th scope="col">Weight</th>
                <th scope="col">Days out</th>
                <th scope="col">Price</th>
                <th scope="col">Worth</th>
                <th scope="col">Next 10 lb</th>
                <th scope="col">Margin</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.weightLb} className={window_?.weightLb === p.weightLb ? "sb-row--peak" : undefined}>
                  <th scope="row" className="mono">{p.weightLb} lb</th>
                  <td className="mono">{p.days === null ? "—" : Math.round(p.days)}</td>
                  <td className="mono">${cwtAt(p).toFixed(2)}</td>
                  <td className="mono">{money(p.value)}</td>
                  <td className="mono">{perLb(p.marginalVog)}</td>
                  <td className="mono">{money2(p.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** One line of the readout: the number leads, the name follows it. */
function TipRow({ keyClass, label, value }: { keyClass?: "vog" | "cog"; label: string; value: string }) {
  return (
    <div className="sb-tip__row">
      <dt>
        {keyClass !== undefined && (
          <svg className="sb-key" viewBox="0 0 22 8" aria-hidden="true">
            <line x1="1" x2="21" y1="4" y2="4" className={keyClass === "vog" ? "sb-line--vog" : "sb-line--cog"} />
          </svg>
        )}
        {label}
      </dt>
      <dd className="mono">{value}</dd>
    </div>
  );
}
