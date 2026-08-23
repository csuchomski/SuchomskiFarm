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
// acre-inch, 3% of bodyweight, and utilization left blank on the plan so the
// app's own figure stands.
const assumptions: ForageAssumptions = {
  standingLbDmPerAcre: 12 * 200,
  takeDownPct: ((12 - 6) / 12) * 100,
  utilizationPct: 85,
  intakePctBodyweight: 3,
};

// Half an acre of it: 2,400 x 50% x 85% = 1,020 lb an acre, so 510 in the
// strip, against a 153 lb day. The strip is deliberately not a whole acre so
// that "an acre feeds them" and "in this strip" are different numbers and a
// swap between them would fail rather than pass.
const HOURS = 80;

afterEach(cleanup);

const show = (over: Partial<Parameters<typeof DaysOfFeedWorking>[0]> = {}) =>
  render(
    <DaysOfFeedWorking
      assumptions={assumptions}
      acres={0.5}
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
    expect(screen.getByText("85%")).toBeTruthy();
    expect(screen.getByText("5,100 lb")).toBeTruthy();
    expect(screen.getByText("3% of that")).toBeTruthy();
    expect(screen.getByText(/3\.3 days/)).toBeTruthy();
  });

  it("shows the take-down before the utilization, so the sum ties out", () => {
    // Utilization is a share of what came off, not of what was standing, so
    // the take-down has to be on the page as its own figure. Without the
    // 1,200 in the middle a reader sees 2,400 and then 1,020 and has to guess
    // which two percentages were multiplied, in which order.
    show();
    expect(screen.getByText("Comes off an acre")).toBeTruthy();
    expect(screen.getByText("1,200 lb")).toBeTruthy();
    expect(screen.getByText("Of that, eaten")).toBeTruthy();
    expect(screen.getByText("1,020 lb")).toBeTruthy();
    expect(screen.getByText(/the rest goes under a hoof or round a pat/)).toBeTruthy();
  });

  it("agrees with the tile it explains", () => {
    // Both halves of the same arithmetic, asserted against each other.
    const strip = planStrip({
      paddock: { id: "p1", acresGrazable: 2.02, acresMeasured: 2.02, sweepLengthFt: 660 } as never,
      from: 0,
      to: 0.5 / 2.02,
      headCount: 6,
      avgWeightLb: 850,
      assumptions,
    })!;
    expect(Math.round(strip.lbDmOnOffer)).toBe(510);
    expect((strip.hoursOfFeed! / 24).toFixed(1)).toBe("3.3");

    show({ hoursOfFeed: strip.hoursOfFeed });
    expect(screen.getByText("510 lb")).toBeTruthy();
    expect(screen.getByText(/510 lb ÷ 153 lb a day/)).toBeTruthy();
  });
});

describe("whose figure is whose", () => {
  // A number the farm chose and a number this app supplied must not look
  // alike. In a panel of tidy percentages they otherwise do, and 85% reads
  // as fact until it is labelled as a guess.
  const sources = {
    standing: "height",
    takeDown: "graze-down",
    utilization: "default",
    intake: "plan",
  } as const;

  it("marks the app's own figure and leaves the farm's alone", () => {
    show({ sources });
    // One tag, on the one line the farm did not set.
    const tags = screen.getAllByText("this app's figure");
    expect(tags.length).toBe(1);
    expect(tags[0].closest(".tip-rows__label")!.textContent).toContain("Of that, eaten");
  });

  it("drops the tag once the farm sets one", () => {
    show({ sources: { ...sources, utilization: "plan" } });
    expect(screen.queryByText("this app's figure")).toBeNull();
  });

  it("says nothing either way when it has not been told", () => {
    // The panel is used without sources in tests and could be elsewhere. It
    // must not guess, and must not claim a figure is the farm's.
    show();
    expect(screen.queryByText("this app's figure")).toBeNull();
    expect(screen.getByText("85%")).toBeTruthy();
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
    expect(screen.getByText("510 lb")).toBeTruthy();
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
