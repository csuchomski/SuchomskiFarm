import { describe, expect, it } from "vitest";
import {
  gainFrom,
  SAMPLE_SLIDE,
  priceAt,
  projection,
  sellBuy,
  sellWindow,
  valueAt,
  type SlidePoint,
} from "./sell-buy";

/**
 * The market side: when the gain stops paying, and whether trading down the
 * ladder beats keeping what you have.
 *
 * The arithmetic is simple and the ways of getting it quietly wrong are not.
 * Most of these are about the edges — a slide read off its own end, a single
 * weighing asked for a rate, a replacement that is not lighter — because that
 * is where a number appears that looks like an answer and is not one.
 */

/** A slide that falls ten dollars a hundredweight per fifty pounds, so every
 *  interpolation below can be checked in the head. */
const EVEN: SlidePoint[] = [
  { weightLb: 500, cwt: 300 },
  { weightLb: 550, cwt: 290 },
  { weightLb: 600, cwt: 280 },
  { weightLb: 650, cwt: 270 },
];

describe("reading a price off the slide", () => {
  it("takes a rung at its own figure", () => {
    expect(priceAt(EVEN, 550)).toBe(290);
  });

  it("interpolates between two rungs", () => {
    expect(priceAt(EVEN, 525)).toBe(295);
    expect(priceAt(EVEN, 575)).toBe(285);
  });

  it("goes flat below the bottom rung rather than off the end", () => {
    // Extrapolating would keep raising the price of ever-lighter cattle until
    // a newborn was worth a fortune, and everything downstream would follow
    // it without complaint.
    expect(priceAt(EVEN, 300)).toBe(300);
    expect(priceAt(EVEN, 0)).toBe(300);
  });

  it("goes flat above the top rung too", () => {
    expect(priceAt(EVEN, 900)).toBe(270);
  });

  it("does not care what order the rungs were typed in", () => {
    const jumbled = [EVEN[2], EVEN[0], EVEN[3], EVEN[1]];
    expect(priceAt(jumbled, 525)).toBe(295);
  });

  it("is nought on an empty slide rather than a crash", () => {
    expect(priceAt([], 600)).toBe(0);
    expect(valueAt([], 600)).toBe(0);
  });

  it("prices a head off the hundredweight", () => {
    expect(valueAt(EVEN, 600)).toBeCloseTo(1680, 6);
  });
});

describe("reading gain off the weighings", () => {
  it("averages across the whole record", () => {
    const g = gainFrom([
      { date: "2026-04-01", weightLb: 500 },
      { date: "2026-05-01", weightLb: 560 },
    ]);
    expect([g.days, g.gainLb, g.currentLb]).toEqual([30, 60, 500 + 60]);
    expect(g.adg).toBeCloseTo(2, 6);
  });

  it("has no rate from one weighing, because a weight is not a rate", () => {
    const g = gainFrom([{ date: "2026-04-01", weightLb: 500 }]);
    expect(g.adg).toBeNull();
    expect(g.currentLb).toBe(500);
  });

  it("has nothing at all from no weighings", () => {
    expect(gainFrom([])).toEqual({
      adg: null, days: 0, gainLb: 0, currentLb: null, intervals: [],
    });
  });

  it("drops a half-typed row rather than counting it as nothing", () => {
    // A row somebody started and left is not a weighing of zero pounds, and
    // treating it as one would halve the gain.
    const g = gainFrom([
      { date: "2026-04-01", weightLb: 500 },
      { date: "", weightLb: 0 },
      { date: "2026-05-01", weightLb: 560 },
    ]);
    expect(g.adg).toBeCloseTo(2, 6);
    expect(g.currentLb).toBe(560);
  });

  it("sorts what it is given, so a late correction reads right", () => {
    const g = gainFrom([
      { date: "2026-05-01", weightLb: 560 },
      { date: "2026-04-01", weightLb: 500 },
    ]);
    expect([g.gainLb, g.currentLb]).toEqual([60, 560]);
  });

  it("reports each gap on its own, so a run that slowed shows as one", () => {
    // Averaged over the summer this reads 1.5 lb/d and looks steady. The
    // interval that matters is the second.
    const g = gainFrom([
      { date: "2026-04-01", weightLb: 500 },
      { date: "2026-05-01", weightLb: 575 },
      { date: "2026-06-01", weightLb: 590 },
    ]);
    expect(g.intervals.map((i) => Number(i.adg.toFixed(2)))).toEqual([2.5, 0.48]);
  });
});

describe("the road ahead", () => {
  const points = projection({ slide: EVEN, fromLb: 500, costOfGain: 1, adg: 2 });

  it("starts at today's weight with nothing gained yet", () => {
    expect(points[0].weightLb).toBe(500);
    expect(points[0].cumulativeVog).toBeNull();
    expect(points[0].margin).toBe(0);
  });

  it("prices each step off the slide", () => {
    const at600 = points.find((p) => p.weightLb === 600)!;
    expect(at600.value).toBeCloseTo(1680, 6);
  });

  it("counts the days at the mob's own rate", () => {
    const at600 = points.find((p) => p.weightLb === 600)!;
    expect(at600.days).toBe(50);
  });

  it("has no days at all when nothing has been weighed twice", () => {
    // Better than a number invented from an assumed rate, which is what a
    // default would be.
    const blind = projection({ slide: EVEN, fromLb: 500, costOfGain: 1, adg: null });
    expect(blind.every((p) => p.days === null)).toBe(true);
  });

  it("measures the marginal value over a real step, not a single pound", () => {
    // On this slide the price falls a dollar per five pounds, so ten pounds
    // of gain adds 10 lb at the new price less the dollar knocked off every
    // hundredweight of what was already there.
    const at500 = points[0];
    expect(at500.marginalVog).toBeCloseTo((valueAt(EVEN, 510) - valueAt(EVEN, 500)) / 10, 9);
  });

  it("is empty for an animal with no weight", () => {
    expect(projection({ slide: EVEN, fromLb: 0, costOfGain: 1, adg: 2 })).toEqual([]);
  });
});

