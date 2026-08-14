import { describe, expect, it } from "vitest";
import {
  asLineCoords,
  asPoint,
  asPolygonRing,
  fitPasture,
  fractionAlong,
  headingVector,
  pathFor,
  ringCentre,
  ringEncloses,
  scaleBarFeet,
  sweepCutLine,
  sweepExtent,
  sweepSlice,
  toLocal,
  type LonLat,
  type Local,
} from "./pasture-map";
import { REAL_BOUNDARIES } from "./__fixtures__/farm-geometry";

/**
 * Drawing the farm. The real Paddock 3 from the KML is the fixture, so the
 * numbers here are checkable against migration 040 rather than invented.
 */

/** Paddock 3 as 040 loaded it: the lower middle band, 1.97 acres. */
const P3: LonLat[] = [
  [-88.41335704, 42.87778162],
  [-88.41335444, 42.87722457],
  [-88.41494049, 42.8772196],
  [-88.41491775, 42.87778163],
];

describe("reading GeoJSON out of a jsonb column", () => {
  it("takes the outer ring and drops the repeated closing point", () => {
    const ring = asPolygonRing({ type: "Polygon", coordinates: [[...P3, P3[0]]] });
    expect(ring).toHaveLength(4);
    expect(ring![0]).toEqual(P3[0]);
  });

  it("keeps a ring that was not closed", () => {
    expect(asPolygonRing({ type: "Polygon", coordinates: [P3] })).toHaveLength(4);
  });

  it("reads a fence", () => {
    const line = asLineCoords({ type: "LineString", coordinates: [P3[0], P3[1], P3[2]] });
    expect(line).toHaveLength(3);
  });

  it("draws nothing rather than throwing on anything malformed", () => {
    // A bad boundary should lose one paddock, not the page.
    for (const bad of [
      null,
      undefined,
      42,
      "Polygon",
      {},
      { type: "Polygon" },
      { type: "Polygon", coordinates: [] },
      { type: "Polygon", coordinates: [[[1, 2]]] },
      { type: "Polygon", coordinates: [[["a", "b"], [1, 2], [3, 4]]] },
      { type: "Polygon", coordinates: [[[Number.NaN, 2], [1, 2], [3, 4]]] },
      { type: "LineString", coordinates: P3 },
    ]) {
      expect(asPolygonRing(bad)).toBeNull();
    }
    expect(asLineCoords({ type: "LineString", coordinates: [[1, 2]] })).toBeNull();
    expect(asPoint({ type: "LineString", coordinates: P3 })).toBeNull();
    expect(asPoint({ type: "Point", coordinates: [-88.41, 42.87] })).toEqual([-88.41, 42.87]);
  });
});

describe("the projection", () => {
  it("corrects for latitude, or the farm renders far too wide", () => {
    const frame = { lon0: -88.414, lat0: 42.8778 };
    // A degree of longitude at 42.9 N is about 73% of a degree of latitude.
    const [east] = toLocal(frame, [-88.414 + 1, 42.8778]);
    const [, north] = toLocal(frame, [-88.414, 42.8778 + 1]);
    expect(east / north).toBeCloseTo(Math.cos((42.8778 * Math.PI) / 180), 4);
  });

  it("takes its height from the farm's own proportions", () => {
    const p = fitPasture([P3], { width: 400, padding: 10 })!;
    expect(p.width).toBe(400);
    // Paddock 3 is about 424 ft across and 203 ft tall, so the drawing is
    // roughly half as tall as it is wide.
    expect(p.height / p.width).toBeCloseTo(203 / 424, 1);
  });

  it("puts north at the top, which SVG does not do by itself", () => {
    const p = fitPasture([P3], { width: 400 })!;
    const northern = P3.reduce((a, b) => (a[1] > b[1] ? a : b));
    const southern = P3.reduce((a, b) => (a[1] < b[1] ? a : b));
    expect(p.project(northern)[1]).toBeLessThan(p.project(southern)[1]);
  });

  it("fits inside the box it was given", () => {
    const p = fitPasture([P3], { width: 400, padding: 10 })!;
    for (const pt of P3) {
      const [x, y] = p.project(pt);
      expect(x).toBeGreaterThanOrEqual(9.9);
      expect(x).toBeLessThanOrEqual(390.1);
      expect(y).toBeGreaterThanOrEqual(9.9);
      expect(y).toBeLessThanOrEqual(p.height - 9.9);
    }
  });

  it("is null with nothing to draw", () => {
    expect(fitPasture([], { width: 400 })).toBeNull();
    expect(fitPasture([[[-88.414, 42.8778]]], { width: 400 })).toBeNull();
  });
});

