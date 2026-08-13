/**
 * Drawing the farm: GeoJSON in, SVG coordinates out.
 *
 * There is no basemap and no tile service. The farm's boundaries and fences
 * arrived as a KML the owner drew (migration 040), water and gates are settled
 * as not mapped, and what remains is a plan drawn in ink — which is what the
 * standard asks for and what this app's paper vocabulary already looks like.
 *
 * **Everything here is planar.** Over 600 feet at 42.9° N, a local
 * equirectangular projection is accurate to well under a tenth of an acre, and
 * the alternative is a projection library for a field you can see across. The
 * one correction that matters is `cos(lat)` on the east–west axis: without it
 * the farm would render 27% too wide at this latitude, which is visible.
 */

/** `[longitude, latitude]`, in that order, as GeoJSON stores it. */
export type LonLat = [number, number];

/** Metres east and north of the frame's origin. */
export type Local = [number, number];

/**
 * GeoJSON arrives from a `jsonb` column as `unknown`, so it is parsed
 * defensively rather than cast. A malformed boundary should draw nothing and
 * leave the rest of the map alone, not throw the page away.
 */
function coordPairs(v: unknown): LonLat[] | null {
  if (!Array.isArray(v)) return null;
  const out: LonLat[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const [lon, lat] = p;
    if (typeof lon !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    out.push([lon, lat]);
  }
  return out.length > 0 ? out : null;
}

/** The outer ring of a GeoJSON Polygon. Holes are ignored — no unit on this
 * farm has one, and drawing a hole that is not there is worse than not
 * supporting them. */
export function asPolygonRing(geo: unknown): LonLat[] | null {
  if (typeof geo !== "object" || geo === null) return null;
  const g = geo as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Polygon" || !Array.isArray(g.coordinates)) return null;
  const ring = coordPairs(g.coordinates[0]);
  if (ring === null || ring.length < 3) return null;
  // A GeoJSON ring repeats its first point; SVG closes the path itself.
  const last = ring[ring.length - 1];
  const first = ring[0];
  return last[0] === first[0] && last[1] === first[1] ? ring.slice(0, -1) : ring;
}

export function asLineCoords(geo: unknown): LonLat[] | null {
  if (typeof geo !== "object" || geo === null) return null;
  const g = geo as { type?: unknown; coordinates?: unknown };
  if (g.type !== "LineString") return null;
  const line = coordPairs(g.coordinates);
  return line !== null && line.length >= 2 ? line : null;
}

export function asPoint(geo: unknown): LonLat | null {
  if (typeof geo !== "object" || geo === null) return null;
  const g = geo as { type?: unknown; coordinates?: unknown };
  if (g.type !== "Point") return null;
  const p = coordPairs([g.coordinates]);
  return p === null ? null : p[0];
}

const METRES_PER_DEGREE = 111_320;

export interface Frame {
  lon0: number;
  lat0: number;
}

export function frameFor(points: LonLat[]): Frame | null {
  if (points.length === 0) return null;
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  return { lon0, lat0 };
}

/** Metres east and north of the frame origin. */
export function toLocal(frame: Frame, p: LonLat): Local {
  const k = Math.cos((frame.lat0 * Math.PI) / 180);
  return [(p[0] - frame.lon0) * METRES_PER_DEGREE * k, (p[1] - frame.lat0) * METRES_PER_DEGREE];
}

export interface PastureProjection {
  width: number;
  height: number;
  frame: Frame;
  /** Longitude and latitude to SVG user units. */
  project(p: LonLat): [number, number];
  /** Metres to SVG user units — for a scale bar. */
  scale: number;
}

/**
 * Fit everything on the map into a box of a given width.
 *
 * Height falls out of the farm's own proportions rather than being passed in:
 * forcing a shape into a box of the wrong aspect is how a map starts lying
 * about distance, and a 9.5-acre field that is half again as long as it is
 * wide should render that way.
 */
export function fitPasture(
  features: LonLat[][],
  opts: { width: number; padding?: number },
): PastureProjection | null {
  const all = features.flat();
  const frame = frameFor(all);
  if (frame === null) return null;

  const pad = opts.padding ?? 12;
  const local = all.map((p) => toLocal(frame, p));
  const xs = local.map((p) => p[0]);
  const ys = local.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX <= 0 && spanY <= 0) return null;

  const inner = Math.max(1, opts.width - pad * 2);
  const scale = spanX > 0 ? inner / spanX : inner / spanY;
  const height = spanY * scale + pad * 2;

  return {
    width: opts.width,
    height,
    frame,
    scale,
    project(p: LonLat) {
      const [x, y] = toLocal(frame, p);
      // y is flipped: SVG counts down the page, latitude counts up the map.
      return [pad + (x - minX) * scale, pad + (maxY - y) * scale];
    },
  };
}

