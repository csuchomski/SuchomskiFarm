// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Logging a breeding.
 *
 * The parts worth driving are the ones that decide what the database is
 * asked to do: that choosing AI asks for a straw and choosing a bull asks
 * for a bull, that the lot's price is offered rather than assumed, and that
 * voiding says the straw is coming back.
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

const animals = [
  { id: "cow-1", ear_tag: "1", barn_name: "Martha", sex: "female", class: "cow", status: "active", record_type: "herd", purpose: "beef" },
  { id: "cow-2", ear_tag: "3", barn_name: "Abigail", sex: "female", class: "heifer", status: "active", record_type: "herd", purpose: "dairy" },
  { id: "bull-1", ear_tag: "", barn_name: "Dutton", sex: "male", class: "bull", status: "active", record_type: "reference", purpose: "dairy" },
];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
}));

const lots = [
  { id: "lot-1", sire_id: "bull-1", naab_code: "", unit_type: "sexed_female", lot_code: "", tank: "A",
    canister: "1", cane: "2", straws_initial: 5, straws_remaining: 5, cost_per_straw_cents: 2000,
    purchase_date: "2026-05-01", supplier: "", reorder_threshold: 2, active: true, notes: "" },
  // Empty, so it must not be offered at all.
  { id: "lot-2", sire_id: "bull-1", naab_code: "7HO99999", unit_type: "conventional", lot_code: "", tank: "A",
    canister: "1", cane: "3", straws_initial: 4, straws_remaining: 0, cost_per_straw_cents: 1500,
    purchase_date: "2026-04-01", supplier: "", reorder_threshold: 2, active: true, notes: "" },
];

vi.mock("../lib/sires", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/sires")>()),
  fetchSemenLots: vi.fn(async () => lots),
}));

const breedings = [
  { id: "b1", animal_id: "cow-1", date: "2026-08-01", service_number: 1, method: "ai", technician: "Chris",
    sire_id: "bull-1", semen_lot_id: "lot-1", semen_type: "sexed_female", naab_code_snapshot: "",
    voided: false, void_reason: "", cost_entry_id: "cost-1", notes: "" },
  { id: "b2", animal_id: "cow-2", date: "2026-07-20", service_number: 1, method: "natural", technician: "",
    sire_id: "bull-1", semen_lot_id: null, semen_type: "", naab_code_snapshot: "",
    voided: false, void_reason: "", cost_entry_id: null, notes: "" },
];

type Draft = Parameters<typeof import("../lib/breedings").recordBreeding>[0];
const recordBreeding = vi.fn(async (_d: Draft) => "new-id");
const voidBreeding = vi.fn(async (_id: string, _reason: string) => undefined);

vi.mock("../lib/breedings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/breedings")>()),
  fetchBreedings: vi.fn(async () => breedings),
  fetchBreedingCosts: vi.fn(async () => new Map([["b1", 20]])),
  recordBreeding: (d: Draft) => recordBreeding(d),
  voidBreeding: (id: string, reason: string) => voidBreeding(id, reason),
}));

type CheckInput = Parameters<typeof import("../lib/repro").recordCheck>[0];
const recordCheck = vi.fn(async (_i: CheckInput) => "check-1");

// One standing service already checked in calf, so the row shows a result.
const checks = [
  { id: "p1", animal_id: "cow-1", date: "2026-08-05", method: "palpation", result: "pregnant",
    estimated_days_bred: 4, estimated_conception_date: "2026-08-01", breeding_event_id: "b1",
    technician: "", notes: "" },
];

vi.mock("../lib/repro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/repro")>()),
  fetchPregnancyChecks: vi.fn(async () => checks),
  // Beef 283, dairy 279 — the farm's own settings.
  fetchGestationDays: vi.fn(async () => ({ beef: 283, dairy: 279 })),
  recordCheck: (i: CheckInput) => recordCheck(i),
}));

afterEach(() => {
  cleanup();
  recordBreeding.mockClear();
  voidBreeding.mockClear();
  recordCheck.mockClear();
});

const mount = async () => {
  const { default: Breedings } = await import("./Breedings");
  render(
    <MemoryRouter>
      <Breedings />
    </MemoryRouter>,
  );
  await screen.findByText("Recorded");
};

const options = (label: string) =>
  [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.textContent);

