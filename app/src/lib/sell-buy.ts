/**
 * The market side of a grazing operation: what the next hundred pounds are
 * worth, and whether trading down the weight ladder beats keeping what you
 * have.
 *
 * Two questions, one price slide behind both.
 *
 * **When does the gain stop paying?** Cattle get cheaper per pound as they
 * get heavier, so a growing animal is worth more in total and less per
 * hundredweight every week. The figure that matters is not the total but the
 * *marginal* value of gain — what the next ten pounds add — because that is
 * what the next ten pounds of grass has to beat. When it falls below cost of
 * gain, the animal is costing money to keep even though it is still getting
 * heavier and still worth more. That crossing is the sell window.
 *
 * **Bud Williams' sell/buy.** Sell a heavy animal and buy a lighter one with
 * the proceeds, and the spread between the two is cash in hand now — paid for
 * by having to put those pounds back on. Divide the cash freed by the pounds
 * given up and you get the price the market is paying you to regain them. If
 * that beats your cost of gain, the trade pays; if not, keeping the cattle
 * you have is better. The decision turns on one number, and the point of this
 * library is to produce it rather than a screenful of arithmetic to squint at.
 *
 * Nothing here knows a market price. The slide is the farm's own figures —
 * play data until there is a feed — and every number out of this file is only
 * as good as the numbers in.
 *
 * **All figures are gross.** Commission, yardage, brand and health paper,
 * freight, pencil shrink and death loss come out before any of this is money,
 * and none of them is modelled. The page says so where it can be read.
 */

/** One rung of the price ladder: a weight, and what cattle at it fetch. */
export interface SlidePoint {
  /** Midpoint weight of the class, in pounds. */
  weightLb: number;
  /** Dollars per hundredweight. */
  cwt: number;
}

/**
 * The price for a weight, interpolated between the rungs.
 *
 * Flat outside the ends rather than extrapolated. A slide that ran off its
 * own bottom would keep raising the price of ever-lighter cattle until a
 * newborn was worth a fortune, and the arithmetic downstream would follow it
 * without complaint.
 */
export function priceAt(slide: SlidePoint[], weightLb: number): number {
  const rungs = [...slide].sort((a, b) => a.weightLb - b.weightLb);
  if (rungs.length === 0) return 0;
  if (weightLb <= rungs[0].weightLb) return rungs[0].cwt;
  const top = rungs[rungs.length - 1];
  if (weightLb >= top.weightLb) return top.cwt;

  for (let i = 0; i < rungs.length - 1; i += 1) {
    const a = rungs[i];
    const b = rungs[i + 1];
    if (weightLb >= a.weightLb && weightLb <= b.weightLb) {
      const t = (weightLb - a.weightLb) / (b.weightLb - a.weightLb);
      return a.cwt + t * (b.cwt - a.cwt);
    }
  }
  return top.cwt;
}

/** What one head at that weight is worth, gross. */
export function valueAt(slide: SlidePoint[], weightLb: number): number {
  return (weightLb * priceAt(slide, weightLb)) / 100;
}

/** A weighing, as this library needs it. */
export interface WeightPoint {
  date: string;
  weightLb: number;
}

export interface GainRead {
  /** Pounds a day across the whole record. Null under two usable weighings —
   *  one weight is a weight, not a rate. */
  adg: number | null;
  days: number;
  gainLb: number;
  currentLb: number | null;
  /** Each gap between weighings, so a run that has slowed shows as a run
   *  rather than being averaged away by a strong spring. */
  intervals: { from: string; to: string; days: number; adg: number }[];
}

/**
 * Average daily gain off a run of weighings.
 *
 * Blank dates and non-positive weights are dropped rather than counted as
 * zero: a row somebody started typing and left is not a weighing of nothing,
 * and treating it as one would halve the gain.
 */
