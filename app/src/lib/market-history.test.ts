import { describe, expect, it } from "vitest";
import {
  datesIn,
  deflate,
  indexed,
  rollingMean,
  spread,
  tracksFrom,
  trackFullLabel,
  trackLabel,
  type HistoryRow,
  type TrackPoint,
} from "./market-history";

/**
 * The market reports over time.
 *
 * The fixtures are shaped like the real thing: Iowa's feeder steers as a
 * ladder of weight rungs, one ladder per week, with the weights that came to
 * town changing week to week — because that mix changing is the thing that
 * makes a naive average lie.
 */

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  report_date: "2026-08-24",
  source_id: 2,
  label: "Iowa Weekly Cattle Auction Summary",
  is_local: true,
  commodity: "Feeder Cattle",
  class: "Steers",
  grade: "1",
  wt: 600,
  cwt: 350,
  head: 10,
  ...over,
});

/** A week of feeder steers: a straight ladder, easy to price by hand. */
const week = (date: string, base: number, over: Partial<HistoryRow> = {}): HistoryRow[] =>
  [
    [500, base + 40],
    [600, base + 20],
    [700, base],
    [800, base - 20],
  ].map(([wt, cwt]) => row({ report_date: date, wt, cwt, ...over }));

describe("grouping the reports into class tracks", () => {
  it("makes one track per source, commodity, class and grade", () => {
    const out = tracksFrom(
      [
        ...week("2026-08-24", 350),
        ...week("2026-08-24", 200, { commodity: "Slaughter Cattle", grade: "N/A" }),
        ...week("2026-08-24", 330, { class: "Heifers" }),
      ],
      { kind: "average" },
    );
    expect(out.map((t) => `${t.commodity}/${t.klass}/${t.grade}`).sort()).toEqual([
      "Feeder Cattle/Heifers/1",
      "Feeder Cattle/Steers/1",
      "Slaughter Cattle/Steers/N/A",
    ]);
  });

  it("keeps a feeder steer and a slaughter steer apart on the commodity alone", () => {
    // The hazard the commodity column exists for: one report calls both
    // "Steers", at $456 and $186, and a slide built from the wrong one prices
    // a whole draft out by better than $100 a hundredweight.
    //
    // Same class and the same grade on both sides on purpose. On the report
    // in hand the grade happens to differ as well, so a test that varied it
    // too would pass with the commodity thrown away — and AMS grades a
    // feeder lot "N/A" often enough that leaning on that is leaning on
    // nothing.
    const out = tracksFrom(
      [
        ...week("2026-08-24", 400, { commodity: "Feeder Cattle", grade: "N/A" }),
        ...week("2026-08-24", 200, { commodity: "Slaughter Cattle", grade: "N/A" }),
      ],
      { kind: "average" },
    );
    expect(out).toHaveLength(2);
    expect(new Set(out.map((t) => t.commodity))).toEqual(
      new Set(["Feeder Cattle", "Slaughter Cattle"]),
    );
    // And not blended: each keeps its own level.
    expect(out.map((t) => Math.round(t.points[0].cwt ?? 0)).sort((a, b) => a - b)).toEqual([
      210, 410,
    ]);
  });

  it("puts one point per report date, oldest first", () => {
    const [t] = tracksFrom(
      [...week("2026-08-24", 350), ...week("2026-08-10", 340), ...week("2026-08-17", 345)],
      { kind: "average" },
    );
    expect(t.points.map((p) => p.date)).toEqual(["2026-08-10", "2026-08-17", "2026-08-24"]);
  });

  it("carries the weights the class was actually quoted at", () => {
    // A fixed weight outside them has no answer, and the page has to be able
    // to say so rather than draw a gap nobody can explain.
    const [t] = tracksFrom(week("2026-08-24", 350), { kind: "average" });
    expect([t.lowLb, t.highLb]).toEqual([500, 800]);
  });

  it("adds up the head behind the whole track", () => {
    const [t] = tracksFrom([...week("2026-08-24", 350), ...week("2026-08-17", 340)], {
      kind: "average",
    });
    expect(t.head).toBe(80);
  });

  it("names a class by its cattle and a report by everything that tells two apart", () => {
    const [t] = tracksFrom(week("2026-08-24", 350), { kind: "average" });
    expect(trackLabel(t)).toBe("Steers grade 1");
    expect(trackFullLabel(t)).toBe(
      "Iowa Weekly Cattle Auction Summary · Feeder Cattle · Steers grade 1",
    );
  });

  it("leaves the grade out of the name when the report did not grade the lot", () => {
    const [t] = tracksFrom(week("2026-08-24", 200, { grade: "N/A" }), { kind: "average" });
    expect(trackLabel(t)).toBe("Steers");
  });

  it("drops the per-head figures the single-report page drops", () => {
    // Same rule in both places, or the same lot is in one chart and out of
    // the other.
    const [t] = tracksFrom(
      [...week("2026-08-24", 350), row({ report_date: "2026-08-24", wt: 450, cwt: 1900 })],
      { kind: "average" },
    );
    expect(t.points[0].rungs.map((r) => r.cwt)).not.toContain(1900);
  });

  it("lists every date any track covers", () => {
    const tracks = tracksFrom(
      [...week("2026-08-24", 350), ...week("2026-08-10", 340, { class: "Heifers" })],
      { kind: "average" },
    );
    expect(datesIn(tracks)).toEqual(["2026-08-10", "2026-08-24"]);
  });
});

