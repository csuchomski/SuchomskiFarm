// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RealAnimal } from "../../lib/herd";

/**
 * The drawn record. What's worth pressing: that the two views really swap,
 * that the marker a service gets carries its result, and that a row with
 * nothing in it says so rather than drawing an empty axis.
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
  animal({ id: "calf-1", ear_tag: "99", barn_name: "Bess", class: "calf" }),
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

const state = {
  calvings: calvings as typeof calvings,
  breedings: breedings as typeof breedings,
  checks: checks as typeof checks,
};

vi.mock("../../lib/repro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/repro")>()),
  fetchCalvings: vi.fn(async () => state.calvings),
  fetchCalfOutcomes: vi.fn(async () => outcomes),
  fetchPregnancyChecks: vi.fn(async () => state.checks),
  fetchGestationDays: vi.fn(async () => ({ beef: 283, dairy: 279 })),
  fetchVoluntaryWaitDays: vi.fn(async () => 60),
}));

vi.mock("../../lib/breedings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/breedings")>()),
  fetchBreedings: vi.fn(async () => state.breedings),
}));

vi.mock("../../lib/gestation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/gestation")>()),
  fetchBreeds: vi.fn(async () => []),
  fetchComposition: vi.fn(async () => []),
  fetchOverrides: vi.fn(async () => []),
}));

vi.mock("../../lib/lactations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/lactations")>()),
  fetchLactations: vi.fn(async () => [
    { id: "l1", animal_id: "cow-1", lactation_number: 3, fresh_date: "2024-03-10", dry_off_date: null,
      calving_id: "c1", peak_milk_lb: null, peak_dim: null, total_yield_lb: null, me305_lb: null,
      termination_reason: "" },
  ]),
}));

afterEach(() => {
  cleanup();
  state.calvings = calvings;
  state.breedings = breedings;
  state.checks = checks;
});

const mount = async ({ drawn = true } = {}) => {
  const { ReproTimeline } = await import("./ReproTimeline");
  render(
    <MemoryRouter>
      <ReproTimeline animal={martha} herd={herd} farmId="farm-1" />
    </MemoryRouter>,
  );
  await screen.findByText("Her record, row by row");
  // The lane only exists when there is something to draw; the empty case
  // waits for the callout instead.
  if (drawn) await waitFor(() => expect(document.querySelector(".rt-lane")).toBeTruthy());
  else await screen.findByText(/Nothing bred or calved/);
};

/** The shared axis, read off its own end label. It grows with today's date,
 *  so a hard-coded 450 would have expired on its own. */
const axisDays = () => Number(document.querySelector(".rt-axis__finish")!.textContent!.replace(" days", ""));

describe("ReproTimeline", () => {
  it("gives every calving its own row, anchored on the day she calved", async () => {
    await mount();
    expect(screen.getByText("Season 1")).toBeTruthy();
    expect(screen.getByText("Season 2")).toBeTruthy();
    expect(screen.getByText("calved 2024-03-10")).toBeTruthy();
    expect(screen.getByText("calved 2025-04-25")).toBeTruthy();
  });

  it("places a service by its day within the row, not by its date", async () => {
    await mount();
    // 2 June 2024 is day 84 of the season that started 10 March 2024.
    const note = screen.getByText(/day 84 · AI · Dutton — open/);
    expect(note).toBeTruthy();
    const left = (note as HTMLElement).style.left;
    expect(left).toBe(`${(84 / axisDays()) * 100}%`);
  });

  it("marks the service that took differently from the ones that didn't", async () => {
    await mount();
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

  it("names the calves on the calving that closed a season", async () => {
    await mount();
    expect(screen.getByText(/Twins · 2025-04-25/)).toBeTruthy();
    expect(screen.getByText("live heifer Bess · one stillborn")).toBeTruthy();
  });

  it("shows days open and the interval, and doesn't invent them for the open row", async () => {
    await mount();
    const figures = document.querySelectorAll(".rt-figures__big");
    expect(figures[0].textContent).toContain("128 d");
    expect(document.body.textContent).toContain("411 d interval");
    // The running row measures from the calving to today instead.
    expect(figures[1].textContent).toContain("so far");
  });

  it("swaps to calendar years and back", async () => {
    await mount();
    expect(screen.getByText("Season 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Calendar years" }));
    expect(screen.queryByText("Season 1")).toBeNull();
    expect(screen.getByText("2024")).toBeTruthy();
    expect(screen.getByText("2025")).toBeTruthy();
    // A service is dated within its year, not within a season.
    expect(screen.getByText(/06-02 · AI · Dutton — open/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Seasons" }));
    expect(screen.getByText("Season 1")).toBeTruthy();
  });

  it("can turn the voluntary wait shading off", async () => {
    await mount();
    expect(document.querySelectorAll(".rt-wait").length).toBe(2);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(document.querySelectorAll(".rt-wait").length).toBe(0);
  });

  it("says what is outstanding right now", async () => {
    await mount();
    // s4 in July 2025, never checked — long past a check being due.
    expect(screen.getByText(/not checked\. A check would settle it/)).toBeTruthy();
  });

  it("draws a projected due date as a guess once she is confirmed carrying", async () => {
    state.checks = [
      ...checks,
      { id: "p3", animal_id: "cow-1", date: "2025-08-20", method: "palpation", result: "pregnant",
        estimated_days_bred: null, estimated_conception_date: null, breeding_event_id: "s4",
        technician: "", notes: "" },
    ];
    await mount();
    expect(screen.getByText(/due 2026-04-23 if it holds/)).toBeTruthy();
    expect(document.querySelectorAll(".rt-carry.is-projected").length).toBe(1);
  });

  it("gives a cow who has never calved one honest row instead of a fake season", async () => {
    state.calvings = [];
    await mount();
    expect(screen.getByText("First season")).toBeTruthy();
    expect(screen.getByText("first bred 2024-06-02")).toBeTruthy();
    // Days open is measured from a calving, and there isn't one.
    expect(document.querySelector(".rt-figures__big")!.textContent).toContain("so far");
  });

  it("says nothing has happened rather than drawing an empty axis", async () => {
    state.calvings = [];
    state.breedings = [];
    state.checks = [];
    await mount({ drawn: false });
    expect(document.querySelector(".rt-grid")).toBeNull();
  });
});