describe("the sweep on real geometry", () => {
  const frame = { lon0: -88.414, lat0: 42.8778 };
  const ring: Local[] = P3.map((p) => toLocal(frame, p));

  it("points the way the mob advances", () => {
    expect(headingVector(0)[1]).toBeCloseTo(1); // north
    expect(headingVector(90)[0]).toBeCloseTo(1); // east
    expect(headingVector(270)[0]).toBeCloseTo(-1); // west
  });

  it("measures the unit across its own heading, not its bounding box", () => {
    // Paddock 3 is swept east to west and is about 424 ft across that way.
    const e = sweepExtent(ring, 270)!;
    expect((e.max - e.min) * 3.280839895).toBeCloseTo(424, -1);
  });

  it("starts fraction 0 at the end the mob enters", () => {
    // Swept east to west, so the first ground taken is the easternmost.
    const e = sweepExtent(ring, 270)!;
    const easternmost = ring.reduce((a, b) => (a[0] > b[0] ? a : b));
    const d = easternmost[0] * e.axis[0] + easternmost[1] * e.axis[1];
    expect(d).toBeCloseTo(e.min, 6);
  });

  it("cuts a strip whose area is the right fraction of the unit", () => {
    const slice = sweepSlice(ring, 270, 0, 0.25)!;
    expect(areaAcres(slice) / areaAcres(ring)).toBeCloseTo(0.25, 2);
  });

  it("cuts a strip in the middle of the sweep, not just off an end", () => {
    const slice = sweepSlice(ring, 270, 0.4, 0.6)!;
    expect(areaAcres(slice) / areaAcres(ring)).toBeCloseTo(0.2, 2);
  });

  it("gives back the whole unit for a full sweep", () => {
    expect(areaAcres(sweepSlice(ring, 270, 0, 1)!)).toBeCloseTo(areaAcres(ring), 4);
  });

  it("refuses a strip that goes nowhere", () => {
    expect(sweepSlice(ring, 270, 0.5, 0.5)).toBeNull();
    expect(sweepSlice(ring, 270, 0.7, 0.3)).toBeNull();
    expect(sweepSlice(ring.slice(0, 2), 270, 0, 1)).toBeNull();
  });

  it("slices the other way round for a unit swept the other way", () => {
    // The first quarter east-to-west and the last quarter west-to-east are
    // the same ground, approached from opposite ends.
    const first = sweepSlice(ring, 270, 0, 0.25)!;
    const last = sweepSlice(ring, 90, 0.75, 1)!;
    expect(areaAcres(first)).toBeCloseTo(areaAcres(last), 4);
    expect(centreX(first)).toBeCloseTo(centreX(last), 4);
  });
});

