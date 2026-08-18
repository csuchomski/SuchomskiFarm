import { type Region } from "./split";
import {
  frameFor,
  ringAcres,
  ringCentre,
  ringEncloses,
  sweepExtent,
  sweepLengthFt,
  toLocal,
  type Local,
  type LonLat,
} from "./pasture-map";

/**
 * Reading a drawn file: KML in, ground out.
 *
 * Migration 040 measured this farm off a KML the owner drew in Google Earth,
 * and it settled real questions — the units run 1.375 to 2.255 acres where
 * every one of them had been carrying a flat 1.91. That was done offline with
 * a Python script. This is the same work, in the browser.
 *
 * **The file is never uploaded.** It is read with `file.text()`, parsed here,
 * and only the geometry the farmer confirms is written. A KML of somebody's
 * farm is a map of their home; there is no reason for it to sit in a bucket.
 *
 * **KML is XML and the browser already parses XML.** No library. The one
 * wrinkle is namespaces: files come out with `xmlns` set, without it, and
 * occasionally with a `gx:` prefix on things, so everything here matches on
 * *local* name and ignores the namespace entirely.
 *
 * **Nothing is inferred that the file actually says.** A KML has folders, but
 * no folder means "these are subdivisions of that". So containment is
 * computed — a polygon whose centre falls inside another polygon is *proposed*
 * as a paddock of it — and the review screen presents that as a suggestion to
 * confirm, never as a fact. Sweep headings are not guessed at all: which way
 * the wire advances is a decision about how the farm is walked, and a long
 * axis is not that decision.
 */

export type ShapeKind = "polygon" | "line" | "point";

export interface KmlShape {
  /** Stable within one parse, so the review screen can key rows. */
  id: string;
  /** As the file names it. Blank names are numbered rather than left empty. */
  name: string;
  kind: ShapeKind;
  /** The folder path it sat under, for telling two "Untitled Polygon"s apart. */
  folder: string | null;
  /** GeoJSON, ready for the `boundary` column. */
  geo: GeoJson;
  /** Polygons only. Measured with the same shoelace 040 used. */
  acres: number | null;
  /** Lines only — how long the fence or track is. */
  lengthFt: number | null;
  /** Every point in it, for the containment test and the frame. */
  points: LonLat[];
}

export type GeoJson =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Point"; coordinates: number[] };

const FEET_PER_METRE = 3.280839895;

/** Elements by local name, whatever namespace or prefix they carry. */
function kids(el: Element, local: string): Element[] {
  return [...el.children].filter((c) => c.localName === local);
}

function descendants(root: Element | Document, local: string): Element[] {
  const all = root.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) out.push(all[i]);
  }
  return out;
}

function firstDescendant(el: Element, local: string): Element | null {
  return descendants(el, local)[0] ?? null;
}

/**
 * `lon,lat[,alt]` tuples separated by any whitespace.
 *
 * Google Earth writes them one per line with generous indentation; other
 * exporters run them together on one enormous line. Both are the same to a
 * split on whitespace. A tuple that does not parse ends the shape rather than
 * being skipped — half a boundary is worse than none, because it still draws.
 */
export function parseCoordinates(text: string): LonLat[] | null {
  const out: LonLat[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (token === "") continue;
    const parts = token.split(",");
    if (parts.length < 2) return null;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    // Altitude, if present, is dropped: this app draws a plan, and a KML's
    // altitude is usually clampToGround anyway.
    out.push([lon, lat]);
  }
  return out.length > 0 ? out : null;
}

/** The name of every Folder above a placemark, joined. */
function folderPathOf(el: Element): string | null {
  const names: string[] = [];
  let node = el.parentElement;
  while (node !== null) {
    if (node.localName === "Folder" || node.localName === "Document") {
      const n = kids(node, "name")[0]?.textContent?.trim();
      if (n) names.unshift(n);
    }
    node = node.parentElement;
  }
  return names.length > 0 ? names.join(" › ") : null;
}

