// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ReproTimeline } from "./ReproTimeline";
import type { TimelineInput } from "../../lib/repro-timeline";
import type { RealAnimal } from "../../lib/herd";

/** Frozen, because the open season measures itself against today. */
const TODAY = "2026-08-10";

/**
 * The drawn record. Presentational now, so it takes its input directly and
 * these need no mocks at all — what they check is what it draws: that the
 * marker a service gets carries its result, that a row with nothing in it
 * says so rather than drawing an empty axis, and that a calf on file with no
 * calving is called out rather than silently leaving the season open.
 */

const animal = (over: Partial<RealAnimal> & { id: string; ear_tag: string }): RealAnimal => ({
  barn_name: null,
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2021-03-02",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "beef",
  origin: "purchased",
  record_type: "herd",
  ...over,
});

const martha = animal({ id: "cow-1", ear_tag: "1", barn_name: "Martha" });
const herd = [
  martha,
  animal({ id: "bull-1", ear_tag: "", barn_name: "Dutton", sex: "male", class: "bull", record_type: "reference" }),
  // Out of Martha, which is what makes her a candidate for a calving that
  // hasn't been recorded — Abigail's real position.
  animal({ id: "calf-1", ear_tag: "99", barn_name: "Bess", class: "calf", dam_id: "cow-1", birth_date: "2025-04-25" }),
];

const calvings = [
  { id: "c1", dam_id: "cow-1", date: "2024-03-10", calving_ease: 1, assistance: "unassisted",
    presentation: "anterior", retained_placenta: false, is_twin: false, breeding_event_id: null, notes: "" },
  { id: "c2", dam_id: "cow-1", date: "2025-04-25", calving_ease: 3, assistance: "easy_pull",
    presentation: "anterior", retained_placenta: true, is_twin: true, breeding_event_id: "s3", notes: "" },
];

const outcomes = [
  { id: "o1", calving_id: "c2", calf_animal_id: "calf-1", outcome: "live", sex: "female",
    birth_weight_lb: 78, is_freemartin: false, vigor_score: 8, notes: "" },
  { id: "o2", calving_id: "c2", calf_animal_id: null, outcome: "stillborn", sex: "male",
    birth_weight_lb: null, is_freemartin: false, vigor_score: null, notes: "" },
];

const breeding = (id: string, date: string, over: Record<string, unknown> = {}) => ({
  id, animal_id: "cow-1", date, service_number: 1, method: "ai", technician: "", sire_id: "bull-1",
  semen_lot_id: null, semen_type: "", naab_code_snapshot: "", voided: false, void_reason: "",
  cost_entry_id: null, notes: "", ...over,
});

const breedings = [
  breeding("s1", "2024-06-02"),
  breeding("s2", "2024-06-24"),
  breeding("s3", "2024-07-16"),
  breeding("s4", "2025-07-14"),
];

const checks = [
  { id: "p1", animal_id: "cow-1", date: "2024-07-04", method: "palpation", result: "open",
    estimated_days_bred: null, estimated_conception_date: null, breeding_event_id: "s1", technician: "", notes: "" },
  { id: "p2", animal_id: "cow-1", date: "2024-08-20", method: "palpation", result: "pregnant",
    estimated_days_bred: null, estimated_conception_date: null, breeding_event_id: "s3", technician: "", notes: "" },
];

const names = new Map(herd.map((a) => [a.id, a.barn_name ?? a.ear_tag]));

const input = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  animal: martha,
  calvings,
  outcomes,
  breedings,
  checks,
  lactations: [
    { id: "l1", animal_id: "cow-1", lactation_number: 3, fresh_date: "2024-03-10", dry_off_date: null,
      calving_id: "c1", peak_milk_lb: null, peak_dim: null, total_yield_lb: null, me305_lb: null,
      termination_reason: "" },
  ],
  names,
  gestationDays: 283,
  voluntaryWaitDays: 60,
  today: TODAY,
  ...over,
});

afterEach(cleanup);

const mount = (over: Partial<TimelineInput> = {}) => {
  render(
    <MemoryRouter>
      <ReproTimeline input={input(over)} herd={herd} showWait onShowWait={() => {}} />
    </MemoryRouter>,
  );
};

/** The shared axis, read off its own end label. It grows with today's date,
 *  so a hard-coded 450 would have expired on its own. */
const axisDays = () => Number(document.querySelector(".rt-axis__finish")!.textContent!.replace(" days", ""));

