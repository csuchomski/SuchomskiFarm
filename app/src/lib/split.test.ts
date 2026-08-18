import { describe, expect, it } from "vitest";
import { SNAP_METRES, splitByFences } from "./split";
import { ringAcres, frameFor, toLocal, type LonLat } from "./pasture-map";

/**
 * Dividing a pasture by its fences.
 *
 * The fixture is this farm's own drawing — the perimeter and the four
 * interior fences, exactly as they sit in `herd.infrastructure`. That makes
 * the whole test a re-run of what migration 040 did by hand, and 040's
 * answer is on file to check against: five paddocks of 2.021, 1.932, 1.972,
 * 2.261 and 1.381 acres.
 *
 * They will not match to the thousandth and should not. 044's paddock
 * polygons were each drawn separately, so they overlap and gap a little and
 * come to 9.567 between them; these regions tile the perimeter exactly by
 * construction. Agreement within a few hundredths of an acre, and on the
 * total, is what says the division is the same division.
 *
 * The fences are worth looking at before reading the assertions. Two of the
 * four bend rather than run straight — the south one by 2.8 m over its 152 m
 * — so no amount of clipping by straight lines produces this. And all eight
 * interior ends were drawn missing what they meet, by up to 0.91 m.
 */

const PERIMETER: LonLat[] = [
  [-88.41415662, 42.87671229],
  [-88.41373100, 42.87662757],
  [-88.41317476, 42.87653120],
  [-88.41306449, 42.87688276],
  [-88.41307961, 42.87719421],
  [-88.41269056, 42.87719684],
  [-88.41299683, 42.87876087],
  [-88.41331173, 42.87882226],
  [-88.41412428, 42.87883078],
  [-88.41463922, 42.87873318],
  [-88.41489766, 42.87874084],
  [-88.41495831, 42.87686518],
  [-88.41415662, 42.87671229],
];

const NORTH_FENCE: LonLat[] = [
  [-88.41491223, 42.87833348],
  [-88.41335974, 42.87833699],
  [-88.41291959, 42.87833683],
];

const SOUTH_FENCE: LonLat[] = [
  [-88.41494049, 42.87721960],
  [-88.41335435, 42.87722457],
  [-88.41308246, 42.87719614],
];

const EAST_FENCE: LonLat[] = [
  [-88.41335974, 42.87833699],
  [-88.41335435, 42.87722457],
];

const MIDDLE_FENCE: LonLat[] = [
  [-88.41491750, 42.87778163],
  [-88.41335912, 42.87778118],
];
const FENCES = [NORTH_FENCE, SOUTH_FENCE, EAST_FENCE, MIDDLE_FENCE];

/** What migration 044 recorded, measured by hand off the same drawing. */
const RECORDED = [2.261, 2.021, 1.972, 1.932, 1.381];

const acresOf = (ring: LonLat[]): number => {
  const frame = frameFor(ring)!;
  return ringAcres(ring.map((p) => toLocal(frame, p)));
};

describe("dividing a pasture by the fences across it", () => {
  it("finds the five paddocks the farm is actually fenced into", () => {
    const out = splitByFences(PERIMETER, FENCES)!;
    expect(out.regions).toHaveLength(5);
  });

  it("gets each one within a twentieth of an acre of what 040 measured by hand", () => {
    const out = splitByFences(PERIMETER, FENCES)!;
    const got = out.regions.map((r) => r.acres).sort((a, b) => b - a);
    // The largest disagreement is 0.043 ac on the east lobe, which is the
    // unit 044 itself redrew. Exact agreement is not available and would be
    // suspicious: those five polygons were traced one at a time and do not
    // tile the perimeter, while these do.
    for (let i = 0; i < RECORDED.length; i++) {
      const off = Math.abs(got[i] - RECORDED[i]);
      expect(`${i}: off by ${off.toFixed(3)}`).toBe(`${i}: off by ${off <= 0.05 ? off.toFixed(3) : "TOO MUCH"}`);
    }
  });

  it("divides the whole pasture and leaves nothing over", () => {
    const out = splitByFences(PERIMETER, FENCES)!;
    const whole = acresOf(PERIMETER);
    const sum = out.regions.reduce((a, r) => a + r.acres, 0);
    // 040's words: "sum to the whole with nothing left over".
    expect(sum).toBeCloseTo(whole, 3);
    expect(whole).toBeCloseTo(9.567, 2);
  });

  it("says how many ends it had to pull shut, rather than doing it silently", () => {
    const out = splitByFences(PERIMETER, FENCES)!;
    // Six of the eight interior ends were drawn short of what they meet; the
    // east fence's two already land exactly on the north and south ones.
    expect(out.snapped).toBeGreaterThan(0);
    expect(out.maxSnapMetres).toBeLessThanOrEqual(SNAP_METRES);
    expect(out.maxSnapMetres).toBeGreaterThan(0.5);
    expect(out.danglingFences).toBe(0);
  });

  it("hands back rings a boundary column can take", () => {
    const out = splitByFences(PERIMETER, FENCES)!;
    for (const r of out.regions) {
      expect(r.ring.length).toBeGreaterThanOrEqual(4);
      expect(r.ring[0]).toEqual(r.ring[r.ring.length - 1]);
      // and the ring really is the acreage claimed for it. Not to the
      // microacre: `acres` is measured in the pasture's frame and this
      // re-derives one from the region alone, so the two projections differ
      // by a few square feet across a farm.
      expect(acresOf(r.ring)).toBeCloseTo(r.acres, 3);
    }
  });
});