function geometryOf(placemark: Element): { kind: ShapeKind; ring: LonLat[] } | null {
  // A Polygon's outer ring, specifically — an inner ring is a hole, and this
  // app draws no holes, so taking any <coordinates> under the Polygon would
  // silently draw the hole as the field.
  const poly = firstDescendant(placemark, "Polygon");
  if (poly !== null) {
    const outer = firstDescendant(poly, "outerBoundaryIs") ?? poly;
    const coords = firstDescendant(outer, "coordinates");
    const ring = coords?.textContent ? parseCoordinates(coords.textContent) : null;
    if (ring !== null && ring.length >= 3) return { kind: "polygon", ring };
    return null;
  }

  const line = firstDescendant(placemark, "LineString");
  if (line !== null) {
    const coords = firstDescendant(line, "coordinates");
    const pts = coords?.textContent ? parseCoordinates(coords.textContent) : null;
    if (pts !== null && pts.length >= 2) return { kind: "line", ring: pts };
    return null;
  }

  const point = firstDescendant(placemark, "Point");
  if (point !== null) {
    const coords = firstDescendant(point, "coordinates");
    const pts = coords?.textContent ? parseCoordinates(coords.textContent) : null;
    if (pts !== null) return { kind: "point", ring: [pts[0]] };
    return null;
  }

  return null;
}

/** A GeoJSON ring closes on its first point; KML usually does too, but not
 *  always, and the `boundary` column is read by code that expects it to. */
function closed(ring: LonLat[]): number[][] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  const out = ring.map(([lon, lat]) => [lon, lat]);
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out;
}

function localRing(points: LonLat[]): Local[] | null {
  const frame = frameFor(points);
  return frame === null ? null : points.map((p) => toLocal(frame, p));
}

function lengthFeet(points: LonLat[]): number | null {
  const local = localRing(points);
  if (local === null || local.length < 2) return null;
  let m = 0;
  for (let i = 1; i < local.length; i++) {
    m += Math.hypot(local[i][0] - local[i - 1][0], local[i][1] - local[i - 1][1]);
  }
  return m * FEET_PER_METRE;
}

export class KmlError extends Error {}

/**
 * Every placemark in the file, in document order.
 *
 * Throws only when the file is not KML at all. A single unreadable placemark
 * among twenty is dropped, because the other nineteen are still worth having
 * and the review screen shows the count either way.
 */
export function parseKml(text: string): KmlShape[] {
  if (text.trim() === "") throw new KmlError("That file is empty.");

  const doc = new DOMParser().parseFromString(text, "application/xml");

  // Browsers report XML failures as a <parsererror> element rather than by
  // throwing, and they do it in a namespace of their own.
  if (descendants(doc, "parsererror").length > 0) {
    throw new KmlError("That file isn't readable as XML. If it's a .kmz, unzip it first — a .kmz is a zipped .kml.");
  }
  if (doc.documentElement === null || doc.documentElement.localName !== "kml") {
    throw new KmlError(
      "That doesn't look like a KML file. Export from Google Earth as KML, or unzip a .kmz and use the .kml inside.",
    );
  }

  const placemarks = descendants(doc, "Placemark");
  if (placemarks.length === 0) {
    throw new KmlError("That KML has no placemarks in it — nothing drawn to import.");
  }

  const shapes: KmlShape[] = [];
  placemarks.forEach((pm, i) => {
    const geometry = geometryOf(pm);
    if (geometry === null) return;

    const named = kids(pm, "name")[0]?.textContent?.trim();
    const { kind, ring } = geometry;

    const geo: GeoJson =
      kind === "polygon"
        ? { type: "Polygon", coordinates: [closed(ring)] }
        : kind === "line"
          ? { type: "LineString", coordinates: ring.map(([lon, lat]) => [lon, lat]) }
          : { type: "Point", coordinates: [ring[0][0], ring[0][1]] };

    const local = kind === "polygon" ? localRing(ring) : null;

    shapes.push({
      id: `s${i}`,
      name: named && named !== "" ? named : `Shape ${i + 1}`,
      kind,
      folder: folderPathOf(pm),
      geo,
      acres: local === null ? null : ringAcres(local),
      lengthFt: kind === "line" ? lengthFeet(ring) : null,
      points: ring,
    });
  });

  if (shapes.length === 0) {
    throw new KmlError("Nothing in that KML has a shape this app can read — no polygons, lines or points.");
  }
  return shapes;
}