describe("ReproTimeline", () => {
  it("gives every calving its own row, anchored on the day she calved", () => {
    mount();
    expect(screen.getByText("Season 1")).toBeTruthy();
    expect(screen.getByText("Season 2")).toBeTruthy();
    expect(screen.getByText("calved 2024-03-10")).toBeTruthy();
    expect(screen.getByText("calved 2025-04-25")).toBeTruthy();
  });

  it("places a service by its day within the row, not by its date", () => {
    mount();
    // 2 June 2024 is day 84 of the season that started 10 March 2024.
    const note = screen.getByText(/day 84 · AI · Dutton — open/);
    expect(note).toBeTruthy();
    const left = (note as HTMLElement).style.left;
    expect(left).toBe(`${(84 / axisDays()) * 100}%`);
  });

  it("marks the service that took differently from the ones that didn't", () => {
    mount();
    // Scoped to the lanes: the legend draws the same three marks as its key,
    // and counting those would pass whatever the rows did.
    const inLanes = (kind: string) => document.querySelectorAll(`.rt-lane .rt-mark.${kind}`).length;
    // s3 is named by the calving, so it's the one that took.
    expect(inLanes("is-took")).toBe(1);
    // s1 was checked open; s2 and s4 were never checked at all.
    expect(inLanes("is-open")).toBe(1);
    expect(inLanes("is-unchecked")).toBe(2);
    // And the legend does show one of each, so the key isn't lying.
    expect(document.querySelectorAll(".rt-legend .rt-mark").length).toBe(3);
  });

  it("names the calves on the calving that closed a season", () => {
    mount();
    expect(screen.getByText(/Twins · 2025-04-25/)).toBeTruthy();
    expect(screen.getByText("live heifer Bess · one stillborn")).toBeTruthy();
  });

  it("shows days open and the interval, and doesn't invent them for the open row", () => {
    mount();
    const figures = document.querySelectorAll(".rt-figures__big");
    expect(figures[0].textContent).toContain("128 d");
    expect(document.body.textContent).toContain("411 d interval");
    // The running row measures from the calving to today instead.
    expect(figures[1].textContent).toContain("so far");
  });

  it("shades the voluntary wait, and the caller can turn it off", () => {
    mount();
    expect(document.querySelectorAll(".rt-wait").length).toBe(2);
    // The toggle is the caller's state now, so the component is driven by the
    // prop rather than owning it — Breedings keeps one setting across cows.
    cleanup();
    render(
      <MemoryRouter>
        <ReproTimeline input={input()} herd={herd} showWait={false} onShowWait={() => {}} />
      </MemoryRouter>,
    );
    expect(document.querySelectorAll(".rt-wait").length).toBe(0);
  });

  it("says what is outstanding right now", () => {
    mount();
    // s4 in July 2025, never checked — long past a check being due.
    expect(screen.getByText(/not checked\. A check would settle it/)).toBeTruthy();
  });

  it("draws a projected due date as a guess once she is confirmed carrying", () => {
    mount({ checks: [
      ...checks,
      { id: "p3", animal_id: "cow-1", date: "2025-08-20", method: "palpation", result: "pregnant",
        estimated_days_bred: null, estimated_conception_date: null, breeding_event_id: "s4",
        technician: "", notes: "" },
    ] });
    expect(screen.getByText(/due 2026-04-23 if it holds/)).toBeTruthy();
    expect(document.querySelectorAll(".rt-carry.is-projected").length).toBe(1);
  });

  it("gives a cow who has never calved one honest row instead of a fake season", () => {
    mount({ calvings: [], outcomes: [] });
    expect(screen.getByText("First season")).toBeTruthy();
    expect(screen.getByText("first bred 2024-06-02")).toBeTruthy();
    // Days open is measured from a calving, and there isn't one.
    expect(document.querySelector(".rt-figures__big")!.textContent).toContain("so far");
  });

  it("says nothing has happened rather than drawing an empty axis", () => {
    mount({ calvings: [], outcomes: [], breedings: [], checks: [] });
    expect(document.querySelector(".rt-grid")).toBeNull();
  });

  it("has no calendar-year view — a cow's record isn't kept by tax year", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Calendar years" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Seasons" })).toBeNull();
    // And the season rows are still there, which is the reading that stayed.
    expect(screen.getByText("Season 1")).toBeTruthy();
  });

  it("calls out a calf on file that no calving accounts for", () => {
    // With the calvings gone, so are their outcome rows — nothing accounts
    // for Bess any more, which is exactly Abigail's live situation.
    mount({ calvings: [], outcomes: [] });
    const prompt = document.querySelector(".rt-untied")!;
    expect(prompt).toBeTruthy();
    expect(prompt.textContent).toContain("Bess");
    expect(prompt.textContent).toContain("with no calving recorded");
    // And it links to the calving form with the work already done.
    const link = prompt.querySelector("a")!;
    expect(link.getAttribute("href")).toContain("/calvings?");
    expect(link.getAttribute("href")).toContain("dam=cow-1");
    expect(link.getAttribute("href")).toContain("calf=calf-1");
  });

  it("says nothing once a calving accounts for her", () => {
    mount();
    expect(document.querySelector(".rt-untied")).toBeNull();
  });

  it("calls out a calving that names no service, and offers the one that fits", () => {
    const attach = vi.fn();
    render(
      <MemoryRouter>
        <ReproTimeline
          input={input({
            // Her second calving carries no service, which is what happens
            // when the calving is recorded before the breeding is logged.
            calvings: [calvings[0], { ...calvings[1], breeding_event_id: null }],
          })}
          herd={herd}
          showWait
          onShowWait={() => {}}
          onAttachService={attach}
        />
      </MemoryRouter>,
    );

    const prompt = [...document.querySelectorAll(".rt-untied")].find((p) =>
      p.textContent?.includes("names no service"),
    )!;
    expect(prompt).toBeTruthy();
    expect(prompt.textContent).toContain("2025-04-25");
    // s3 lands the calving exactly on its due date; s1 is 44 days out and s2
    // 22. The suggestion is the arithmetic, not the latest.
    expect(prompt.textContent).toContain("2024-07-16");
    expect(prompt.textContent).toContain("on the day it was due");

    fireEvent.click(prompt.querySelector("button")!);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]).toEqual(["c2", "s3"]);
  });

  it("explains rather than offering a button when there's nothing to write with", () => {
    render(
      <MemoryRouter>
        <ReproTimeline
          input={input({ calvings: [calvings[0], { ...calvings[1], breeding_event_id: null }] })}
          herd={herd}
          showWait
          onShowWait={() => {}}
        />
      </MemoryRouter>,
    );
    const prompt = [...document.querySelectorAll(".rt-untied")].find((p) =>
      p.textContent?.includes("names no service"),
    )!;
    expect(prompt.querySelector("button")).toBeNull();
    expect(prompt.textContent).toContain("Attach it on");
  });
});