describe("the sell window", () => {
  it("names the weight where margin peaks", () => {
    const cog = 1.5;
    const points = projection({ slide: EVEN, fromLb: 500, costOfGain: cog, adg: 2 });
    const best = sellWindow(points, cog)!;
    expect(best).not.toBeNull();
    for (const p of points) expect(p.margin).toBeLessThanOrEqual(best.margin + 1e-9);
  });

  it("is null when nothing ahead pays for itself", () => {
    // Which is the answer "sell at today's weight", not "no answer".
    const points = projection({ slide: EVEN, fromLb: 500, costOfGain: 99, adg: 2 });
    expect(sellWindow(points, 99)).toBeNull();
  });

  it("does not stop at the first dip on a slide that eases", () => {
    // The bug this replaced. Marginal value sawtooths on any real slide:
    // falling inside a weight class, jumping back up where the class boundary
    // eases the step. First-crossing calls the sell at the first dip, on a
    // curve that was about to pay again.
    // The page's own sample slide at its own default cost of gain, because
    // this is not a contrived case — it is what the shipped figures do.
    const cog = 1.15;
    const points = projection({
      slide: SAMPLE_SLIDE, fromLb: 676, costOfGain: cog, adg: 2.12, aheadLb: 190,
    });

    // The curve really does cross back and forth — otherwise this proves
    // nothing about the rule.
    const firstDip = points.findIndex((p) => p.marginalVog < cog);
    expect(firstDip).toBeGreaterThan(0);
    expect(points.slice(firstDip).some((p) => p.marginalVog >= cog)).toBe(true);

    // What the old rule would have said: the last point before that dip.
    const firstCrossing = points[firstDip - 1];
    const best = sellWindow(points, cog)!;
    expect(best.weightLb).toBeGreaterThan(firstCrossing.weightLb);
    // And it is worth more than the early call, which is the whole point.
    expect(best.margin).toBeGreaterThan(firstCrossing.margin);
    for (const p of points) expect(p.margin).toBeLessThanOrEqual(best.margin + 1e-9);
  });

  it("keeps paying past the top rung, because the slide stops falling there", () => {
    // Not a discovery — an artifact of clamping. Beyond the heaviest rung the
    // price is flat, so every further pound is worth full price. The page caps
    // the road at the top rung for exactly this reason.
    const points = projection({ slide: EVEN, fromLb: 640, costOfGain: 1.5, adg: 2 });
    const beyond = points.filter((p) => p.weightLb > 650);
    expect(beyond.every((p) => p.marginalVog > 2.5)).toBe(true);
  });

  it("runs to the end when gain pays all the way out", () => {
    const points = projection({ slide: EVEN, fromLb: 500, costOfGain: 0, adg: 2 });
    expect(sellWindow(points, 0)!.weightLb).toBe(points[points.length - 1].weightLb);
  });

  it("is null on an empty road", () => {
    expect(sellWindow([], 1)).toBeNull();
  });
});

describe("sell here, buy back there", () => {
  const base = { slide: EVEN, sellLb: 650, replacementLb: 500, costOfGain: 1, adg: 2 };

  it("frees the spread between the two", () => {
    const t = sellBuy(base);
    expect(t.proceeds).toBeCloseTo(1755, 6);
    expect(t.replacementCost).toBeCloseTo(1500, 6);
    expect(t.cashFreed).toBeCloseTo(255, 6);
    expect(t.poundsToReplace).toBe(150);
  });

  it("quotes what the trade pays per pound to put them back on", () => {
    // The number the whole thing turns on: 255 dollars for 150 pounds.
    expect(sellBuy(base).breakevenCog).toBeCloseTo(1.7, 6);
  });

  it("calls it worth doing when that beats cost of gain", () => {
    expect(sellBuy(base).worthIt).toBe(true);
    expect(sellBuy({ ...base, costOfGain: 2 }).worthIt).toBe(false);
  });

  it("does not call it worth doing when the two are equal", () => {
    // Equal is not better, and a trade that exactly breaks even has paid you
    // nothing for the commission and the freight it also costs.
    expect(sellBuy({ ...base, costOfGain: 1.7 }).worthIt).toBe(false);
  });

  it("nets the cost of regaining the weight off the cash", () => {
    expect(sellBuy(base).tradeMargin).toBeCloseTo(255 - 150, 6);
  });

  it("counts the days back at the mob's own rate", () => {
    expect(sellBuy(base).daysToReplace).toBe(75);
    expect(sellBuy({ ...base, adg: null }).daysToReplace).toBeNull();
  });

  it("quotes no rate when the replacement is not lighter", () => {
    // Trading up costs money now for cattle nearer their sale weight. Nothing
    // is being bought back, so there is no per-pound rate to quote — and a
    // figure here would be a division by nought dressed up as advice.
    const up = sellBuy({ ...base, replacementLb: 650 });
    expect([up.breakevenCog, up.tradeMargin, up.daysToReplace]).toEqual([null, null, null]);
    expect(up.worthIt).toBe(false);
  });

  it("shows trading up as the cost it is", () => {
    const up = sellBuy({ ...base, sellLb: 500, replacementLb: 650 });
    expect(up.cashFreed).toBeCloseTo(-255, 6);
    expect(up.poundsToReplace).toBe(-150);
    expect(up.worthIt).toBe(false);
  });
});