// ─── the strip axis ────────────────────────────────────────────────────

/**
 * How far it is across a shape along a given heading, in feet.
 *
 * This is `sweep_length_ft`, and it is not a guess: given a direction, the
 * extent of the drawn shape along it is a measurement. 040 set this by hand
 * for all five units; once the direction is picked here, the drawing answers
 * it. On an irregular unit it is the widest line across rather than a
 * constant, which is the right precision for its only job — telling somebody
 * at the gate roughly how far in the wire sits.
 */
export function sweepLengthFtAlong(shape: KmlShape, headingDeg: number): number | null {
  return shape.kind === "polygon" ? sweepLengthFt(shape.points, headingDeg) : null;
}

export interface LongAxis {
  /** The two headings along it — the same line, walked either way. */
  deg: number;
  oppositeDeg: number;
  lengthFt: number;
}

/**
 * The direction the shape is longest in.
 *
 * A strip-grazed unit is nearly always swept **along** its long axis, so the
 * wire stays short and the strip stays wide — every one of this farm's five
 * is. That much is geometry, and worth saying.
 *
 * **Found as the perpendicular of the narrowest width, not as the widest
 * projection.** Those are not the same thing, and taking the second is a
 * mistake that survives every rectangle you test it on by looking plausible:
 * a 420 × 200 unit projects 438 ft onto its own diagonal, more than the 420
 * along its long side, so the widest projection points across the corner. It
 * reported this farm's east–west units as running north-east to south-west.
 * The narrow direction has no such trap — a shape is narrowest across its
 * short side — and the long axis is square to it.
 *
 * What it deliberately does not do is pick between the two ends of that axis.
 * East-to-west and west-to-east are the same line; which one you walk depends
 * on where the gate is and what the unit before it was, and no amount of
 * looking at the polygon reveals it. So this reports the axis, and the two
 * headings on it, and the choice stays with the farmer.
 */
export function longAxis(shape: KmlShape): LongAxis | null {
  if (shape.kind !== "polygon") return null;
  const local = localRing(shape.points);
  if (local === null) return null;

  // Extent is symmetric about 180°, so half a turn covers every distinct
  // direction. One degree is finer than this could ever need to be.
  let narrowest: { deg: number; span: number } | null = null;
  for (let deg = 0; deg < 180; deg++) {
    const extent = sweepExtent(local, deg);
    if (extent === null) continue;
    const span = extent.max - extent.min;
    if (narrowest === null || span < narrowest.span) narrowest = { deg, span };
  }
  if (narrowest === null) return null;

  const deg = (narrowest.deg + 90) % 180;
  const along = sweepExtent(local, deg);
  if (along === null) return null;

  return {
    deg,
    oppositeDeg: (deg + 180) % 360,
    lengthFt: (along.max - along.min) * FEET_PER_METRE,
  };
}

/** The nearest of the eight, for describing an axis in words. Used only to
 *  *say* which way a shape runs — never to set a heading. */
export function nearestCompassDeg(headingDeg: number): number {
  return (Math.round((((headingDeg % 360) + 360) % 360) / 45) % 8) * 45;
}

// ─── what to do with what was found ────────────────────────────────────

export type Role = "pasture" | "paddock" | "skip";

export interface Proposal {
  shapeId: string;
  role: Role;
  /** Why, in words, for the review screen to show beside the choice. */
  because: string;
}

/**
 * A first guess at which shape is what.
 *
 * The rule is containment, and only containment: the largest polygon is
 * offered as the pasture, and any polygon whose centre falls inside it is
 * offered as a paddock of it. That is exactly how this farm's own file is
 * drawn — a perimeter with the fenced regions inside — and it is the only
 * structure a KML reliably carries.
 *
 * Everything else is proposed as skipped. A fence line is real and worth
 * drawing one day, but there is nowhere to put a LineString today, and
 * offering to import one would be offering something that does nothing.
 *
 * A guess, not a determination. The screen shows it as pre-selected choices
 * with the reason attached, and every one can be overruled.
 */
