import { intakePerAcre, type ForageAssumptions } from "../../lib/grazing";

/**
 * Where "days of feed" came from, in the farmer's own figures.
 *
 * The tile is one number with five decisions behind it, and until you can see
 * them there is no way to tell a strip that is genuinely two days' grazing
 * from one built on this app's fallbacks.
 *
 * **Every line is recomputed from the same helper the tile uses** —
 * `intakePerAcre` — rather than re-derived here. A working that can disagree
 * with the figure it explains is worse than no working.
 *
 * It reads as the two questions a grazier actually asks. What came off the
 * acre, which the heights answer; and how much of that reached an animal,
 * which is utilization. The middle line is printed even though nobody asked
 * for it: without it the sum does not tie out, and a reader who checks the
 * arithmetic and finds it wrong stops trusting the whole page.
 */
export function DaysOfFeedWorking({
  assumptions,
  acres,
  headCount,
  avgWeightLb,
  hoursOfFeed,
}: {
  assumptions: ForageAssumptions;
  acres: number;
  headCount: number | null;
  avgWeightLb: number | null;
  hoursOfFeed: number | null;
}) {
  const a = assumptions;
  const perAcreEaten = intakePerAcre(a);
  const takeDownPerAcre = a.standingLbDmPerAcre * (a.takeDownPct / 100);
  const onOffer = acres * perAcreEaten;
  const totalLb = headCount !== null && avgWeightLb !== null ? headCount * avgWeightLb : null;
  const daily = totalLb === null ? null : totalLb * (a.intakePctBodyweight / 100);

  const lb = (n: number) => `${Math.round(n).toLocaleString()} lb`;
  const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

  return (
    <>
      <span className="tip-title">How this is worked out</span>

      <div className="tip-rows">
        <span className="tip-rows__label">Dry matter standing</span>
        <span className="tip-rows__value">{lb(a.standingLbDmPerAcre)}/acre</span>

        <span className="tip-rows__label">Grazed off</span>
        <span className="tip-rows__value">{pct(a.takeDownPct)}</span>

        <span className="tip-rows__rule" />
        <span className="tip-rows__label tip-rows__sum">Comes off an acre</span>
        <span className="tip-rows__value tip-rows__sum">{lb(takeDownPerAcre)}</span>

        <span className="tip-rows__label">Of that, eaten</span>
        <span className="tip-rows__value">{pct(a.utilizationPct)}</span>

        <span className="tip-rows__aside">the rest goes under a hoof or round a pat</span>

        <span className="tip-rows__rule" />
        <span className="tip-rows__label tip-rows__sum">An acre feeds them</span>
        <span className="tip-rows__value tip-rows__sum">{lb(perAcreEaten)}</span>

        <span className="tip-rows__aside">over {acres.toFixed(2)} acres</span>

        <span className="tip-rows__rule" />
        <span className="tip-rows__label tip-rows__sum">In this strip</span>
        <span className="tip-rows__value tip-rows__sum">{lb(onOffer)}</span>
      </div>

      <div className="tip-rows tip-rows--next">
        <span className="tip-rows__label">
          The mob{headCount !== null && avgWeightLb !== null ? ` · ${headCount} head` : ""}
        </span>
        <span className="tip-rows__value">{totalLb === null ? "—" : lb(totalLb)}</span>

        <span className="tip-rows__label">Eats each day</span>
        <span className="tip-rows__value">{pct(a.intakePctBodyweight)} of that</span>

        <span className="tip-rows__rule" />
        <span className="tip-rows__label tip-rows__sum">A day's feed</span>
        <span className="tip-rows__value tip-rows__sum">{daily === null ? "—" : lb(daily)}</span>
      </div>

      {daily !== null && daily > 0 && hoursOfFeed !== null ? (
        <div className="tip-answer">
          {lb(onOffer)} ÷ {lb(daily)} a day = <strong>{(hoursOfFeed / 24).toFixed(1)} days</strong>
        </div>
      ) : (
        <p className="tip-note">
          No days of feed until the mob has a head count and weights on file — there is nothing to
          divide by.
        </p>
      )}

      <p className="tip-note">A forecast, not a measurement.</p>
    </>
  );
}