// ─── the sweep, on real geometry ───────────────────────────────────────
//
// With a boundary on file the wire stops being an abstract fraction and
// becomes a line across the drawing. The unit's ground is cut perpendicular
// to its sweep heading, so a strip is the part of the polygon between two
// such cuts — which is a clip against two half-planes and needs no geometry
// library.

/** Unit vector the mob advances along: 0 N, 90 E, 180 S, 270 W. */
export function headingVector(headingDeg: number): Local {
  const rad = (headingDeg * Math.PI) / 180;
  return [Math.sin(rad), Math.cos(rad)];
}

/** How far along the sweep a point sits, in metres. */
function along(p: Local, axis: Local): number {
  return p[0] * axis[0] + p[1] * axis[1];
}

export interface SweepExtent {
  min: number;
  max: number;
  axis: Local;
}

/** The unit's extent along its own heading — fraction 0 sits at `min`. */
export function sweepExtent(ring: Local[], headingDeg: number): SweepExtent | null {
  if (ring.length < 3) return null;
  const axis = headingVector(headingDeg);
  const ds = ring.map((p) => along(p, axis));
  const min = Math.min(...ds);
  const max = Math.max(...ds);
  return max - min <= 0 ? null : { min, max, axis };
}

/** Sutherland–Hodgman against one half-plane: keep `along(p) <= limit`, or
 * `>=` when `keepBelow` is false. */
function clipHalf(ring: Local[], axis: Local, limit: number, keepBelow: boolean): Local[] {
  const inside = (p: Local) => (keepBelow ? along(p, axis) <= limit : along(p, axis) >= limit);
  const out: Local[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[i];
    const ia = inside(a);
    const ib = inside(b);
    if (ia !== ib) {
      const da = along(a, axis);
      const db = along(b, axis);
      const t = (limit - da) / (db - da);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      if (ib) out.push(b);
    } else if (ib) {
      out.push(b);
    }
  }
  return out;
}

/**
 * The part of a unit between two positions along its sweep.
 *
 * `from` and `to` are the same 0–1 fractions the move log stores, so a strip
 * recorded without any coordinates can be drawn the moment a boundary exists.
 * Returns null when the slice is empty, which happens legitimately at a
 * degenerate width.
 */
export function sweepSlice(
  ring: Local[],
  headingDeg: number,
  from: number,
  to: number,
): Local[] | null {
  const extent = sweepExtent(ring, headingDeg);
  if (extent === null || to <= from) return null;

  const span = extent.max - extent.min;
  const lo = extent.min + Math.max(0, Math.min(1, from)) * span;
  const hi = extent.min + Math.max(0, Math.min(1, to)) * span;

  const clipped = clipHalf(clipHalf(ring, extent.axis, hi, true), extent.axis, lo, false);
  return clipped.length >= 3 ? clipped : null;
}

/** Local metres back to a projected path, given the projection's own frame. */
export function localToLonLat(frame: Frame, p: Local): LonLat {
  const k = Math.cos((frame.lat0 * Math.PI) / 180);
  return [frame.lon0 + p[0] / (METRES_PER_DEGREE * k), frame.lat0 + p[1] / METRES_PER_DEGREE];
}

/** An SVG path `d` for a closed ring. */
export function pathFor(points: [number, number][]): string {
  if (points.length === 0) return "";
  return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;
}

/** An SVG path `d` for an open line. */
export function linePathFor(points: [number, number][]): string {
  if (points.length === 0) return "";
  return `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}`;
}

/** The visual centre of a ring, for a label. The centroid of the vertices
 * rather than of the area — cheaper, and close enough for a name on a
 * paddock that is roughly rectangular. */
export function ringCentre(points: [number, number][]): [number, number] {
  const n = points.length;
  if (n === 0) return [0, 0];
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

/** A round number of feet that fits comfortably inside the map, for a bar. */
export function scaleBarFeet(projection: PastureProjection): { feet: number; px: number } {
  const target = projection.width * 0.25;
  const metresPerPx = 1 / projection.scale;
  const rough = target * metresPerPx * 3.280839895;
  const steps = [25, 50, 100, 200, 250, 500, 1000, 2000];
  const feet = steps.reduce((best, s) => (Math.abs(s - rough) < Math.abs(best - rough) ? s : best), steps[0]);
  return { feet, px: (feet / 3.280839895) * projection.scale };
}
