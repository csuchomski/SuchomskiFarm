import { frameFor, localToLonLat, ringAcres, toLocal, type Local, type LonLat } from "./pasture-map";

/**
 * Dividing a pasture by the fences drawn across it.
 *
 * Most people draw a farm the way it is built: an outline, and fence lines
 * across it. Almost nobody draws each paddock as its own closed shape, so a
 * KML that plainly describes five paddocks arrives as one polygon and four
 * lines — and until now the app could only say "a line, not an area" and
 * leave them out. Migration 040 did this division by hand for one farm:
 * "the four interior fences divide it into five regions that sum to the whole
 * with nothing left over."
 *
 * This is that, computed.
 *
 * **It is a planar subdivision, not a series of half-plane cuts.** Clipping
 * the polygon by each fence extended to an infinite line is far simpler and
 * is wrong the moment a fence bends or stops partway: this farm's south fence
 * bends 2.8 m over its 152 m, and its east fence runs between two other
 * fences without touching the boundary at all. So every segment is split at
 * every crossing, and the faces of the resulting graph are the regions.
 *
 * **Loose ends are pulled shut.** A fence drawn by hand misses what it meets
 * by inches — on the farm this was written against, the eight interior fence
 * ends missed by between 0 and 0.91 m. A gap of any size leaves the fence
 * dangling, and a dangling fence divides nothing at all, so an end within
 * `SNAP_METRES` of other geometry is moved onto it. Anything further away is
 * left alone and simply fails to divide, which is the honest outcome: a fence
 * that stops halfway across a field really does not make two fields.
 */

/** How far a loose end may be pulled to meet what it was drawn against.
 *
 *  Two metres, about six feet. Wide enough for the yard-ish misses that hand
 *  drawing produces, narrow enough that a fence genuinely stopping short of
 *  the boundary is not silently joined to it. */
export const SNAP_METRES = 2;

/** Regions below this are dropped as artefacts of two fences nearly meeting.
 *  A hundredth of an acre is about 44 square feet. */
const MIN_ACRES = 0.01;

/** Points closer than this are the same point. A tenth of a millimetre. */
const EPS = 1e-4;

export interface Region {
  /** Closed ring, ready for a `boundary` column. */
  ring: LonLat[];
  acres: number;
}

export interface SplitResult {
  regions: Region[];
  /** Fence ends that had to be pulled shut, and by how far at most. */
  snapped: number;
  maxSnapMetres: number;
  /** Fences that touched nothing and so divided nothing. */
  danglingFences: number;
  /** Slivers dropped as artefacts. */
  slivers: number;
}

type Seg = [Local, Local];

const segmentsOf = (points: Local[], closed: boolean): Seg[] => {
  const out: Seg[] = [];
  for (let i = 0; i + 1 < points.length; i++) out.push([points[i], points[i + 1]]);
  if (closed && points.length > 2) {
    const a = points[points.length - 1];
    const b = points[0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > EPS) out.push([a, b]);
  }
  return out;
};

/** The nearest point on a segment, and how far off it is. */
function nearestOn(p: Local, a: Local, b: Local): { at: Local; away: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const at: Local = [a[0] + t * dx, a[1] + t * dy];
  return { at, away: Math.hypot(p[0] - at[0], p[1] - at[1]) };
}

