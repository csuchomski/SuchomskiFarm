// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { KmlError, parseCoordinates, parseKml, proposeGround, toPayload, type ImportRow } from "./kml";

/**
 * Reading a drawn file.
 *
 * The coordinates below are this farm's own, taken from migration 044 — the
 * perimeter the owner drew in Google Earth and the five units inside it. That
 * is what makes the acreage assertions worth anything: 044 measured those
 * five with an independent script at 2.021, 1.932, 1.972, 2.261 and 1.381
 * acres, summing to 9.567. If this parser reproduces all five *and* measures
 * the perimeter at their sum, it is doing the same arithmetic on the same
 * ground — which is the whole claim being made for it.
 */

/** The perimeter fence from 044 — the outline the owner actually drew. */
const PERIMETER =
  "-88.41415661611339,42.87671228695303 -88.41373100023101,42.87662756783331 " +
  "-88.41317476329905,42.87653120431429 -88.41306449314374,42.87688276322167 " +
  "-88.4130796058033,42.87719421074982 -88.41269055798223,42.8771968409059 " +
  "-88.41299683267957,42.87876086983165 -88.41331172623335,42.87882225600689 " +
  "-88.4141242802737,42.87883078164459 -88.41463921817487,42.87873318343745 " +
  "-88.41489765718502,42.87874083885301 -88.41495831448356,42.87686517881129 " +
  "-88.41415661611339,42.87671228695303";

/** Paddock 1: 2.021 acres by migration 044. */
const PADDOCK_1 =
  "-88.41291314,42.87833348 -88.41299683,42.87876087 -88.41331173,42.87882226 " +
  "-88.41412428,42.87883078 -88.41463922,42.87873318 -88.41489766,42.87874084 " +
  "-88.41491083,42.87833348 -88.41291314,42.87833348";

/** Paddock 2: 1.932 acres by migration 044. */
const PADDOCK_2 =
  "-88.41335974,42.87778163 -88.41335974,42.87833348 -88.41491083,42.87833348 " +
  "-88.41492868,42.87778163 -88.41335974,42.87778163";

/** Paddock 3: 1.972 acres by migration 044. */
const PADDOCK_3 =
  "-88.41335974,42.87722457 -88.41335974,42.87778163 -88.41492868,42.87778163 " +
  "-88.41494669,42.87722457 -88.41335974,42.87722457";

/** Paddock 4: 2.261 acres by migration 044. */
const PADDOCK_4 =
  "-88.41415662,42.87671229 -88.413731,42.87662757 -88.41317476,42.8765312 " +
  "-88.41306449,42.87688276 -88.41307961,42.87719421 -88.41269056,42.87719684 " +
  "-88.41269599,42.87722457 -88.41494669,42.87722457 -88.41495831,42.87686518 " +
  "-88.41415662,42.87671229";

/** Paddock 5: 1.381 acres by migration 044. */
const PADDOCK_5 =
  "-88.41335974,42.87722457 -88.41269599,42.87722457 -88.41291314,42.87833348 " +
  "-88.41335974,42.87833348 -88.41335974,42.87722457";

/** A polygon a mile away, for the containment test. */
const ELSEWHERE =
  "-88.40000000,42.90000000 -88.40100000,42.90000000 -88.40100000,42.90100000 " +
  "-88.40000000,42.90100000 -88.40000000,42.90000000";

const FENCE = "-88.41335974,42.87833348 -88.41490975,42.87833348";