describe("what a class is worth in a week", () => {
  it("prices the same weight off every week's ladder", () => {
    const [t] = tracksFrom([...week("2026-08-10", 340), ...week("2026-08-24", 350)], {
      kind: "atWeight",
      lb: 700,
    });
    expect(t.points.map((p) => p.cwt)).toEqual([340, 350]);
  });

  it("interpolates between the rungs, as the sell/buy page does", () => {
    const [t] = tracksFrom(week("2026-08-24", 350), { kind: "atWeight", lb: 650 });
    expect(t.points[0].cwt).toBeCloseTo(360, 6);
  });

  it("has no answer at a weight the class did not bring", () => {
    // `priceAt` clamps flat past the ends, so asking for 300 lb would report
    // the lightest rung's price — a straight line at a number nobody was ever
    // paid. A gap is the honest answer.
    const [t] = tracksFrom(week("2026-08-24", 350), { kind: "atWeight", lb: 300 });
    expect(t.points[0].cwt).toBeNull();
    const [u] = tracksFrom(week("2026-08-24", 350), { kind: "atWeight", lb: 1400 });
    expect(u.points[0].cwt).toBeNull();
  });

  it("does not interpolate across a single rung", () => {
    const [t] = tracksFrom([row({ wt: 700, cwt: 350 })], { kind: "atWeight", lb: 700 });
    expect(t.points[0].cwt).toBeNull();
  });

  it("weights the average by head rather than by rung", () => {
    // Ten rungs of four head and one of nine hundred is one lot with some
    // noise round it, and the lot is what the week was.
    const [t] = tracksFrom(
      [
        row({ wt: 500, cwt: 400, head: 1 }),
        row({ wt: 700, cwt: 300, head: 99 }),
      ],
      { kind: "average" },
    );
    expect(t.points[0].cwt).toBeCloseTo(301, 6);
  });

  it("falls back to a plain mean when the report counted no head", () => {
    const [t] = tracksFrom(
      [row({ wt: 500, cwt: 400, head: null }), row({ wt: 700, cwt: 300, head: null })],
      { kind: "average" },
    );
    expect(t.points[0].cwt).toBe(350);
  });

  it("is not moved by the weight mix when priced at a weight, and is when averaged", () => {
    // The reason the fixed weight exists. Two weeks at identical prices, the
    // second one selling only light cattle: the average reads as a rally that
    // did not happen, and the fixed weight does not move.
    const flat = [500, 600, 700, 800].map((wt) => row({ report_date: "2026-08-10", wt, cwt: 900 - wt / 2 }));
    const lightOnly = [500, 600].map((wt) => row({ report_date: "2026-08-17", wt, cwt: 900 - wt / 2 }));

    const [avg] = tracksFrom([...flat, ...lightOnly], { kind: "average" });
    expect(avg.points[0].cwt).not.toBeCloseTo(avg.points[1].cwt ?? 0, 6);

    const [at] = tracksFrom([...flat, ...lightOnly], { kind: "atWeight", lb: 550 });
    expect(at.points[0].cwt).toBeCloseTo(at.points[1].cwt ?? 0, 6);
  });
});