/** Where a crosses b, as a fraction along a. Null when they do not meet. */
function crossingAlong(p: Local, p2: Local, q: Local, q2: Local): number | null {
  const rx = p2[0] - p[0];
  const ry = p2[1] - p[1];
  const sx = q2[0] - q[0];
  const sy = q2[1] - q[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallel, including collinear
  const t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / denom;
  const u = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / denom;
  const on = (v: number) => v >= -1e-9 && v <= 1 + 1e-9;
  return on(t) && on(u) ? t : null;
}

const signedArea = (ring: Local[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

interface Node {
  at: Local;
  out: HalfEdge[];
}
interface HalfEdge {
  from: Node;
  to: Node;
  twin: HalfEdge;
}

/**
 * The regions a pasture is divided into by the fences drawn across it.
 *
 * `outer` is the pasture's ring; `fences` are open polylines. Everything is
 * projected into the same local frame the rest of the app measures in, so the
 * acres come out on exactly the arithmetic `ringAcres` uses everywhere else.
 *
 * With no fence that reaches anything, the result is the pasture itself — one
 * region, unchanged. That is the correct answer, not a failure.
 */
export function splitByFences(outer: LonLat[], fences: LonLat[][]): SplitResult | null {
  const frame = frameFor(outer);
  if (frame === null || outer.length < 3) return null;

  const ring = outer.map((p) => toLocal(frame, p));
  // A ring that repeats its first point would make a zero-length segment.
  const first = ring[0];
  const last = ring[ring.length - 1];
  const open = Math.hypot(first[0] - last[0], first[1] - last[1]) <= EPS ? ring.slice(0, -1) : ring;
  // Counter-clockwise, so the interior faces come out positive and the one
  // negative face is the outside. Without this the orientation of the answer
  // depends on which way round the file happened to draw the boundary.
  const boundary = signedArea(open) < 0 ? [...open].reverse() : open;

  const cuts = fences
    .map((f) => f.map((p) => toLocal(frame, p)))
    .filter((f) => f.length >= 2);

  // ── pull the loose ends shut ──────────────────────────────────────────
  //
  // Done in passes, because the targets move too. Snapping a fence onto its
  // neighbour and then snapping that neighbour onto the boundary leaves the
  // first one a millimetre off what it was aimed at — far too little to see
  // and far too much to intersect, so the fence silently stops dividing. On
  // the farm this was written against, that cost a paddock: three fences all
  // reaching, and only two of them cutting.
  //
  // Each pass measures against wherever everything is now. Movements shrink
  // by orders of magnitude per pass, so this settles in two or three; the cap
  // is there so a pathological file cannot spin.
  const moved = cuts.map((c) => c.map((p): Local => [p[0], p[1]]));
  const started = cuts.map((c) => [c[0], c[c.length - 1]].map((p): Local => [p[0], p[1]]));

  const othersOf = (skip: number): Seg[] => [
    ...segmentsOf(boundary, true),
    ...moved.flatMap((c, j) => (j === skip ? [] : segmentsOf(c, false))),
  ];

  for (let pass = 0; pass < 4; pass++) {
    let worst = 0;
    for (let i = 0; i < moved.length; i++) {
      const targets = othersOf(i);
      for (const idx of [0, moved[i].length - 1]) {
        let best: { at: Local; away: number } | null = null;
        for (const [a, b] of targets) {
          const got = nearestOn(moved[i][idx], a, b);
          if (best === null || got.away < best.away) best = got;
        }
        if (best !== null && best.away > EPS && best.away <= SNAP_METRES) {
          moved[i][idx] = best.at;
          worst = Math.max(worst, best.away);
        }
      }
    }
    if (worst <= EPS) break;
  }

  // Reported against where the ends began, not how far the last pass nudged
  // them — what a farmer wants to know is how far the drawing was out.
  let snapped = 0;
  let maxSnapMetres = 0;
  for (let i = 0; i < moved.length; i++) {
    [0, moved[i].length - 1].forEach((idx, k) => {
      const from = started[i][k];
      const to = moved[i][idx];
      const away = Math.hypot(from[0] - to[0], from[1] - to[1]);
      if (away > EPS) {
        snapped += 1;
        maxSnapMetres = Math.max(maxSnapMetres, away);
      }
    });
  }

  // A fence with an end still adrift divides nothing; counted so the screen
  // can say so rather than quietly producing one region.
  //
  // Ownership is carried alongside each segment rather than compared by
  // identity: `segmentsOf` builds fresh arrays every call, so an identity
  // check excludes nothing and every fence measures zero against itself.
  const owned: { seg: Seg; owner: number }[] = [
    ...segmentsOf(boundary, true).map((seg) => ({ seg, owner: -1 })),
    ...moved.flatMap((c, i) => segmentsOf(c, false).map((seg) => ({ seg, owner: i }))),
  ];
  const network = owned.map((o) => o.seg);

  let danglingFences = 0;
  for (let i = 0; i < moved.length; i++) {
    const adrift = [0, moved[i].length - 1].some((idx) => {
      let nearest = Infinity;
      for (const { seg, owner } of owned) {
        if (owner === i) continue;
        nearest = Math.min(nearest, nearestOn(moved[i][idx], seg[0], seg[1]).away);
      }
      return nearest > EPS;
    });
    if (adrift) danglingFences += 1;
  }

  // ── split every segment at every crossing ─────────────────────────────
  const pieces: Seg[] = [];
  for (let i = 0; i < network.length; i++) {
    const [a, b] = network[i];
    const cutsAt = [0, 1];
    for (let j = 0; j < network.length; j++) {
      if (i === j) continue;
      const t = crossingAlong(a, b, network[j][0], network[j][1]);
      if (t !== null) cutsAt.push(t);
    }
    cutsAt.sort((x, y) => x - y);
    for (let k = 0; k + 1 < cutsAt.length; k++) {
      const t1 = cutsAt[k];
      const t2 = cutsAt[k + 1];
      if (t2 - t1 < 1e-9) continue;
      const p1: Local = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const p2: Local = [a[0] + (b[0] - a[0]) * t2, a[1] + (b[1] - a[1]) * t2];
      if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) > EPS) pieces.push([p1, p2]);
    }
  }

  // ── the graph, and its faces ──────────────────────────────────────────
  const nodes = new Map<string, Node>();
  const keyOf = (p: Local) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
  const nodeAt = (p: Local): Node => {
    const k = keyOf(p);
    const found = nodes.get(k);
    if (found !== undefined) return found;
    const made: Node = { at: p, out: [] };
    nodes.set(k, made);
    return made;
  };

  const halves: HalfEdge[] = [];
  const drawn = new Set<string>();
  for (const [a, b] of pieces) {
    const na = nodeAt(a);
    const nb = nodeAt(b);
    if (na === nb) continue;
    // The same edge can arrive twice — once from each segment that produced
    // it — and a doubled edge breaks the face walk.
    const pair = [keyOf(a), keyOf(b)].sort().join("|");
    if (drawn.has(pair)) continue;
    drawn.add(pair);

    const one = { from: na, to: nb } as HalfEdge;
    const two = { from: nb, to: na } as HalfEdge;
    one.twin = two;
    two.twin = one;
    na.out.push(one);
    nb.out.push(two);
    halves.push(one, two);
  }

  const angleOf = (h: HalfEdge) => Math.atan2(h.to.at[1] - h.from.at[1], h.to.at[0] - h.from.at[0]);
  for (const n of nodes.values()) n.out.sort((x, y) => angleOf(x) - angleOf(y));

  // Arriving at v along h, leave by the edge one step clockwise from the way
  // back. That walks the faces on a consistent side, so each face is closed
  // and each half-edge belongs to exactly one.
  const nextAround = (h: HalfEdge): HalfEdge => {
    const v = h.to;
    const back = h.twin;
    const i = v.out.indexOf(back);
    return v.out[(i - 1 + v.out.length) % v.out.length];
  };

  const walked = new Set<HalfEdge>();
  const faces: Local[][] = [];
  for (const start of halves) {
    if (walked.has(start)) continue;
    const face: Local[] = [];
    let cur = start;
    for (let guard = 0; guard <= halves.length; guard++) {
      walked.add(cur);
      face.push(cur.from.at);
      cur = nextAround(cur);
      if (cur === start) break;
    }
    if (face.length >= 3) faces.push(face);
  }

  // ── what to keep ──────────────────────────────────────────────────────
  let slivers = 0;
  const regions: Region[] = [];
  for (const face of faces) {
    const area = signedArea(face);
    if (area <= 0) continue; // the outside, walked the other way round
    const acres = ringAcres(face);
    if (acres < MIN_ACRES) {
      slivers += 1;
      continue;
    }
    const back = face.map((p) => localToLonLat(frame, p));
    regions.push({ ring: [...back, back[0]], acres });
  }

  regions.sort((a, b) => b.acres - a.acres);
  return { regions, snapped, maxSnapMetres, danglingFences, slivers };
}
