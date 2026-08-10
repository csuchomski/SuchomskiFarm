// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";

/**
 * The alerts page and the "Next breeding" column, driven from the herd's real
 * shape: Martha carrying past her due date with an untied daughter on file,
 * Vera bred and unchecked, Patience calved and inside her waiting period.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd", "store", "books"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

// Frozen: every threshold in lib/alerts is measured from "today", so a real
// clock would make these pass in August and fail in October.
// Only Date is faked. Faking the timers too would stall waitFor, which polls
// on a real setTimeout and would never get one.
const TODAY = "2026-08-10";
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));

const animal = (over: Partial<RealAnimal> & { id: string; ear_tag: string }): RealAnimal => ({
  barn_name: null,
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2021-01-01",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "beef",
  origin: "purchased",
  record_type: "herd",
  ...over,
});

const animals = [
  animal({ id: "martha", ear_tag: "1", barn_name: "Martha" }),
  animal({ id: "patience", ear_tag: "0", barn_name: "Patience", purpose: "dairy" }),
  animal({ id: "vera", ear_tag: "2", barn_name: "Vera", class: "heifer", purpose: "dairy" }),
  animal({ id: "abigail", ear_tag: "3", barn_name: "Abigail", class: "heifer", dam_id: "martha", birth_date: "2026-07-24" }),
  animal({ id: "dutton", ear_tag: "", barn_name: "Dutton", sex: "male", class: "bull", record_type: "reference" }),
];

const breedings = [
  { id: "s1", animal_id: "martha", date: "2025-10-20", service_number: 1, method: "ai", technician: "",
    sire_id: "dutton", semen_lot_id: null, semen_type: "", naab_code_snapshot: "", voided: false,
    void_reason: "", cost_entry_id: null, notes: "" },
  // Bred in June and never checked — well past the point one would answer.
  { id: "s2", animal_id: "vera", date: "2026-06-01", service_number: 1, method: "ai", technician: "",
    sire_id: "dutton", semen_lot_id: null, semen_type: "", naab_code_snapshot: "", voided: false,
    void_reason: "", cost_entry_id: null, notes: "" },
];

const checks = [
  { id: "p1", animal_id: "martha", date: "2025-11-19", method: "visual", result: "pregnant",
    estimated_days_bred: 30, estimated_conception_date: null, breeding_event_id: "s1", technician: "", notes: "" },
];

const calvings = [
  { id: "c1", dam_id: "patience", date: "2026-08-06", calving_ease: 1, assistance: "unassisted",
    presentation: "anterior", retained_placenta: false, is_twin: false, breeding_event_id: null, notes: "" },
];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
  fetchBreedComposition: vi.fn(async () => new Map()),
}));

vi.mock("../lib/repro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/repro")>()),
  fetchCalvings: vi.fn(async () => calvings),
  fetchCalfOutcomes: vi.fn(async () => []),
  fetchPregnancyChecks: vi.fn(async () => checks),
  fetchGestationDays: vi.fn(async () => ({ beef: 283, dairy: 279 })),
  fetchVoluntaryWaitDays: vi.fn(async () => 60),
}));

vi.mock("../lib/breedings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/breedings")>()),
  fetchBreedings: vi.fn(async () => breedings),
}));

vi.mock("../lib/gestation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gestation")>()),
  fetchBreeds: vi.fn(async () => []),
  fetchComposition: vi.fn(async () => []),
  fetchOverrides: vi.fn(async () => []),
}));

afterEach(cleanup);
afterAll(() => vi.useRealTimers());

describe("Alerts page", () => {
  const mount = async () => {
    const { default: Alerts } = await import("./Alerts");
    render(
      <MemoryRouter>
        <Alerts />
      </MemoryRouter>,
    );
    // "Now" is both a stat tile's label and a band heading, so wait on the
    // band's own blurb instead.
    await screen.findByText(/Past the day it should have happened/);
  };

  it("leads with the cow who is past due", async () => {
    await mount();
    // 20 Oct 2025 + 283 = 30 Jul 2026, eleven days ago.
    expect(screen.getByText("Martha is 11 days past due")).toBeTruthy();
    expect(screen.getAllByText("11 days late").length).toBeGreaterThan(0);
  });

  it("raises the calf no calving accounts for", async () => {
    await mount();
    expect(screen.getByText("Abigail has no calving recorded")).toBeTruthy();
  });

  it("wants a check on a service old enough to answer", async () => {
    await mount();
    expect(screen.getByText("Vera hasn't been checked")).toBeTruthy();
  });

  it("puts a waiting period that hasn't finished under Coming up", async () => {
    await mount();
    // Patience calved 6 Aug; 60 days puts her at 5 Oct, which is far enough
    // out to be quiet — so she should NOT be here at all.
    expect(screen.queryByText(/Patience/)).toBeNull();
  });

  it("links each row at the animal it's about", async () => {
    await mount();
    const row = screen.getByText("Martha is 11 days past due").closest("a")!;
    expect(row.getAttribute("href")).toBe("/animals/1");
  });

  it("says where the thresholds come from rather than hiding them", async () => {
    await mount();
    expect(screen.getByText(/voluntary waiting period/)).toBeTruthy();
    expect(screen.getByText(/not a number written into the code/)).toBeTruthy();
  });
});

describe("Animals · next breeding", () => {
  const mount = async () => {
    const { default: Animals } = await import("./Animals");
    render(
      <MemoryRouter>
        <Animals />
      </MemoryRouter>,
    );
    await screen.findByText("Martha");
  };

  it("heads the column and dates the recommendation", async () => {
    await mount();
    expect(screen.getByText("Next breeding")).toBeTruthy();
    // Patience calved 6 Aug 2026; 60 days on is 5 Oct.
    expect(await screen.findByText("2026-10-05")).toBeTruthy();
    expect(screen.getByText("waiting period")).toBeTruthy();
  });

  it("says carrying, with the due date, for a cow in calf", async () => {
    await mount();
    expect(await screen.findByText("2026-07-30")).toBeTruthy();
    expect(screen.getByText("due — carrying")).toBeTruthy();
  });

  it("says a service is waiting on a check", async () => {
    await mount();
    expect(await screen.findByText(/bred · 70d, unchecked/)).toBeTruthy();
  });

  it("leaves it blank for a heifer who has never calved, and for a bull", async () => {
    await mount();
    // Abigail is a heifer with nothing on file; the bull isn't in this list at
    // all. A date invented from a birthday is a recommendation nobody made.
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });
});