export function proposeGround(shapes: KmlShape[]): Proposal[] {
  const polygons = shapes.filter((s) => s.kind === "polygon" && s.acres !== null);

  if (polygons.length === 0) {
    return shapes.map((s) => ({
      shapeId: s.id,
      role: "skip" as Role,
      because: s.kind === "line" ? "a line, not an area" : "a marker, not an area",
    }));
  }

  const biggest = polygons.reduce((a, b) => ((a.acres ?? 0) >= (b.acres ?? 0) ? a : b));

  // One polygon and nothing else: it is the piece of land, not a subdivision
  // of anything, so there is nothing to be a paddock.
  const frame = frameFor(biggest.points);
  const outer =
    frame === null ? null : (biggest.points.map((p) => toLocal(frame, p)) as [number, number][]);

  return shapes.map((s) => {
    if (s.id === biggest.id) {
      return { shapeId: s.id, role: "pasture", because: "the largest area drawn" };
    }
    if (s.kind !== "polygon" || s.acres === null) {
      return {
        shapeId: s.id,
        role: "skip",
        because: s.kind === "line" ? "a line, not an area" : "a marker, not an area",
      };
    }
    if (outer === null || frame === null) {
      return { shapeId: s.id, role: "paddock", because: "an area inside the file" };
    }
    const centre = ringCentre(s.points.map((p) => toLocal(frame, p)) as [number, number][]);
    const inside = ringEncloses(outer, centre[0], centre[1]);
    return inside
      ? { shapeId: s.id, role: "paddock", because: `inside ${biggest.name}` }
      : { shapeId: s.id, role: "skip", because: `outside ${biggest.name}` };
  });
}

// ─── paddocks from the fences ──────────────────────────────────────────

/**
 * The regions a pasture is divided into, as shapes the review can carry.
 *
 * A farm is drawn the way it is built — an outline with fences across it —
 * so a file that plainly describes five paddocks arrives as one polygon and
 * four lines. `splitByFences` turns those into areas; this dresses them as
 * ordinary shapes so the rest of the screen cannot tell the difference. They
 * are named, numbered, given a strip direction and imported exactly like a
 * polygon somebody drew by hand.
 *
 * Numbered largest first, which is the order `splitByFences` returns and has
 * nothing to do with the round — the rotation is asked for separately,
 * because which paddock you graze first is not a fact about its size.
 */
export function regionsAsShapes(pastureName: string, regions: Region[]): KmlShape[] {
  return regions.map((r, i) => ({
    id: `region-${i}`,
    name: `${pastureName} ${i + 1}`,
    kind: "polygon" as const,
    folder: `divided from ${pastureName}`,
    geo: { type: "Polygon" as const, coordinates: [r.ring.map(([lon, lat]) => [lon, lat])] },
    acres: r.acres,
    lengthFt: null,
    points: r.ring,
  }));
}

// ─── turning the confirmed choices into a payload ──────────────────────

export interface ImportRow {
  shape: KmlShape;
  role: Role;
  name: string;
  /** Only meaningful on paddocks: their place in the round. */
  rotationOrder: number | null;
  /** Which way the wire advances across it, or null for taken whole. Asked
   *  on the review rather than left for afterwards: without it the unit
   *  draws on the map but has no wire, and its strip acreage falls back to a
   *  flat fraction of the whole. */
  sweepHeadingDeg: number | null;
}

export interface ImportPayload {
  pasture: {
    id: string | null;
    name: string;
    code: string | null;
    acres: number | null;
    notes: string | null;
    boundary: GeoJson | null;
  };
  paddocks: {
    name: string;
    acresMeasured: number | null;
    acresGrazable: number | null;
    sweepHeadingDeg: number | null;
    sweepLengthFt: number | null;
    rotationOrder: number | null;
    boundary: GeoJson;
  }[];
}

