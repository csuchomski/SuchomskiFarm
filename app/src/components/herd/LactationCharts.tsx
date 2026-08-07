import { useMemo, useState } from "react";
import { Callout } from "../ui";
import {
  animalsWithCurves,
  compareWithPrevious,
  scaleTo100,
  type LactationSummary,
  type ProductionRecord,
} from "../../lib/lactation-curve";
import type { RealLactation } from "../../lib/lactations";
import type { RealAnimal } from "../../lib/herd";
import "./lactation-charts.css";

/**
 * Two charts, answering two different questions.
 *
 * The curve is the shape of one lactation against the one before it, aligned
 * on days-in-milk — a cow whose peak is lower than last time, or who falls
 * away faster, shows up here and nowhere else.
 *
 * The comparison below is one bar per lactation: total yield side by side,
 * which is the "is she getting better or worse" question.
 *
 * Both are drawn as bars from divs rather than a chart library. The data is
 * a few dozen points and the design system is hairlines and flat blocks; a
 * charting dependency would be more code, not less.
 */

const nameOf = (a: RealAnimal | undefined, id: string) => a?.barn_name || (a ? `Tag ${a.ear_tag}` : id.slice(0, 6));

/** Stable reference for "this cow has no lactations", so the memos below
 * aren't invalidated by a fresh empty literal every render. */
const EMPTY: LactationSummary[] = [];

export function LactationCharts({
  lactations,
  records,
  animals,
  todayIso,
  unit = "gal",
}: {
  lactations: RealLactation[];
  records: ProductionRecord[];
  animals: RealAnimal[];
  todayIso: string;
  unit?: string;
}) {
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals]);
  const cows = useMemo(
    () => animalsWithCurves(lactations, records, todayIso),
    [lactations, records, todayIso],
  );

  const [animalId, setAnimalId] = useState<string | null>(null);
  const cow = cows.find((c) => c.animalId === animalId) ?? cows[0] ?? null;

  // Her most recent lactation is the one you want on opening the page.
  const [lactationId, setLactationId] = useState<string | null>(null);
  // Memoised: `cow?.lactations ?? []` builds a fresh array literal on every
  // render when no cow is selected, which defeats the yield memo below.
  const cowLactations = useMemo(() => cow?.lactations ?? EMPTY, [cow]);
  const chosen =
    cowLactations.find((l) => l.lactationId === lactationId) ?? cowLactations[cowLactations.length - 1] ?? null;

  const comparison = useMemo(() => {
    if (!chosen) return null;
    const lactation = lactations.find((l) => l.id === chosen.lactationId);
    if (!lactation) return null;
    return compareWithPrevious(lactation, lactations, records, todayIso);
  }, [chosen, lactations, records, todayIso]);

  // Yield comparison, on one shared scale so the bars mean something
  // against each other.
  const yieldHeights = useMemo(
    () => scaleTo100([cowLactations.map((l) => l.total)])[0] ?? [],
    [cowLactations],
  );

  if (cows.length === 0) {
    return (
      <Callout>
        No milk has been recorded against a lactation yet, so there's no curve to draw. Record milkings and each
        cow's curve builds itself.
      </Callout>
    );
  }

  return (
    <div className="lac-charts">
      {cows.length > 1 && (
        <div className="lac-charts__cows">
          {cows.map((c) => (
            <button
              key={c.animalId}
              type="button"
              className={`report-chip ${cow?.animalId === c.animalId ? "report-chip--active" : ""}`}
              onClick={() => {
                setAnimalId(c.animalId);
                setLactationId(null);
              }}
            >
              {nameOf(byId.get(c.animalId), c.animalId)}
            </button>
          ))}
        </div>
      )}

      {/* ── the curve ── */}
      {comparison && chosen && (
        <div className="lac-panel">
          <div className="lac-panel__head">
            <div>
              <div className="serif lac-panel__title">
                Lactation {chosen.number}
                {chosen.open && <span className="lac-panel__open"> · still milking</span>}
              </div>
              <div className="lac-panel__sub">
                Fresh {chosen.freshDate} · {chosen.days} days · {chosen.total} {unit}
                {chosen.peak !== null && ` · peak ${chosen.peak} at ${chosen.peakDim}d`}
              </div>
            </div>
            {cowLactations.length > 1 && (
              <div className="lac-charts__cows">
                {cowLactations.map((l) => (
                  <button
                    key={l.lactationId}
                    type="button"
                    className={`report-chip ${chosen.lactationId === l.lactationId ? "report-chip--active" : ""}`}
                    onClick={() => setLactationId(l.lactationId)}
                  >
                    №{l.number}
                  </button>
                ))}
              </div>
            )}
          </div>

          {comparison.bins.length === 0 ? (
            <p className="lac-panel__empty">No milk recorded in this lactation yet.</p>
          ) : (
            <>
              <div className="lac-curve" role="img" aria-label={`Weekly milk for lactation ${chosen.number}`}>
                {comparison.bins.map((bin, i) => (
                  <div className="lac-curve__col" key={bin.from} title={`Week ${i + 1}: ${bin.current} ${unit}`}>
                    <div className="lac-curve__stack">
                      {comparison.previous && (
                        <div
                          className="lac-curve__bar lac-curve__bar--prior"
                          style={{ height: `${comparison.heights[i].previous}%` }}
                        />
                      )}
                      <div
                        className="lac-curve__bar lac-curve__bar--current"
                        style={{ height: `${Math.max(comparison.heights[i].current, bin.current > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="lac-curve__axis">
                <span>week 1</span>
                <span>
                  {comparison.bins.length} week{comparison.bins.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="lac-legend">
                <span className="lac-legend__item">
                  <span className="lac-legend__swatch lac-legend__swatch--current" />
                  Lactation {chosen.number}
                </span>
                {comparison.previous ? (
                  <span className="lac-legend__item">
                    <span className="lac-legend__swatch lac-legend__swatch--prior" />
                    Lactation {comparison.previous.number} ({comparison.previous.total} {unit})
                  </span>
                ) : (
                  <span className="lac-legend__item lac-legend__item--muted">
                    Her first lactation — nothing to compare against yet
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── yield per lactation ── */}
      {cowLactations.length > 0 && (
        <div className="lac-panel">
          <div className="serif lac-panel__title" style={{ marginBottom: 4 }}>
            Yield by lactation
          </div>
          <div className="lac-panel__sub" style={{ marginBottom: 16 }}>
            {cowLactations.length === 1
              ? "One lactation on record. A second will make this a comparison."
              : `${cowLactations.length} lactations, on one scale.`}
          </div>

          <div className="lac-yield">
            {cowLactations.map((l, i) => (
              <div className="lac-yield__row" key={l.lactationId}>
                <span className="lac-yield__label mono">№{l.number}</span>
                <div className="lac-yield__track">
                  <div
                    className={`lac-yield__fill ${l.open ? "lac-yield__fill--open" : ""}`}
                    style={{ width: `${Math.max(yieldHeights[i] ?? 0, l.total > 0 ? 1 : 0)}%` }}
                  />
                </div>
                <span className="lac-yield__value mono">
                  {l.total} {unit}
                </span>
                <span className="lac-yield__meta">
                  {l.days}d{l.peak !== null && ` · peak ${l.peak}`}
                </span>
              </div>
            ))}
          </div>

          {cowLactations.some((l) => l.open) && (
            <p className="lac-panel__note">
              A lactation still in progress is shorter than the finished ones by definition — its bar is a total so
              far, not a final figure.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
