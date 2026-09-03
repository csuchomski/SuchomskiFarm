import { describe, expect, it } from "vitest";
import { seriesFrom, seriesLabel } from "./market";

/**
 * The AMS reports, turned into price slides.
 *
 * The fixtures here are the real 2026-08-24 Iowa report, because the thing
 * most worth testing came out of it: two heifer rows carry a **per-head price
 * in the per-hundredweight column** — 450 lb at "1900", which as a price per
 * hundredweight makes her worth $8,550. Wired in raw, the analyzer prices a
 * whole draft off it and never says a word.
 */

const row = (over: Partial<Parameters<typeof seriesFrom>[0][number]> = {}) =>
  ({
    source_id: 2,
    label: "Iowa Weekly Cattle Auction Summary",
    is_local: true,
    report_date: "2026-08-24",
    class: "Steers",
    grade: "1",
    wt: 600,
    cwt: 350,
    head: 10,
    ...over,
  }) as Parameters<typeof seriesFrom>[0][number];

/** Iowa's Medium and Large 1 steers, as reported. */
const IOWA_STEERS = [
  [472, 456], [488, 430], [548, 383.49], [584, 390.62], [627, 365.82], [676, 365.11],
  [731, 350.45], [765, 339.36], [821, 334.09], [870, 316.75], [915, 303.21], [959, 293.61],
  [1024, 285.65], [1063, 278.25], [1135, 264.75], [1165, 256],
].map(([wt, cwt]) => row({ wt, cwt }));

/** Iowa's grade 1 heifers, including the two misread rows. */
const IOWA_HEIFERS = [
  [426, 1850], [450, 1900], [530, 364.43], [589, 350.15], [628, 350.99], [667, 341.49],
  [723, 376.15], [729, 321.28], [754, 380], [761, 314.71], [830, 302.91], [871, 288.26],
  [906, 290.53], [963, 273.57],
].map(([wt, cwt]) => row({ class: "Heifers", wt, cwt }));

describe("grouping the report into slides", () => {
  it("makes one series per source, class and grade", () => {
    const out = seriesFrom([
      ...IOWA_STEERS,
      ...IOWA_HEIFERS,
      row({ class: "Steers", grade: "1-2", wt: 700, cwt: 340 }),
      row({ class: "Steers", grade: "1-2", wt: 800, cwt: 320 }),
    ]);
    expect(out.map((s) => `${s.klass}/${s.grade}`).sort()).toEqual([
      "Heifers/1", "Steers/1", "Steers/1-2",
    ]);
  });

  it("does not mix two reports into one slide", () => {
    // Illinois and Iowa are different markets, and a rung from each is not a
    // slide, it is two prices for cattle you would haul to different places.
    const out = seriesFrom([
      ...IOWA_STEERS,
      row({ source_id: 1, label: "Illinois Weekly", is_local: false, wt: 600, cwt: 300 }),
      row({ source_id: 1, label: "Illinois Weekly", is_local: false, wt: 700, cwt: 280 }),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((s) => s.sourceId))).toEqual(new Set([1, 2]));
  });

  it("puts the rungs in weight order whatever order they arrived in", () => {
    const out = seriesFrom([...IOWA_STEERS].reverse());
    const weights = out[0].rungs.map((r) => r.weightLb);
    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });

  it("carries the report and its date, so the page can say where this came from", () => {
    const [s] = seriesFrom(IOWA_STEERS);
    expect([s.label, s.reportDate, s.klass, s.grade]).toEqual([
      "Iowa Weekly Cattle Auction Summary", "2026-08-24", "Steers", "1",
    ]);
  });

  it("adds up the head behind the slide", () => {
    // A series built on nine head is a rumour; one on four thousand is a
    // market, and the page should be able to tell you which it has.
    const [s] = seriesFrom([row({ head: 100 }), row({ wt: 700, head: 250 })]);
    expect(s.head).toBe(350);
  });

  it("names a series by its report and its cattle", () => {
    expect(seriesLabel(seriesFrom(IOWA_STEERS)[0]))
      .toBe("Iowa Weekly Cattle Auction Summary · Steers · grade 1");
  });

  it("leaves the grade out of the name when the report did not grade the lot", () => {
    expect(seriesLabel(seriesFrom([row({ grade: "N/A" }), row({ grade: "N/A", wt: 700 })])[0]))
      .toBe("Iowa Weekly Cattle Auction Summary · Steers");
  });
});