/** Acres are rounded to the thousandth. The projection is good to well under
 *  a hundredth of an acre at farm scale, and a boundary that reads
 *  `2.0030000000000001` looks like a machine rather than a measurement. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * What the review screen sends.
 *
 * **`acresGrazable` is deliberately left null.** A drawn outline includes the
 * pond, the rock and the shade; what the herd can eat off is a judgement, and
 * the app already falls back to measured acres wherever grazable is missing.
 * Filling it in from the drawing would be the app asserting something it
 * cannot see.
 *
 * **The sweep heading comes from the review, and `sweepLengthFt` follows from
 * it.** The direction is a decision somebody makes; how far it is across the
 * shape in that direction is then a measurement, so it is taken off the
 * drawing rather than asked for twice.
 */
export function toPayload(input: {
  rows: ImportRow[];
  /** Set when importing into land already on file; the pasture row is then
   *  ignored except for its boundary. */
  existingPastureId: string | null;
  pastureName: string;
}): ImportPayload | { error: string } {
  const pasture = input.rows.find((r) => r.role === "pasture") ?? null;
  const paddocks = input.rows.filter((r) => r.role === "paddock");

  if (input.existingPastureId === null && pasture === null) {
    return { error: "Pick which shape is the pasture, or import into one already on file." };
  }
  if (paddocks.length === 0 && pasture === null) {
    return { error: "Nothing is marked to import." };
  }

  // What was typed wins; the file's name for the shape is only the default
  // that box was filled with. Falling back to the shape here rather than
  // letting the caller patch the result afterwards, which is how the typed
  // name got dropped by anything that did not know to re-apply it.
  const typed = input.pastureName.trim();
  const named = typed !== "" ? typed : (pasture?.name.trim() ?? "");
  if (input.existingPastureId === null && named === "") {
    return { error: "The pasture needs a name." };
  }

  const blank = paddocks.find((p) => p.name.trim() === "");
  if (blank !== undefined) {
    return { error: `One of the paddocks has no name — the file called it "${blank.shape.name}".` };
  }

  // Ground has to be an area. A paddock's boundary is read by
  // `asPolygonRing`, which returns null for anything else, so a line saved as
  // a paddock draws on no map, measures no acres and cuts no strips — it just
  // quietly stops existing. One farm was set up with three fence lines as its
  // paddocks before this was here.
  const notAnArea = [...(pasture === null ? [] : [pasture]), ...paddocks].find(
    (r) => r.shape.kind !== "polygon",
  );
  if (notAnArea !== undefined) {
    const what = notAnArea.shape.kind === "line" ? "a line" : "a marker";
    return {
      error: `"${notAnArea.shape.name}" is ${what}, not an area, so it cannot be ground. Fences and gates have to be left out for now.`,
    };
  }

  // Named as first spelled, not as second: "Two paddocks are both called
  // north strip" when the farmer typed "North strip" reads like the app
  // inventing a name.
  const seen = new Map<string, string>();
  for (const p of paddocks) {
    const key = p.name.trim().toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) return { error: `Two paddocks are both called ${first}.` };
    seen.set(key, p.name.trim());
  }

  return {
    pasture: {
      id: input.existingPastureId,
      name: named,
      code: null,
      acres: pasture?.shape.acres != null ? round3(pasture.shape.acres) : null,
      notes: null,
      boundary: pasture?.shape.geo ?? null,
    },
    paddocks: paddocks.map((p) => {
      const across =
        p.sweepHeadingDeg === null ? null : sweepLengthFtAlong(p.shape, p.sweepHeadingDeg);
      return {
        name: p.name.trim(),
        acresMeasured: p.shape.acres === null ? null : round3(p.shape.acres),
        acresGrazable: null,
        sweepHeadingDeg: p.sweepHeadingDeg,
        // Whole feet: it is a bounding extent used to say "the wire is about
        // 120 ft in", and a decimal on it would claim a precision the shape
        // does not have.
        sweepLengthFt: across === null ? null : Math.round(across),
        rotationOrder: p.rotationOrder,
        boundary: p.shape.geo,
      };
    }),
  };
}