describe("the rolling average", () => {
  /** The rolling average works on the figures, not the points, so it can run
   *  after a deflator or an index has already changed them. */
  const pts = (...xs: (number | null)[]): (number | null)[] => xs;

  it("averages the last n reports", () => {
    expect(rollingMean(pts(10, 20, 30, 40), 2)).toEqual([null, 15, 25, 35]);
  });

  it("says nothing until it has n behind it", () => {
    // A line that eases in from the mean of one report is a line pretending
    // to be an average before it is one.
    expect(rollingMean(pts(10, 20, 30), 3)).toEqual([null, null, 20]);
  });

  it("trails rather than centres, so the last weeks are covered", () => {
    // A centred window reads the future and leaves the only weeks anybody
    // acts on with no line over them.
    const out = rollingMean(pts(10, 20, 30, 100), 2);
    expect(out[3]).toBe(65);
  });

  it("steps over a week the class did not sell rather than counting it as nothing", () => {
    expect(rollingMean(pts(10, null, 30), 2)).toEqual([null, null, 20]);
  });

  it("is the figure itself at a window of one", () => {
    expect(rollingMean(pts(10, 20), 1)).toEqual([10, 20]);
  });
});

describe("restating it in one year's dollars", () => {
  const pts: TrackPoint[] = [
    { date: "2024-08-24", cwt: 100, head: 1, rungs: [] },
    { date: "2025-08-24", cwt: 100, head: 1, rungs: [] },
    { date: "2026-08-24", cwt: 100, head: 1, rungs: [] },
  ];

  it("lifts older money to what it would be worth now", () => {
    const out = deflate(pts, 0.03, "2026-08-24");
    expect(out[2]).toBeCloseTo(100, 6);
    expect(out[1]).toBeCloseTo(103, 1);
    expect(out[0]).toBeCloseTo(106.09, 1);
  });

  it("changes nothing at a rate of nothing", () => {
    expect(deflate(pts, 0, "2026-08-24")).toEqual([100, 100, 100]);
  });

  it("leaves a gap a gap", () => {
    const gappy = [...pts, { date: "2026-09-01", cwt: null, head: 0, rungs: [] }];
    expect(deflate(gappy, 0.03, "2026-08-24")[3]).toBeNull();
  });
});

describe("indexing, which needs no deflator at all", () => {
  it("puts the first figure at a hundred and the rest beside it", () => {
    expect(indexed([50, 60, 40])).toEqual([100, 120, 80]);
  });

  it("takes its base from the first figure there is, not the first slot", () => {
    expect(indexed([null, 50, 100])).toEqual([null, 100, 200]);
  });

  it("divides inflation out, so an indexed pair needs no rate", () => {
    // Both series carry the same money, so the ratio between them is the same
    // whether the money is restated or not. This is why the Bud Williams
    // comparison does not need a CPI feed.
    const raw = [100, 110, 120];
    const inflated = raw.map((v, i) => v * 1.03 ** i);
    expect(indexed(inflated).map((v) => Math.round((v ?? 0) * 100) / 100)).not.toEqual(
      indexed(raw),
    );
    // …but the *shape* against a second series moving the same way is:
    const other = [200, 220, 240];
    const otherInflated = other.map((v, i) => v * 1.03 ** i);
    const ratioRaw = raw.map((v, i) => v / other[i]);
    const ratioInflated = inflated.map((v, i) => v / otherInflated[i]);
    ratioRaw.forEach((v, i) => expect(ratioInflated[i]).toBeCloseTo(v, 10));
  });

  it("has nothing to say about a series that is all gaps", () => {
    expect(indexed([null, null])).toEqual([null, null]);
  });
});

describe("one class against another", () => {
  const a: TrackPoint[] = [
    { date: "2026-08-10", cwt: 300, head: 1, rungs: [] },
    { date: "2026-08-17", cwt: 320, head: 1, rungs: [] },
    { date: "2026-08-24", cwt: 340, head: 1, rungs: [] },
  ];

  it("divides them on the dates they share", () => {
    const b: TrackPoint[] = [
      { date: "2026-08-10", cwt: 150, head: 1, rungs: [] },
      { date: "2026-08-24", cwt: 170, head: 1, rungs: [] },
    ];
    expect(spread(a, b)).toEqual([
      { date: "2026-08-10", ratio: 2 },
      { date: "2026-08-24", ratio: 2 },
    ]);
  });

  it("skips a date either side is missing rather than pairing the wrong weeks", () => {
    const b: TrackPoint[] = [{ date: "2026-08-17", cwt: null, head: 0, rungs: [] }];
    expect(spread(a, b)).toEqual([]);
  });

  it("does not divide by nothing", () => {
    const b: TrackPoint[] = [{ date: "2026-08-10", cwt: 0, head: 1, rungs: [] }];
    expect(spread(a, b)).toEqual([]);
  });
});