export function gainFrom(points: WeightPoint[]): GainRead {
  const clean = points
    .filter((p) => p.date !== "" && Number.isFinite(p.weightLb) && p.weightLb > 0)
    .map((p) => ({ ...p, t: new Date(`${p.date}T00:00:00`).getTime() }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  if (clean.length === 0) return { adg: null, days: 0, gainLb: 0, currentLb: null, intervals: [] };

  const first = clean[0];
  const last = clean[clean.length - 1];
  const days = (last.t - first.t) / 86_400_000;
  const gainLb = last.weightLb - first.weightLb;

  const intervals = clean.slice(1).map((p, i) => {
    const prev = clean[i];
    const d = (p.t - prev.t) / 86_400_000;
    return {
      from: prev.date,
      to: p.date,
      days: d,
      adg: d > 0 ? (p.weightLb - prev.weightLb) / d : 0,
    };
  });

  return {
    adg: clean.length >= 2 && days > 0 ? gainLb / days : null,
    days,
    gainLb,
    currentLb: last.weightLb,
    intervals,
  };
}

/** One weight along the road ahead, and what it is worth getting there. */
export interface ProjectionPoint {
  weightLb: number;
  /** What the animal fetches at this weight, gross. */
  value: number;
  /** What the next step of gain adds, per pound. The figure the sell window
   *  turns on — see the note at the head of this file. */
  marginalVog: number;
  /** What the gain has averaged per pound since today's weight. Null at the
   *  start, where no pounds have been put on to average over. */
  cumulativeVog: number | null;
  /** Value gained less what it cost to gain it, per head. */
  margin: number;
  /** Days from today at the mob's own rate. Null with no rate on file. */
  days: number | null;
}

/**
 * The road ahead, ten pounds at a time.
 *
 * `step` is the resolution of the marginal figure as well as of the line:
 * measuring the value of one more pound against a slide quoted in fifty-pound
 * classes would report the interpolation's slope, which is smooth and says
 * nothing. Ten pounds is a week or so of grass.
 */
export function projection(input: {
  slide: SlidePoint[];
  fromLb: number;
  costOfGain: number;
  adg: number | null;
  /** How far ahead to look. */
  aheadLb?: number;
  step?: number;
}): ProjectionPoint[] {
  const { slide, fromLb, costOfGain, adg, aheadLb = 350, step = 10 } = input;
  if (!Number.isFinite(fromLb) || fromLb <= 0) return [];

  const base = valueAt(slide, fromLb);
  const out: ProjectionPoint[] = [];

  for (let w = fromLb; w <= fromLb + aheadLb; w += step) {
    const gained = w - fromLb;
    const value = valueAt(slide, w);
    out.push({
      weightLb: w,
      value,
      marginalVog: (valueAt(slide, w + step) - value) / step,
      cumulativeVog: gained > 0 ? (value - base) / gained : null,
      margin: value - base - costOfGain * gained,
      days: adg !== null && adg > 0 ? gained / adg : null,
    });
  }
  return out;
}

/**
 * The weight worth growing to: where value gained less cost of gain peaks.
 *
 * **Not the first place the marginal line crosses cost of gain**, which is
 * what this did first and got wrong. Marginal value sawtooths on any real
 * slide: within a weight class the price falls steadily so the marginal value
 * falls with it, and then at each class boundary the slide eases — the sample
 * one steps −15, −15, −14, −13, −12, −11, −10, −8, −7 dollars per fifty
 * pounds — and the marginal value jumps back up. Stopping at the first dip
 * calls a sell twenty or fifty pounds early, every time, on a curve that was
 * about to pay again.
 *
 * Maximising margin is the question actually being asked — how far is it
 * worth growing them — and it does not care how many times the marginal line
 * crosses on the way. When the marginal curve *is* smooth the two agree; when
 * it is not, this one is right.
 *
 * Null when the peak is today's weight: nothing ahead pays for itself, and
 * "sell now" is the answer rather than "no answer".
 */
export function sellWindow(points: ProjectionPoint[], _costOfGain?: number): ProjectionPoint | null {
  if (points.length === 0) return null;
  let best = points[0];
  for (const p of points) if (p.margin > best.margin) best = p;
  return best === points[0] ? null : best;
}

export interface SellBuy {
  proceeds: number;
  replacementCost: number;
  /** What stays in your pocket. Negative when trading up. */
  cashFreed: number;
  poundsToReplace: number;
  /**
   * What the trade pays you per pound to put those pounds back on — the
   * number the whole thing turns on. Null when the replacement is not lighter,
   * because then nothing is being bought back and there is no rate to quote.
   */
  breakevenCog: number | null;
  daysToReplace: number | null;
  /** Cash freed less what regaining the weight will cost. Null as above. */
  tradeMargin: number | null;
  /** Whether the spread beats cost of gain. False when there is nothing to
   *  compare, so a caller that only reads this cannot be misled. */
  worthIt: boolean;
}

/**
 * Sell here, buy back there.
 *
 * A replacement heavier than what is sold is allowed and comes out negative
 * throughout — that is trading *up* the ladder, which costs money now in
 * exchange for cattle nearer their sale weight. It is a real thing to do; the
 * page just has to be honest that the figures reverse.
 */
export function sellBuy(input: {
  slide: SlidePoint[];
  sellLb: number;
  replacementLb: number;
  costOfGain: number;
  adg: number | null;
}): SellBuy {
  const { slide, sellLb, replacementLb, costOfGain, adg } = input;
  const proceeds = valueAt(slide, sellLb);
  const replacementCost = valueAt(slide, replacementLb);
  const cashFreed = proceeds - replacementCost;
  const poundsToReplace = sellLb - replacementLb;
  const lighter = poundsToReplace > 0;

  const breakevenCog = lighter ? cashFreed / poundsToReplace : null;

  return {
    proceeds,
    replacementCost,
    cashFreed,
    poundsToReplace,
    breakevenCog,
    daysToReplace: lighter && adg !== null && adg > 0 ? poundsToReplace / adg : null,
    tradeMargin: lighter ? cashFreed - costOfGain * poundsToReplace : null,
    worthIt: breakevenCog !== null && breakevenCog > costOfGain,
  };
}

/**
 * A price slide to start from.
 *
 * Play data, and labelled as such wherever it is shown. The shape is real —
 * lighter cattle fetch more per hundredweight, and the slide flattens as they
 * get heavier — but the figures are invented and must not be mistaken for a
 * quote. Replaced by the farm's own until there is a feed.
 */
export const SAMPLE_SLIDE: SlidePoint[] = [
  { weightLb: 425, cwt: 340 },
  { weightLb: 475, cwt: 325 },
  { weightLb: 525, cwt: 310 },
  { weightLb: 575, cwt: 296 },
  { weightLb: 625, cwt: 283 },
  { weightLb: 675, cwt: 271 },
  { weightLb: 725, cwt: 260 },
  { weightLb: 775, cwt: 250 },
  { weightLb: 825, cwt: 242 },
  { weightLb: 875, cwt: 235 },
];

/** Three weighings across a summer, for a farm with none on file yet. */
export const SAMPLE_WEIGHTS: WeightPoint[] = [
  { date: "2026-04-18", weightLb: 468 },
  { date: "2026-06-06", weightLb: 572 },
  { date: "2026-07-25", weightLb: 676 },
];
