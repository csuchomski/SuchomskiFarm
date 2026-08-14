import { describe, expect, it } from "vitest";
import { viewBoxPoint } from "./pasture-map";

/**
 * A finger on a drawing that does not fill its box.
 *
 * The map used to be sized by its own proportions, so screen and viewBox were
 * the same shape and a plain ratio worked. It is capped now — the farm is a
 * tall shape and a full-height drawing pushed the acres off the bottom of the
 * screen — which means the drawing is letterboxed, and every touch has to
 * have the gutters taken off it first. Nothing about the wire looks wrong
 * when this is missed; it just lands somewhere else.
 */

const box = (width: number, height: number, left = 0, top = 0) => ({ left, top, width, height });

describe("a point on the drawing", () => {
  it("is a plain scale when the box is the viewBox's shape", () => {
    const p = viewBoxPoint({
      clientX: 100, clientY: 50, rect: box(400, 200), viewBoxWidth: 800, viewBoxHeight: 400,
    });
    expect(p).toEqual([200, 100]);
  });

  it("takes the side gutters off a box wider than the drawing", () => {
    // 800×400 of viewBox into a 1000×400 box: scale 1, 100px of gutter a side.
    const p = viewBoxPoint({
      clientX: 100, clientY: 0, rect: box(1000, 400), viewBoxWidth: 800, viewBoxHeight: 400,
    })!;
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
  });

  it("takes the top and bottom gutters off a box taller than the drawing", () => {
    // 400×800 of viewBox into a 400×1000 box: scale 1, 100px above and below.
    const p = viewBoxPoint({
      clientX: 0, clientY: 100, rect: box(400, 1000), viewBoxWidth: 400, viewBoxHeight: 800,
    })!;
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
  });

  it("puts the centre of the box at the centre of the drawing, whatever the shape", () => {
    for (const rect of [box(1000, 400), box(400, 1000), box(377, 611), box(1200, 90)]) {
      const p = viewBoxPoint({
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        rect, viewBoxWidth: 800, viewBoxHeight: 400,
      })!;
      expect(p[0]).toBeCloseTo(400, 6);
      expect(p[1]).toBeCloseTo(200, 6);
    }
  });

  it("counts from the box, not from the corner of the window", () => {
    const p = viewBoxPoint({
      clientX: 340, clientY: 130, rect: box(400, 200, 240, 80),
      viewBoxWidth: 800, viewBoxHeight: 400,
    });
    expect(p).toEqual([200, 100]);
  });

  it("reads outside the drawing as outside it, rather than clamping", () => {
    // Above the top gutter of a letterboxed drawing: negative, and the caller
    // decides what that means. Clamping here would put a touch on the paper
    // margin at the top of the paddock.
    const p = viewBoxPoint({
      clientX: 0, clientY: 10, rect: box(400, 1000), viewBoxWidth: 400, viewBoxHeight: 800,
    })!;
    expect(p[1]).toBeLessThan(0);
  });

  it("has nothing to say about a box with no size", () => {
    expect(viewBoxPoint({
      clientX: 0, clientY: 0, rect: box(0, 0), viewBoxWidth: 800, viewBoxHeight: 400,
    })).toBeNull();
    expect(viewBoxPoint({
      clientX: 0, clientY: 0, rect: box(400, 200), viewBoxWidth: 0, viewBoxHeight: 400,
    })).toBeNull();
  });
});
