import { useCallback, useState } from "react";

/**
 * How many viewBox units go to a screen pixel on a drawn map.
 *
 * Text and stroke widths inside an SVG are in viewBox units, and these maps
 * are fitted to the farm's own proportions — so a label's size on screen
 * depends on how the farm happens to fit the space it is given. Left alone,
 * the paddock names come out at nine pixels on a desktop and twenty-seven on
 * a tablet, and a strip's number at four on a phone.
 *
 * The ratio is measured rather than assumed, and handed to the stylesheet as
 * `--pm-unit` so a rule can multiply it back out:
 *
 *     font-size: calc(11px * var(--pm-unit, 1));
 *
 * `px` there is a unit in the SVG's own coordinate space, so the result is a
 * label that renders at eleven real pixels at every width. A bare number would
 * not do — `calc(11 * var(...))` is a number, not a length, and the
 * declaration is dropped.
 *
 * Returns a ref callback, so it re-measures whenever the element changes as
 * well as whenever it resizes.
 */
export function useMapScale(): [number, (el: SVGSVGElement | null) => void] {
  const [unitPx, setUnitPx] = useState(1);

  const measure = useCallback((el: SVGSVGElement | null) => {
    if (el === null) return;
    const read = () => {
      const box = el.getBoundingClientRect();
      const vb = el.viewBox?.baseVal;
      if (box.height <= 0 || !vb || vb.width <= 0 || vb.height <= 0) return;
      // `meet` fits the drawing inside the box, so the smaller ratio wins.
      const scale = Math.min(box.width / vb.width, box.height / vb.height);
      if (scale > 0) setUnitPx(1 / scale);
    };
    read();
    // jsdom has no ResizeObserver, and there is nothing to observe there.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [unitPx, measure];
}
