// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";
import type { Valuation } from "../lib/depreciation";

/**
 * Herd → Depreciation: the management figure, on the page.
 *
 * The numbers under test are the spec's own — $2,200 in, $900 out, 3.5
 * lactations, $371/cow/year, $1.86/cwt at 20,000 lb.
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

const animal = (over: Partial<RealAnimal> & { id: string; ear_tag: string }): RealAnimal => ({
  barn_name: null,
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2021-03-02",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "dairy",
  origin: "raised",
  record_type: "herd",
  ...over,
});

const patience = animal({ id: "cow-1", ear_tag: "0", barn_name: "Patience" });
const vera = animal({ id: "cow-2", ear_tag: "2", barn_name: "Vera", class: "heifer" });
const martha = animal({ id: "cow-3", ear_tag: "1", barn_name: "Martha", purpose: "beef" });
const dutton = animal({ id: "ai-1", ear_tag: "250JE", barn_name: "Dutton", sex: "male", class: "bull", record_type: "reference" });

const valuations: Valuation[] = [];
const marked = vi.fn(async (_farmId: string, _asOf: string) => 2);

vi.mock("../lib/depreciation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/depreciation")>()),
  fetchAssumptions: vi.fn(async () => (await importOriginal<typeof import("../lib/depreciation")>()).DEFAULT_ASSUMPTIONS),
  fetchValuations: vi.fn(async () => valuations),
  markHerdValues: marked,
  saveAssumptions: vi.fn(async () => {}),
}));

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => [patience, vera, martha, dutton]),
}));

vi.mock("../lib/lactations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/lactations")>()),
  fetchLactations: vi.fn(async () => [{ animal_id: "cow-1", fresh_date: "2024-07-09" }]),
}));

vi.mock("../lib/repro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/repro")>()),
  fetchCalvings: vi.fn(async () => []),
}));

vi.mock("../lib/milkings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/milkings")>()),
  fetchProductionRecords: vi.fn(async () => []),
}));

/**
 * The page reads today's date, and a carrying value falls by about a dollar a
 * day — so a test asserting a figure is asserting a figure *on a date*. The
 * clock is pinned to the day migration 035 was rehearsed, which is what makes
 * "the app agrees with what the SQL wrote" a claim that keeps meaning the
 * same thing tomorrow.
 *
 * Only Date is faked. Faking timers wholesale stalls `waitFor`, which never
 * advances and hangs the test.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  valuations.length = 0;
  marked.mockClear();
});

const mount = async () => {
  const { default: Depreciation } = await import("./Depreciation");
  render(
    <MemoryRouter>
      <Depreciation />
    </MemoryRouter>,
  );
  await screen.findByText("Per cow, per year");
};

describe("Herd depreciation", () => {
  it("states the annual charge and the cost per hundredweight", async () => {
    await mount();
    const stats = document.querySelector(".dep-stats")!;
    expect(stats.textContent).toContain("$371.43");
    expect(stats.textContent).toContain("$1.86");
  });

  it("shows the arithmetic rather than just its answer", async () => {
    await mount();
    // Split across JSX expressions, so read the line rather than a text node.
    const formula = document.querySelector(".dep-formula")!.textContent!.replace(/\s+/g, " ");
    expect(formula).toBe("($2,200.00 replacement − $900.00 cull) ÷ 3.5 lactations");
  });

  it("charges the whole string, not one cow", async () => {
    await mount();
    // Two dairy females at $371.43.
    expect(document.querySelector(".dep-stats")!.textContent).toContain("$742.86");
    expect(screen.getByText("The 2-cow string, per year")).toBeTruthy();
  });

  it("lists the dairy string and leaves out beef, bulls and catalogue animals", async () => {
    await mount();
    const names = [...document.querySelectorAll(".grid-row--body")].map((r) => r.textContent).join(" ");
    expect(names).toContain("Patience");
    expect(names).toContain("Vera");
    expect(names).not.toContain("Martha");
    expect(names).not.toContain("Dutton");
  });

  it("says which cows are not yet in the string rather than valuing them as worn", async () => {
    await mount();
    expect(screen.getByText(/not yet in the string — carried at replacement cost/)).toBeTruthy();
    expect(screen.getByText(/in production since/)).toBeTruthy();
  });

  it("carries a cow two years in below replacement cost, and a springing heifer at it", async () => {
    await mount();
    const rows = [...document.querySelectorAll(".grid-row--body")];
    const patienceRow = rows.find((r) => r.textContent?.includes("Patience"))!;
    const veraRow = rows.find((r) => r.textContent?.includes("Vera"))!;
    // Same figure the SQL roll wrote in the migration rehearsal.
    expect(patienceRow.textContent).toContain("$1,424.58");
    expect(veraRow.textContent).toContain("$2,200.00");
  });

  it("says a cow is not marked until she has been", async () => {
    await mount();
    expect(screen.getAllByText("not marked").length).toBe(2);
  });

  it("shows what was marked, and what the herd is carried at", async () => {
    valuations.push(
      { id: "v1", animalId: "cow-1", asOf: "2026-08-10", valueCents: 142458, basis: "marked", note: "" },
      { id: "v2", animalId: "cow-2", asOf: "2026-08-10", valueCents: 220000, basis: "marked", note: "" },
    );
    await mount();
    expect(document.querySelector(".dep-stats")!.textContent).toContain("$3,624.58");
    expect(screen.getByText("Carried, 2 marked")).toBeTruthy();
  });

  it("rolls the herd when asked, and says how many it marked", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Mark values today/ }));
    await waitFor(() => expect(marked).toHaveBeenCalledTimes(1));
    expect(marked.mock.calls[0][0]).toBe("farm-1");
    await waitFor(() => expect(screen.getByText(/Marked 2 cows as of /)).toBeTruthy());
  });

  it("says plainly that this is not the 4562", async () => {
    await mount();
    expect(screen.getByText(/This is not tax depreciation/)).toBeTruthy();
    expect(screen.getByText(/heifer raised on a cash-basis Schedule F has none/)).toBeTruthy();
  });

  it("says why beef cows are absent rather than leaving a silent gap", async () => {
    await mount();
    expect(screen.getByText(/Beef cows are not on this page/)).toBeTruthy();
  });
});

describe("the assumptions the farm can change", () => {
  it("refuses a cull value above replacement cost, in words", async () => {
    const { validate } = await import("./Depreciation");
    expect(validate({ replacementCents: 100000, cullCents: 200000, lifetimeLactations: 3.5, expectedAnnualYieldLb: 20000, milkLbPerGallon: 8.6 })).toMatch(
      /depreciate her upwards/,
    );
  });

  it("refuses a lifetime of zero", async () => {
    const { validate } = await import("./Depreciation");
    expect(validate({ replacementCents: 220000, cullCents: 90000, lifetimeLactations: 0, expectedAnnualYieldLb: 20000, milkLbPerGallon: 8.6 })).toMatch(
      /nothing to divide by/,
    );
  });

  it("accepts the farm's own figures", async () => {
    const { validate } = await import("./Depreciation");
    expect(validate({ replacementCents: 180000, cullCents: 80000, lifetimeLactations: 4, expectedAnnualYieldLb: 16000, milkLbPerGallon: 8.3 })).toBeNull();
  });

  it("opens with the figures currently in force", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Assumptions" }));
    const input = screen.getByLabelText("Replacement cost of a springing heifer") as HTMLInputElement;
    expect(input.value).toBe("2200.00");
  });
});
