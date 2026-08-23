// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InfoTip } from "../ui";
import { DaysOfFeedWorking } from "./DaysOfFeedWorking";
import { planStrip, type ForageAssumptions } from "../../lib/grazing";

/**
 * The working behind "days of feed".
 *
 * The point of these is that the panel and the tile cannot disagree: the
 * numbers asserted here are also asserted against `planStrip`, which is what
 * draws the tile. If somebody changes the arithmetic in one place, one of
 * these two halves fails.
 */

// The Suchomski August 2026 plan: in at 12in, off at 6in, 200 lb DM per
// acre-inch, 3% of bodyweight. Trampling and fouled are left blank on the
// plan, so the app's own fallbacks stand.
const assumptions: ForageAssumptions = {
  standingLbDmPerAcre: 12 * 200,
  utilizationPct: ((12 - 6) / 12) * 100,
  intakePctBodyweight: 3,
  tramplingLossPct: 15,
  fouledAreaPct: 3,
};

const HOURS = 155.2;

afterEach(cleanup);

const show = (over: Partial<Parameters<typeof DaysOfFeedWorking>[0]> = {}) =>
  render(
    <DaysOfFeedWorking
      assumptions={assumptions}
      acres={1.0}
      headCount={6}
      avgWeightLb={850}
      hoursOfFeed={HOURS}
      {...over}
    />,
  );

describe("what the ground offers", () => {
  it("shows the five figures the farm sets", () => {
    show();
    expect(screen.getByText("2,400 lb/acre")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("5,100 lb")).toBeTruthy();
    expect(screen.getByText("3% of that")).toBeTruthy();
    expect(screen.getByText(/6\.5 days/)).toBeTruthy();
  });

  it("names the two deductions, so the sum ties out", () => {
    // Without them 2,400 x 50% is 1,200 and the next line says 1,020. A
    // reader who checks the arithmetic and finds it wrong stops trusting the
    // page, so the 15% and the 3% are on show even though they are the app's
    // fallbacks rather than figures anybody typed.
    show();
    expect(screen.getByText(/less 15% trodden in/)).toBeTruthy();
    expect(screen.getByText(/less 3% they won't graze round the dung/)).toBeTruthy();
    expect(screen.getByText("1,020 lb")).toBeTruthy();
  });

  it("agrees with the tile it explains", () => {
    // Both halves of the same arithmetic, asserted against each other.
    const strip = planStrip({
      paddock: { id: "p1", acresGrazable: 2.02, acresMeasured: 2.02, sweepLengthFt: 660 } as never,
      from: 0,
      to: 1 / 2.02,
      headCount: 6,
      avgWeightLb: 850,
      assumptions,
    })!;
    expect(Math.round(strip.lbDmOnOffer)).toBe(989);
    expect((strip.hoursOfFeed! / 24).toFixed(1)).toBe("6.5");

    show({ hoursOfFeed: strip.hoursOfFeed });
    expect(screen.getByText("989 lb")).toBeTruthy();
    expect(screen.getByText(/989 lb ÷ 153 lb a day/)).toBeTruthy();
  });
});

describe("a mob with nothing on file", () => {
  it("says why there is no answer rather than showing a nonsense one", () => {
    const { container } = show({ headCount: null, avgWeightLb: null, hoursOfFeed: null });
    expect(screen.getByText(/nothing to divide by/)).toBeTruthy();
    // No answer panel at all, rather than a confident "0.0 days".
    expect(container.querySelector(".tip-answer")).toBeNull();
    expect(screen.queryByText(/= .* days/)).toBeNull();
    // The ground's half still reads — it doesn't depend on the mob.
    expect(screen.getByText("989 lb")).toBeTruthy();
  });
});

describe("opening it", () => {
  const open = () =>
    render(
      <InfoTip label="How days of feed is worked out">
        <DaysOfFeedWorking
          assumptions={assumptions}
          acres={1.0}
          headCount={6}
          avgWeightLb={850}
          hoursOfFeed={HOURS}
        />
      </InfoTip>,
    );

  const button = () => screen.getByRole("button", { name: "How days of feed is worked out" });

  it("opens on a tap, not a hover — half the farm is on a phone", () => {
    open();
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(button());
    expect(screen.getByRole("note")).toBeTruthy();
    expect(button().getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on a second tap, on Escape, and on a click outside", () => {
    open();
    fireEvent.click(button());
    fireEvent.click(button());
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.click(button());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("note")).toBeNull();

    fireEvent.click(button());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