const kml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Suchomski Farm</name>
${body}
</Document></kml>`;

const polygon = (name: string, coords: string) =>
  `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing>
     <coordinates>${coords}</coordinates>
   </LinearRing></outerBoundaryIs></Polygon></Placemark>`;

const line = (name: string, coords: string) =>
  `<Placemark><name>${name}</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark>`;

const point = (name: string, coords: string) =>
  `<Placemark><name>${name}</name><Point><coordinates>${coords}</coordinates></Point></Placemark>`;

const FARM = kml(
  [
    polygon("Farm perimeter", PERIMETER),
    polygon("Paddock 1", PADDOCK_1),
    polygon("Paddock 2", PADDOCK_2),
    polygon("Paddock 3", PADDOCK_3),
    polygon("Paddock 4", PADDOCK_4),
    polygon("Paddock 5", PADDOCK_5),
    line("Interior fence", FENCE),
    point("Water tank", "-88.4140,42.8780"),
  ].join("\n"),
);

/** What 044 recorded for each, measured by an independent script. */
const KNOWN: Record<string, number> = {
  "Paddock 1": 2.021, "Paddock 2": 1.932, "Paddock 3": 1.972,
  "Paddock 4": 2.261, "Paddock 5": 1.381,
};

describe("reading the coordinates", () => {
  it("takes lon,lat and drops the altitude", () => {
    expect(parseCoordinates("-88.4129,42.8783,0 -88.4130,42.8787,0")).toEqual([
      [-88.4129, 42.8783],
      [-88.413, 42.8787],
    ]);
  });

  it("does not care how the exporter spaced them", () => {
    const spread = parseCoordinates("\n   -88.4129,42.8783\n   -88.4130,42.8787\n  ");
    expect(spread).toEqual([
      [-88.4129, 42.8783],
      [-88.413, 42.8787],
    ]);
  });

  it("refuses a malformed tuple rather than skipping it", () => {
    // Half a boundary still draws, and it draws something that is not the
    // field. Better to have none of it.
    expect(parseCoordinates("-88.4129,42.8783 rubbish -88.4130,42.8787")).toBeNull();
    expect(parseCoordinates("-88.4129")).toBeNull();
  });
});

describe("what comes out of a file", () => {
  it("finds every placemark and says what kind each is", () => {
    const shapes = parseKml(FARM);
    expect(shapes.map((s) => [s.name, s.kind])).toEqual([
      ["Farm perimeter", "polygon"],
      ["Paddock 1", "polygon"],
      ["Paddock 2", "polygon"],
      ["Paddock 3", "polygon"],
      ["Paddock 4", "polygon"],
      ["Paddock 5", "polygon"],
      ["Interior fence", "line"],
      ["Water tank", "point"],
    ]);
  });

  it("measures every unit the way migration 044 measured this farm", () => {
    for (const s of parseKml(FARM)) {
      const known = KNOWN[s.name];
      if (known === undefined) continue;
      expect(`${s.name} ${s.acres?.toFixed(3)}`).toBe(`${s.name} ${known.toFixed(3)}`);
    }
  });

  it("measures the perimeter at what its five units come to", () => {
    // 040's finding, reproduced: the interior fences divide the whole with
    // nothing left over. A parser that had the projection wrong would still
    // be self-consistent here, which is why the figures above are pinned to
    // 044 as well — this checks the shapes, those check the arithmetic.
    const shapes = parseKml(FARM);
    const perimeter = shapes.find((s) => s.name === "Farm perimeter")!;
    const units = Object.values(KNOWN).reduce((a, b) => a + b, 0);
    expect(perimeter.acres).toBeCloseTo(units, 1);
  });

  it("measures a line in feet and leaves it no acres", () => {
    const fence = parseKml(FARM).find((s) => s.name === "Interior fence")!;
    expect(fence.acres).toBeNull();
    // 040 recorded Paddock 2's sweep as 419 ft across; this is that fence.
    expect(fence.lengthFt).toBeGreaterThan(400);
    expect(fence.lengthFt).toBeLessThan(430);
  });

  it("closes a ring the file left open", () => {
    const open = kml(polygon("Open", "-88.4129,42.8783 -88.4149,42.8783 -88.4149,42.8772"));
    const [shape] = parseKml(open);
    const ring = (shape.geo as { coordinates: number[][][] }).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("takes a polygon's outer ring, not a hole in it", () => {
    const holed = kml(
      `<Placemark><name>Holed</name><Polygon>
         <outerBoundaryIs><LinearRing><coordinates>${PERIMETER}</coordinates></LinearRing></outerBoundaryIs>
         <innerBoundaryIs><LinearRing><coordinates>${ELSEWHERE}</coordinates></LinearRing></innerBoundaryIs>
       </Polygon></Placemark>`,
    );
    // Taking any <coordinates> under the Polygon would draw the hole as the
    // field — a fifth of an acre where nine and a half belong.
    expect(parseKml(holed)[0].acres).toBeCloseTo(9.567, 1);
  });

  it("reads a file with no namespace on it", () => {
    const bare = `<kml><Document>${polygon("Bare", PADDOCK_1)}</Document></kml>`;
    expect(parseKml(bare)[0].acres).toBeCloseTo(2.021, 2);
  });

  it("reads a file that prefixes every tag", () => {
    const prefixed =
      `<k:kml xmlns:k="http://www.opengis.net/kml/2.2"><k:Document>` +
      `<k:Placemark><k:name>Prefixed</k:name><k:Polygon><k:outerBoundaryIs><k:LinearRing>` +
      `<k:coordinates>${PADDOCK_1}</k:coordinates>` +
      `</k:LinearRing></k:outerBoundaryIs></k:Polygon></k:Placemark></k:Document></k:kml>`;
    const [shape] = parseKml(prefixed);
    expect(shape.name).toBe("Prefixed");
    expect(shape.acres).toBeCloseTo(2.021, 2);
  });

  it("keeps the folder a shape sat in, so two blank names are tellable apart", () => {
    const foldered = kml(
      `<Folder><name>North block</name>${polygon("", PADDOCK_1)}</Folder>` +
        `<Folder><name>South block</name>${polygon("", PADDOCK_2)}</Folder>`,
    );
    const shapes = parseKml(foldered);
    expect(shapes.map((s) => s.folder)).toEqual([
      "Suchomski Farm › North block",
      "Suchomski Farm › South block",
    ]);
    // and an unnamed shape is numbered rather than left blank
    expect(shapes.map((s) => s.name)).toEqual(["Shape 1", "Shape 2"]);
  });

  it("drops one unreadable placemark and keeps the rest", () => {
    const mixed = kml(
      polygon("Good", PADDOCK_1) +
        `<Placemark><name>Broken</name><Polygon><outerBoundaryIs><LinearRing>
           <coordinates>not coordinates at all</coordinates>
         </LinearRing></outerBoundaryIs></Polygon></Placemark>` +
        polygon("Also good", PADDOCK_2),
    );
    expect(parseKml(mixed).map((s) => s.name)).toEqual(["Good", "Also good"]);
  });
});

describe("when the file is not what was expected", () => {
  it("says so for something that is not XML", () => {
    expect(() => parseKml("this is a spreadsheet, honestly")).toThrow(KmlError);
  });

  it("names the .kmz problem, because that is the mistake people make", () => {
    // A .kmz is a zip: its first bytes are PK, which is not XML.
    expect(() => parseKml("PK\x03\x04\x00rubbish")).toThrow(/kmz/i);
  });

  it("says so for XML that is not KML", () => {
    expect(() => parseKml("<gpx><trk/></gpx>")).toThrow(/KML/);
  });

  it("says so for a KML with nothing drawn in it", () => {
    expect(() => parseKml(kml("<Folder><name>Empty</name></Folder>"))).toThrow(/no placemarks/);
  });

  it("says so for an empty file", () => {
    expect(() => parseKml("   ")).toThrow(/empty/);
  });
});

describe("guessing what is what", () => {
  it("offers the largest area as the pasture and what is inside it as paddocks", () => {
    const shapes = parseKml(FARM);
    const proposal = proposeGround(shapes);
    expect(proposal.map((p) => [shapes.find((s) => s.id === p.shapeId)!.name, p.role])).toEqual([
      ["Farm perimeter", "pasture"],
      ["Paddock 1", "paddock"],
      ["Paddock 2", "paddock"],
      ["Paddock 3", "paddock"],
      ["Paddock 4", "paddock"],
      ["Paddock 5", "paddock"],
      ["Interior fence", "skip"],
      ["Water tank", "skip"],
    ]);
  });

  it("says why, so the guess can be judged rather than trusted", () => {
    const shapes = parseKml(FARM);
    const proposal = proposeGround(shapes);
    expect(proposal[0].because).toBe("the largest area drawn");
    expect(proposal[1].because).toBe("inside Farm perimeter");
    expect(proposal.find((p) => p.shapeId === shapes.find((s) => s.name === "Interior fence")!.id)!.because)
      .toBe("a line, not an area");
  });

  it("does not adopt a polygon that is somewhere else entirely", () => {
    const shapes = parseKml(
      kml(polygon("Perimeter", PERIMETER) + polygon("Neighbour's field", ELSEWHERE)),
    );
    const proposal = proposeGround(shapes);
    expect(proposal[1].role).toBe("skip");
    expect(proposal[1].because).toBe("outside Perimeter");
  });

  it("calls a lone polygon the pasture, since there is nothing for it to subdivide", () => {
    const proposal = proposeGround(parseKml(kml(polygon("Home place", PERIMETER))));
    expect(proposal).toHaveLength(1);
    expect(proposal[0].role).toBe("pasture");
  });

  it("proposes nothing when the file is all lines and markers", () => {
    const proposal = proposeGround(parseKml(kml(line("Fence", FENCE) + point("Gate", "-88.414,42.878"))));
    expect(proposal.every((p) => p.role === "skip")).toBe(true);
  });
});

describe("what gets sent", () => {
  const rowsFor = (over: Partial<ImportRow>[] = []): ImportRow[] => {
    const shapes = parseKml(FARM);
    const proposal = proposeGround(shapes);
    return shapes.map((s, i) => ({
      shape: s,
      role: proposal[i].role,
      name: s.name,
      rotationOrder: null,
      ...over[i],
    }));
  };

  it("sends the pasture with its boundary and measured acres", () => {
    const out = toPayload({ rows: rowsFor(), existingPastureId: null, pastureName: "" });
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.pasture.name).toBe("Farm perimeter");
    expect(out.pasture.acres).toBeCloseTo(9.567, 1);
    expect(out.pasture.boundary).toMatchObject({ type: "Polygon" });
  });

  it("sends each paddock's acres as measured, and leaves grazable unsaid", () => {
    const out = toPayload({ rows: rowsFor(), existingPastureId: null, pastureName: "" });
    if ("error" in out) throw new Error(out.error);
    expect(out.paddocks).toHaveLength(5);
    expect(out.paddocks[0].acresMeasured).toBeCloseTo(2.021, 2);
    // A drawn outline includes the pond and the shade. What the herd can eat
    // off is a judgement the drawing cannot make.
    expect(out.paddocks[0].acresGrazable).toBeNull();
  });

  it("guesses no sweep heading, because that is how the farm is walked", () => {
    const out = toPayload({ rows: rowsFor(), existingPastureId: null, pastureName: "" });
    if ("error" in out) throw new Error(out.error);
    expect(out.paddocks.every((p) => p.sweepHeadingDeg === null)).toBe(true);
  });

  it("rounds acres to the thousandth rather than shipping float noise", () => {
    const out = toPayload({ rows: rowsFor(), existingPastureId: null, pastureName: "" });
    if ("error" in out) throw new Error(out.error);
    for (const p of out.paddocks) {
      expect(String(p.acresMeasured).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
    }
  });

  it("carries the rotation numbers that were typed", () => {
    const rows = rowsFor([{}, { rotationOrder: 1 }, { rotationOrder: 2 }]);
    const out = toPayload({ rows, existingPastureId: null, pastureName: "" });
    if ("error" in out) throw new Error(out.error);
    expect(out.paddocks.map((p) => p.rotationOrder)).toEqual([1, 2, null, null, null]);
  });

  it("imports into land already on file without needing a pasture shape", () => {
    const rows = rowsFor().map((r) => (r.role === "pasture" ? { ...r, role: "skip" as const } : r));
    const out = toPayload({ rows, existingPastureId: "home", pastureName: "Home place" });
    if ("error" in out) throw new Error(out.error);
    expect(out.pasture.id).toBe("home");
    expect(out.paddocks).toHaveLength(5);
  });

  it("will not send an import with no pasture at either end", () => {
    const rows = rowsFor().map((r) => (r.role === "pasture" ? { ...r, role: "skip" as const } : r));
    const out = toPayload({ rows, existingPastureId: null, pastureName: "" });
    expect(out).toEqual({ error: "Pick which shape is the pasture, or import into one already on file." });
  });

  it("catches a blank paddock name here rather than at the database", () => {
    const rows = rowsFor([{}, { name: "  " }]);
    const out = toPayload({ rows, existingPastureId: null, pastureName: "" });
    expect("error" in out && out.error).toContain("Paddock 1");
  });

  it("catches two paddocks with the same name before the whole import is refused", () => {
    // The server would take the lot or none of it, so the message would arrive
    // after the round trip and after the farmer had stopped watching.
    const rows = rowsFor([{}, { name: "Same" }, { name: "same" }]);
    const out = toPayload({ rows, existingPastureId: null, pastureName: "" });
    expect("error" in out && out.error).toContain("Two paddocks are both called Same");
  });
});