describe("what it does with less to work with", () => {
  /** A square about 660 ft on a side — roughly ten acres. */
  const SQUARE: LonLat[] = [
    [-88.4200, 42.8770], [-88.4175, 42.8770], [-88.4175, 42.8788], [-88.4200, 42.8788], [-88.4200, 42.8770],
  ];

  it("returns the pasture whole when there are no fences", () => {
    const out = splitByFences(SQUARE, [])!;
    expect(out.regions).toHaveLength(1);
    expect(out.regions[0].acres).toBeCloseTo(acresOf(SQUARE), 3);
  });

  it("cuts a square in two down the middle", () => {
    const out = splitByFences(SQUARE, [[[-88.41875, 42.8770], [-88.41875, 42.8788]]])!;
    expect(out.regions).toHaveLength(2);
    expect(out.regions[0].acres).toBeCloseTo(out.regions[1].acres, 2);
  });

  it("pulls a fence that misses by a yard onto the boundary", () => {
    // Both ends a little short — the ordinary state of a hand-drawn fence.
    const short: LonLat[] = [[-88.41875, 42.87701], [-88.41875, 42.87879]];
    const out = splitByFences(SQUARE, [short])!;
    expect(out.regions).toHaveLength(2);
    expect(out.snapped).toBe(2);
    expect(out.danglingFences).toBe(0);
  });

  it("leaves a fence that stops halfway alone, and says it divided nothing", () => {
    // Half a fence really does not make two fields, and pretending otherwise
    // would invent a boundary nobody built.
    const stub: LonLat[] = [[-88.41875, 42.8770], [-88.41875, 42.8779]];
    const out = splitByFences(SQUARE, [stub])!;
    expect(out.regions).toHaveLength(1);
    expect(out.danglingFences).toBe(1);
    // and the stub has not eaten any of the acreage
    expect(out.regions[0].acres).toBeCloseTo(acresOf(SQUARE), 3);
  });

  it("handles a fence drawn right across and out the other side", () => {
    const overshoot: LonLat[] = [[-88.41875, 42.8760], [-88.41875, 42.8798]];
    const out = splitByFences(SQUARE, [overshoot])!;
    expect(out.regions).toHaveLength(2);
  });

  it("says nothing useful about a pasture with no shape", () => {
    expect(splitByFences([[-88.42, 42.877], [-88.4175, 42.877]], [])).toBeNull();
  });
});


const ST_JAMES: LonLat[] = [
  [-88.32062922, 42.87596925],
  [-88.32060514, 42.87867362],
  [-88.32310040, 42.87875814],
  [-88.32560159, 42.87755552],
  [-88.32553733, 42.87549601],
  [-88.32445188, 42.87549728],
  [-88.32445579, 42.87374242],
  [-88.32324175, 42.87366052],
  [-88.32267065, 42.87459404],
  [-88.32216414, 42.87600165],
  [-88.32062922, 42.87596925],
];

const ST_JAMES_FENCES: LonLat[][] = [
  [
    [-88.32216576, 42.87600911],
    [-88.32216299, 42.87872909],
  ],
  [
    [-88.32446804, 42.87550066],
    [-88.32445259, 42.87809341],
  ],
  [
    [-88.32446089, 42.87630507],
    [-88.32216717, 42.87628957],
  ],
];

describe("a second farm, and the bug it found", () => {
  /**
   * St James on Rocky Ridge: an outline and three fences, none of which quite
   * touch what they meet — the six ends are out by 0.14 to 1.36 m.
   *
   * Snapping was originally a single pass measured against where everything
   * *started*. That is fine until a fence is aimed at another fence which is
   * then itself pulled onto the boundary: the first one is left a fraction
   * off what it was aimed at, which is far too little to see and far too much
   * to intersect. Here it cost a whole paddock — three fences all reaching,
   * and only two of them cutting. Passes fix it, and this is the farm that
   * showed it, so the farm is the test.
   */
  it("cuts all three fences, not two of them", () => {
    const out = splitByFences(ST_JAMES, ST_JAMES_FENCES)!;
    expect(out.danglingFences).toBe(0);
    expect(out.regions).toHaveLength(4);
  });

  it("reports the ends it moved against where they were drawn", () => {
    const out = splitByFences(ST_JAMES, ST_JAMES_FENCES)!;
    expect(out.snapped).toBe(6);
    // The furthest miss in the drawing, not however far the last pass nudged.
    expect(out.maxSnapMetres).toBeCloseTo(1.36, 1);
  });

  it("divides the whole 37.89 acres and leaves nothing over", () => {
    const out = splitByFences(ST_JAMES, ST_JAMES_FENCES)!;
    const whole = acresOf(ST_JAMES);
    expect(whole).toBeCloseTo(37.89, 1);
    expect(out.regions.reduce((a, r) => a + r.acres, 0)).toBeCloseTo(whole, 3);
    expect(out.regions.map((r) => Number(r.acres.toFixed(2)))).toEqual([11.67, 11.0, 9.42, 5.8]);
  });
});