describe("the furniture", () => {
  it("closes a path so a paddock is a shape rather than a squiggle", () => {
    expect(pathFor([[0, 0], [10, 0], [10, 5]])).toBe("M0.0,0.0L10.0,0.0L10.0,5.0Z");
    expect(pathFor([])).toBe("");
  });

  it("centres a label", () => {
    expect(ringCentre([[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual([5, 5]);
  });

  it("picks a round number of feet for the scale bar", () => {
    const p = fitPasture([P3], { width: 400 })!;
    const bar = scaleBarFeet(p);
    expect([25, 50, 100, 200, 250, 500, 1000, 2000]).toContain(bar.feet);
    // And it is about a quarter of the drawing wide.
    expect(bar.px).toBeGreaterThan(40);
    expect(bar.px).toBeLessThan(200);
  });
});

/** Shoelace, in acres — the same arithmetic 040 used to measure the farm. */
function areaAcres(ring: Local[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2) / 4046.8564224;
}

function centreX(ring: Local[]): number {
  return ring.reduce((s, p) => s + p[0], 0) / ring.length;
}

describe("turning a finger on the drawing into a wire position", () => {
  const frame = { lon0: -88.414, lat0: 42.8778 };
  const ring: Local[] = P3.map((p) => toLocal(frame, p));

  it("undoes the projection exactly", () => {
    const p = fitPasture([P3], { width: 400, padding: 10 })!;
    for (const pt of P3) {
      const [x, y] = p.project(pt);
      const back = p.unproject(x, y);
      expect(back[0]).toBeCloseTo(pt[0], 7);
      expect(back[1]).toBeCloseTo(pt[1], 7);
    }
  });

  it("reads a tap at the entry end as the start of the sweep", () => {
    // Paddock 3 is swept east to west, so the eastern edge is fraction 0.
    const easternmost = ring.reduce((a, b) => (a[0] > b[0] ? a : b));
    expect(fractionAlong(ring, 270, easternmost)).toBeCloseTo(0, 4);
    const westernmost = ring.reduce((a, b) => (a[0] < b[0] ? a : b));
    expect(fractionAlong(ring, 270, westernmost)).toBeCloseTo(1, 4);
  });

  it("reads a tap in the middle as the middle", () => {
    const mid: Local = [
      ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length,
    ];
    expect(fractionAlong(ring, 270, mid)).toBeCloseTo(0.5, 1);
  });

  it("clamps a tap outside the unit rather than failing", () => {
    // Most taps at a gate are a bit off the boundary; landing on the nearest
    // sensible place beats refusing.
    const outside: Local = [ring[0][0] + 500, ring[0][1] + 500];
    const f = fractionAlong(ring, 270, outside);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
  });

  it("has no answer for a unit that is not a shape", () => {
    expect(fractionAlong(ring.slice(0, 2), 270, ring[0])).toBeNull();
  });
});

describe("the wire, drawn across the unit", () => {
  const frame = { lon0: -88.414, lat0: 42.8778 };
  const ring: Local[] = P3.map((p) => toLocal(frame, p));

  it("spans the unit at the fraction asked for", () => {
    const line = sweepCutLine(ring, 270, 0.5)!;
    // Paddock 3 is about 203 ft north to south, and a wire across an
    // east-to-west sweep runs that way.
    const len = Math.hypot(line[0][0] - line[1][0], line[0][1] - line[1][1]) * 3.280839895;
    expect(len).toBeCloseTo(203, -1);
  });

  it("sits where the fraction puts it", () => {
    const near = sweepCutLine(ring, 270, 0.1)!;
    const far = sweepCutLine(ring, 270, 0.9)!;
    // Swept east to west, so a later fraction is further west.
    expect(near[0][0]).toBeGreaterThan(far[0][0]);
  });

  it("agrees with the slice it bounds", () => {
    // The wire at f and the far edge of the slice 0→f are the same line.
    const slice = sweepSlice(ring, 270, 0, 0.3)!;
    const line = sweepCutLine(ring, 270, 0.3)!;
    const axis = headingVector(270);
    const at = (p: Local) => p[0] * axis[0] + p[1] * axis[1];
    const sliceMax = Math.max(...slice.map(at));
    expect(at(line[0])).toBeCloseTo(sliceMax, 4);
  });

  it("is null at the very ends, where a cut touches rather than crosses", () => {
    expect(sweepCutLine(ring.slice(0, 2), 270, 0.5)).toBeNull();
  });
});

describe("asking whether a point is on a shape", () => {
  // A square with a bite out of the middle of its bottom edge, so the mean of
  // the vertices lands in the bite rather than on the shape.
  const bitten: [number, number][] = [
    [0, 0], [10, 0], [10, 10], [6, 10], [6, 4], [4, 4], [4, 10], [0, 10],
  ];

  it("says yes inside and no outside", () => {
    expect(ringEncloses(bitten, 5, 2)).toBe(true);
    expect(ringEncloses(bitten, 5, 8)).toBe(false);
    expect(ringEncloses(bitten, -1, 5)).toBe(false);
    expect(ringEncloses(bitten, 11, 5)).toBe(false);
  });

  it("is the check a vertex mean cannot do for itself", () => {
    const [cx, cy] = ringCentre(bitten);
    expect(ringEncloses(bitten, cx, cy)).toBe(false);
  });

  it("holds for a real paddock's own centre", () => {
    const ring = asPolygonRing(REAL_BOUNDARIES["Paddock 4"])!;
    const pts = ring.map((p): [number, number] => [p[0] * 1e5, p[1] * 1e5]);
    const [cx, cy] = ringCentre(pts);
    expect(ringEncloses(pts, cx, cy)).toBe(true);
  });
});
