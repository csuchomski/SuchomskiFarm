// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";
import type { Valuation } from "../lib/depreciation";

/**
 * Beef and dairy kept apart.
 *
 * The farm runs two herds in one barn: the dairy cows are milked, the beef
 * cows raise their calves. Lactations belong to the first group and to
 * nothing else — herd.record_calving has always known that (it opens one only
 * for `purpose in ('dairy','dual')`) while the app went on counting every
 * female as a cow missing a lactation, which put the beef cows in a red stat
 * tile that could never be cleared.
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
  origin: "purchased",
  record_type: "herd",
  ...over,
});

const patience = animal({ id: "cow-1", ear_tag: "0", barn_name: "Patience", purpose: "dairy" });
const martha = animal({ id: "cow-2", ear_tag: "1", barn_name: "Martha", purpose: "beef" });
const vera = animal({ id: "cow-3", ear_tag: "2", barn_name: "Vera", class: "heifer", purpose: "dairy" });
const animals = [
  patience,
  martha,
  vera,
  animal({ id: "bull-1", ear_tag: "", barn_name: "Dutton", sex: "male", class: "bull", record_type: "reference" }),
];

// The Animals page groups by mob, so it fetches them. Mocked empty: these
// tests are about the two sides of the herd, and an unmocked fetch falls
// through to the live client and sits in "Loading…".
vi.mock("../lib/grazing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/grazing")>()),
  fetchGrazingGroups: vi.fn(async () => []),
  fetchGroupMembers: vi.fn(async () => []),
}));

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
  fetchAnimalByTag: vi.fn(async (tag: string) => animals.find((a) => a.ear_tag === tag) ?? null),
  fetchBreedComposition: vi.fn(async () => new Map()),
}));

vi.mock("../lib/lactations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/lactations")>()),
  fetchLactations: vi.fn(async () => []),
}));

vi.mock("../lib/milkings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/milkings")>()),
  fetchProductionRecords: vi.fn(async () => []),
}));

// The animal record pulls in the whole repro stack; none of it is what these
// tests are about.
vi.mock("../lib/repro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/repro")>()),
  fetchCalvings: vi.fn(async () => []),
  fetchCalfOutcomes: vi.fn(async () => []),
  fetchPregnancyChecks: vi.fn(async () => []),
  fetchGestationDays: vi.fn(async () => ({ beef: 283, dairy: 279 })),
  fetchVoluntaryWaitDays: vi.fn(async () => 60),
}));

vi.mock("../lib/breedings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/breedings")>()),
  fetchBreedings: vi.fn(async () => []),
}));

vi.mock("../lib/gestation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gestation")>()),
  fetchBreeds: vi.fn(async () => []),
  fetchComposition: vi.fn(async () => []),
  fetchOverrides: vi.fn(async () => []),
}));

const valuations: Valuation[] = [];

vi.mock("../lib/depreciation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/depreciation")>()),
  fetchValuations: vi.fn(async () => valuations),
}));

vi.mock("../lib/animal-money", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/animal-money")>()),
  fetchAnimalMoney: vi.fn(async () => []),
}));

vi.mock("../lib/genetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/genetics")>()),
  fetchMarkers: vi.fn(async () => []),
  fetchConditions: vi.fn(async () => []),
  fetchGenotypes: vi.fn(async () => []),
  fetchStatuses: vi.fn(async () => []),
}));

afterEach(cleanup);

describe("Animals, split by purpose", () => {
  const mount = async () => {
    const { default: Animals } = await import("./Animals");
    render(
      <MemoryRouter>
        <Animals />
      </MemoryRouter>,
    );
    await screen.findByText("Patience");
  };

  it("says how the herd divides", async () => {
    await mount();
    // Reference bulls aren't livestock and aren't counted.
    expect(screen.getByText(/3 on file · 2 dairy · 1 beef/)).toBeTruthy();
  });

  it("shows only the dairy side when asked, and only the beef side", async () => {
    await mount();

    fireEvent.click(screen.getByRole("button", { name: /^Dairy/ }));
    expect(screen.getByText("Patience")).toBeTruthy();
    expect(screen.getByText("Vera")).toBeTruthy();
    expect(screen.queryByText("Martha")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Beef/ }));
    expect(screen.getByText("Martha")).toBeTruthy();
    expect(screen.queryByText("Patience")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Whole herd" }));
    expect(screen.getByText("Patience")).toBeTruthy();
    expect(screen.getByText("Martha")).toBeTruthy();
  });

  it("says which side each animal is on, in the row", async () => {
    await mount();
    expect(screen.getByText(/female · beef/)).toBeTruthy();
    expect(screen.getAllByText(/female · dairy/).length).toBe(2);
  });

  it("divides the list into the two sides, each named and counted", async () => {
    await mount();
    const groups = [...document.querySelectorAll(".animals-group")];
    expect(groups.map((g) => g.querySelector(".animals-group__name")?.textContent)).toEqual(["Dairy", "Beef"]);
    expect(groups.map((g) => g.querySelector(".animals-group__count")?.textContent)).toEqual(["2", "1"]);
    expect(groups[0].textContent).toContain("milked");
    expect(groups[1].textContent).toContain("raising their calves");
  });

  it("puts each animal under her own side, in order", async () => {
    await mount();
    // The rows follow their heading, so reading the page top to bottom gives
    // the dairy cows and then the beef cow.
    const order = [...document.querySelectorAll(".animals-group__name, .grid-row--body .serif")].map(
      (n) => n.textContent,
    );
    expect(order).toEqual(["Dairy", "Patience", "Vera", "Beef", "Martha"]);
  });

  it("drops the headings when a side is already picked", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /^Dairy/ }));
    // One heading over one list would be labelling what the chip just said.
    expect(document.querySelectorAll(".animals-group").length).toBe(0);
    expect(screen.getByText("Patience")).toBeTruthy();
  });

  it("names the side in the empty message rather than saying nothing matches", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /^Beef/ }));
    fireEvent.change(screen.getByLabelText("Search animals"), { target: { value: "Patience" } });
    expect(screen.getByText(/on the beef side/)).toBeTruthy();
  });
});

describe("Lactations, dairy only", () => {
  const mount = async () => {
    const { default: Lactations } = await import("./Lactations");
    render(
      <MemoryRouter>
        <Lactations />
      </MemoryRouter>,
    );
    await screen.findByText("Dairy cows with none");
  };

  it("counts only the dairy females as missing a lactation", async () => {
    await mount();
    // Patience and Vera, not Martha — she is never going to have one.
    const tile = screen.getByText("Dairy cows with none").closest(".stat-tile")!;
    expect(tile.textContent).toContain("2");
  });

  it("leaves the beef cows out of the list and says why", async () => {
    await mount();
    const list = document.querySelectorAll(".grid-row--body");
    const names = [...list].map((r) => r.textContent).join(" ");
    expect(names).toContain("Patience");
    expect(names).toContain("Vera");
    expect(names).not.toContain("Martha");

    expect(screen.getByText(/Martha is a beef cow and isn't counted here/)).toBeTruthy();
    expect(screen.getByText(/they raise their calves rather than being milked/)).toBeTruthy();
  });
});

describe("An animal's record", () => {
  const mount = async (tag: string) => {
    const { default: AnimalRecord } = await import("./AnimalRecord");
    render(
      <MemoryRouter initialEntries={[`/animals/${tag}`]}>
        <Routes>
          <Route path="/animals/:tag" element={<AnimalRecord />} />
        </Routes>
      </MemoryRouter>,
    );
    // The record tab opens on her life, so this is the sentinel for
  // "the page has finished loading" now.
  await screen.findByText("What she has done");
  };

  it("has no lactation section for a beef cow", async () => {
    await mount("1");
    expect(screen.getByText("Martha")).toBeTruthy();
    // Not "no lactations recorded" — nothing at all, because an empty section
    // reads as a gap in her record when it's simply how she's run.
    expect(screen.queryByText(/[Ll]actation/)).toBeNull();
  });

  it("keeps it for a dairy cow", async () => {
    await mount("0");
    await waitFor(() => expect(screen.getAllByText(/[Ll]actation/).length).toBeGreaterThan(0));
  });

  it("puts beef or dairy on the identity line", async () => {
    await mount("1");
    const pills = [...document.querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pills).toContain("beef");
  });
});