describe("rows that are not prices", () => {
  it("drops a per-head figure sitting in the per-hundredweight column", () => {
    // The real defect: 450 lb at "1900" would make that heifer worth $8,550.
    const [s] = seriesFrom(IOWA_HEIFERS);
    expect(s.dropped.map((d) => d.cwt)).toEqual([1850, 1900]);
    expect(s.rungs.every((r) => r.cwt < 400)).toBe(true);
  });

  it("hands back what it dropped rather than dropping it silently", () => {
    // A farmer who knows their barn recognises a misread row faster than any
    // rule does. Hiding it takes that away and leaves them trusting a slide
    // quietly missing its lightest cattle.
    const [s] = seriesFrom(IOWA_HEIFERS);
    expect(s.dropped).toEqual([
      { weightLb: 426, cwt: 1850 },
      { weightLb: 450, cwt: 1900 },
    ]);
  });

  it("keeps every real rung of a clean series", () => {
    const [s] = seriesFrom(IOWA_STEERS);
    expect(s.rungs).toHaveLength(IOWA_STEERS.length);
    expect(s.dropped).toEqual([]);
  });

  it("judges a rung against its own series, not a fixed band on dollars", () => {
    // Cattle prices move by multiples across a decade. A ceiling written
    // today would start throwing away real rungs in a strong market, so the
    // same shape at ten times the money must survive intact.
    const dear = IOWA_STEERS.map((r) => ({ ...r, cwt: Number(r.cwt) * 10 }));
    const [s] = seriesFrom(dear);
    expect(s.dropped).toEqual([]);
    expect(s.rungs).toHaveLength(IOWA_STEERS.length);
  });

  it("drops a rung far under the series as well as far over", () => {
    const [s] = seriesFrom([...IOWA_STEERS, row({ wt: 700, cwt: 12 })]);
    expect(s.dropped.map((d) => d.cwt)).toEqual([12]);
  });

  it("leaves out rows with no weight or no price at all", () => {
    const [s] = seriesFrom([...IOWA_STEERS, row({ wt: null }), row({ cwt: null }), row({ wt: 0 })]);
    expect(s.rungs).toHaveLength(IOWA_STEERS.length);
    expect(s.dropped).toEqual([]);
  });
});

describe("what is not offered", () => {
  it("drops a series with only one usable rung", () => {
    // One weight and one price is a quote. Interpolating from it returns the
    // same figure at every weight — a flat market, which is not what one
    // point means.
    expect(seriesFrom([row({ class: "Bulls", wt: 1800, cwt: 190 })])).toEqual([]);
  });

  it("drops a series left with one rung after the bad ones go", () => {
    expect(
      seriesFrom([
        row({ class: "Bulls", wt: 1800, cwt: 190 }),
        row({ class: "Bulls", wt: 1200, cwt: 9000 }),
      ]),
    ).toEqual([]);
  });

  it("is empty for an empty report", () => {
    expect(seriesFrom([])).toEqual([]);
  });
});

describe("which series to offer first", () => {
  const local = row({ source_id: 2, label: "Iowa", is_local: true, head: 100 });
  const away = row({ source_id: 1, label: "Illinois", is_local: false, head: 5000 });

  it("puts the nearest barn first, even against a bigger market", () => {
    // A report from your own state prices cattle you could actually haul
    // there, which beats a deeper market three states away.
    const out = seriesFrom([
      local, { ...local, wt: 700 },
      away, { ...away, wt: 700 },
    ]);
    expect(out.map((s) => s.label)).toEqual(["Iowa", "Illinois"]);
  });

  it("puts the deeper market first among reports equally far off", () => {
    const a = row({ source_id: 1, label: "A", is_local: false, head: 50 });
    const b = row({ source_id: 3, label: "B", is_local: false, head: 900 });
    const out = seriesFrom([a, { ...a, wt: 700 }, b, { ...b, wt: 700 }]);
    expect(out.map((s) => s.label)).toEqual(["B", "A"]);
  });
});

describe("feeder cattle and slaughter cattle are not the same steer", () => {
  it("keeps them apart even where the class and grade read alike", () => {
    // One Iowa report calls both "Steers". The feeder is a 472 lb calf at
    // $456; the slaughter steer is 1,774 lb at $186. Blended, a draft of
    // feeders gets priced out by better than $100 a hundredweight.
    const out = seriesFrom([
      row({ commodity: "Feeder Cattle", grade: "N/A", wt: 500, cwt: 450 }),
      row({ commodity: "Feeder Cattle", grade: "N/A", wt: 600, cwt: 420 }),
      row({ commodity: "Slaughter Cattle", grade: "N/A", wt: 1200, cwt: 210 }),
      row({ commodity: "Slaughter Cattle", grade: "N/A", wt: 1400, cwt: 200 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.rungs.length === 2)).toBe(true);
  });

  it("says which it is, because a grade of 1 against none does not say it", () => {
    const [s] = seriesFrom([
      row({ commodity: "Slaughter Cattle", grade: "N/A", wt: 1200, cwt: 210 }),
      row({ commodity: "Slaughter Cattle", grade: "N/A", wt: 1400, cwt: 200 }),
    ]);
    expect(seriesLabel(s)).toBe(
      "Iowa Weekly Cattle Auction Summary · Slaughter Cattle · Steers",
    );
  });

  it("says nothing rather than guessing when the view predates the column", () => {
    // Migration 069 added it. A cached view without it must not invent one.
    const [s] = seriesFrom(IOWA_STEERS);
    expect(s.commodity).toBeNull();
    expect(seriesLabel(s)).toBe("Iowa Weekly Cattle Auction Summary · Steers · grade 1");
  });
});