describe("Breedings", () => {
  it("shows what each breeding used and what it cost", async () => {
    await mount();
    const rows = [...document.querySelectorAll(".grid-row--body")];

    // The live lot carries no NAAB code, so the bull's name stands in.
    const ai = rows.find((r) => r.textContent?.includes("Martha"))!;
    expect(ai.textContent).toContain("AI · Dutton");
    expect(ai.textContent).toContain("Chris");
    expect(ai.textContent).toContain("$20.00");

    const natural = rows.find((r) => r.textContent?.includes("Abigail"))!;
    expect(natural.textContent).toContain("Bull · Dutton");
    // No straw and no cost on a natural service.
    expect(natural.textContent).not.toContain("$");
  });

  it("offers only females to breed, and only bulls as a sire", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a breeding" }));

    expect(options("Cow or heifer")).toEqual(["Pick one…", "Martha · cow", "Abigail · heifer"]);

    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "natural" } });
    expect(options("Bull")).toEqual(["Pick a bull…", "Dutton"]);
  });

  it("asks for a straw for AI and a bull for a natural service, never both", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a breeding" }));

    expect(screen.getByLabelText("Straw")).toBeTruthy();
    expect(screen.queryByLabelText("Bull")).toBeNull();

    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "natural" } });
    expect(screen.getByLabelText("Bull")).toBeTruthy();
    expect(screen.queryByLabelText("Straw")).toBeNull();
  });

  it("keeps an empty lot out of the straw list", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a breeding" }));

    const straws = options("Straw");
    expect(straws).toEqual(["Pick a lot…", "Dutton — 5 left"]);
    expect(straws.some((s) => s?.includes("7HO99999"))).toBe(false);
  });

  it("offers the lot's price and says what the tank will be left with", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a breeding" }));
    fireEvent.change(screen.getByLabelText("Straw"), { target: { value: "lot-1" } });

    expect((screen.getByLabelText("Cost") as HTMLInputElement).placeholder).toBe("20.00");
    expect(screen.getByText(/4 after this/)).toBeTruthy();
    expect(screen.getByText(/\$20\.00 a straw/)).toBeTruthy();
  });

  it("sends the AI service with its straw and no separately chosen bull", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a breeding" }));
    fireEvent.change(screen.getByLabelText("Cow or heifer"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Straw"), { target: { value: "lot-1" } });
    fireEvent.change(screen.getByLabelText("Technician"), { target: { value: "Chris" } });
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => expect(recordBreeding).toHaveBeenCalledTimes(1));
    expect(recordBreeding.mock.calls[0][0]).toMatchObject({
      animalId: "cow-1",
      method: "ai",
      semenLotId: "lot-1",
      sireId: "",
      technician: "Chris",
      cost: "",
    });
  });

  it("won't log until the straw is chosen", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log a breeding" }));
    fireEvent.change(screen.getByLabelText("Cow or heifer"), { target: { value: "cow-1" } });

    expect(screen.getByText(/Which straw was used/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Log it" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    expect(recordBreeding).not.toHaveBeenCalled();
  });

  it("says the straw is coming back before voiding one", async () => {
    await mount();
    const rows = [...document.querySelectorAll(".grid-row--body")];
    const ai = rows.find((r) => r.textContent?.includes("Martha"))!;
    fireEvent.click([...ai.querySelectorAll("button")].find((b) => b.textContent === "void")!);

    expect(screen.getByText(/straw goes back into the tank/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Reason for voiding Martha/), { target: { value: "wrong cow" } });
    fireEvent.click(screen.getByRole("button", { name: "Void it" }));

    await waitFor(() => expect(voidBreeding).toHaveBeenCalledWith("b1", "wrong cow"));
  });

  it("doesn't promise a straw back on a natural service", async () => {
    await mount();
    const rows = [...document.querySelectorAll(".grid-row--body")];
    const natural = rows.find((r) => r.textContent?.includes("Abigail"))!;
    fireEvent.click([...natural.querySelectorAll("button")].find((b) => b.textContent === "void")!);

    expect(screen.queryByText(/straw goes back into the tank/)).toBeNull();
    expect(screen.getByText(/marked voided/)).toBeTruthy();
  });
});

describe("Pregnancy checks on a breeding", () => {
  it("shows the latest result and how many days bred she was", async () => {
    await mount();
    const row = [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes("Martha"))!;
    expect(row.textContent).toContain("pregnant");
    expect(row.textContent).toContain("4d · palpation");
  });

  it("says so when a breeding hasn't been checked", async () => {
    await mount();
    const row = [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes("Abigail"))!;
    expect(row.textContent).toContain("not yet");
  });

  it("works the due date out from the farm's gestation setting for her purpose", async () => {
    await mount();
    // Martha is beef, bred 2026-08-01, and beef gestation is 283 days.
    const row = [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes("Martha"))!;
    expect(row.textContent).toContain("2027-05-11");
  });

  it("records a check against the breeding it was opened from", async () => {
    await mount();
    const row = [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes("Martha"))!;
    fireEvent.click([...row.querySelectorAll("button")].find((b) => b.textContent === "check")!);

    fireEvent.change(screen.getByLabelText("Check date"), { target: { value: "2026-09-05" } });
    fireEvent.change(screen.getByLabelText("Check method"), { target: { value: "ultrasound" } });
    fireEvent.change(screen.getByLabelText("Check result"), { target: { value: "open" } });
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));

    await waitFor(() => expect(recordCheck).toHaveBeenCalledTimes(1));
    expect(recordCheck.mock.calls[0][0]).toMatchObject({
      animalId: "cow-1",
      breedingEventId: "b1",
      date: "2026-09-05",
      method: "ultrasound",
      result: "open",
    });
  });

  it("won't accept a check dated before she was bred", async () => {
    await mount();
    const row = [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes("Martha"))!;
    fireEvent.click([...row.querySelectorAll("button")].find((b) => b.textContent === "check")!);

    fireEvent.change(screen.getByLabelText("Check date"), { target: { value: "2026-07-01" } });
    expect(screen.getByText(/bred on 2026-08-01, after this check/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Record it" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
