// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Recording a calving. The parts worth driving: that a live calf can't be
 * saved without a sex (its animal record needs one), that twins are a second
 * row rather than a flag, that a dairy dam is told she's freshening, and that
 * the service behind the calf defaults to the one the dates actually fit
 * rather than the most recent — which is what decides the sire, and through
 * the sire, the breeds the calf inherits.
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

// Patience served twice, three weeks apart. At 280 days the first service is
// due exactly on CALVED_ON and the second is three weeks past it, so the
// first is the one that made the calf even though it isn't the latest.
const CALVED_ON = "2026-10-08";

const animals = [
  { id: "cow-1", ear_tag: "0", barn_name: "Patience", sex: "female", class: "cow", status: "active", record_type: "herd", purpose: "dairy" },
  { id: "cow-2", ear_tag: "1", barn_name: "Martha", sex: "female", class: "cow", status: "active", record_type: "herd", purpose: "beef" },
  { id: "calf-1", ear_tag: "99", barn_name: "Bess", sex: "female", class: "calf", status: "active", record_type: "herd", purpose: "dairy" },
  { id: "bull-1", ear_tag: "", barn_name: "Dutton", sex: "male", class: "bull", status: "active", record_type: "reference", purpose: "dairy" },
  { id: "bull-2", ear_tag: "", barn_name: "Rip", sex: "male", class: "bull", status: "active", record_type: "reference", purpose: "beef" },
  // Entered as an animal before the calving was — Abigail's real position.
  { id: "calf-2", ear_tag: "3", barn_name: "Abigail", sex: "female", class: "heifer", status: "active", record_type: "herd", purpose: "beef", birth_date: CALVED_ON },
];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
}));

const breedings = [
  { id: "b1", animal_id: "cow-1", date: "2026-01-01", service_number: 1, method: "natural", technician: "",
    sire_id: "bull-1", semen_lot_id: null, semen_type: "", naab_code_snapshot: "", voided: false,
    void_reason: "", cost_entry_id: null, notes: "" },
  { id: "b2", animal_id: "cow-1", date: "2026-01-22", service_number: 2, method: "natural", technician: "",
    sire_id: "bull-2", semen_lot_id: null, semen_type: "", naab_code_snapshot: "", voided: false,
    void_reason: "", cost_entry_id: null, notes: "" },
];

vi.mock("../lib/breedings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/breedings")>()),
  fetchBreedings: vi.fn(async () => breedings),
}));

// No breed composition on file for anyone here, so gestation falls back to
// the species setting — which is enough to date a service.
vi.mock("../lib/gestation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gestation")>()),
  fetchBreeds: vi.fn(async () => []),
  fetchComposition: vi.fn(async () => []),
  fetchOverrides: vi.fn(async () => []),
}));

const calvings = [
  { id: "c1", dam_id: "cow-1", date: "2026-08-08", calving_ease: 3, assistance: "easy_pull",
    presentation: "anterior", retained_placenta: true, is_twin: true, breeding_event_id: "b1", notes: "" },
];

const outcomes = [
  { id: "o1", calving_id: "c1", calf_animal_id: "calf-1", outcome: "live", sex: "female",
    birth_weight_lb: 78, is_freemartin: false, vigor_score: 8, notes: "" },
  { id: "o2", calving_id: "c1", calf_animal_id: null, outcome: "stillborn", sex: "male",
    birth_weight_lb: null, is_freemartin: false, vigor_score: null, notes: "" },
];

type CalvingInput = Parameters<typeof import("../lib/repro").recordCalving>[0];
const recordCalving = vi.fn(async (_i: CalvingInput) => "new-id");

vi.mock("../lib/repro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/repro")>()),
  fetchCalvings: vi.fn(async () => calvings),
  fetchCalfOutcomes: vi.fn(async () => outcomes),
  fetchGestationDays: vi.fn(async () => ({ dairy: 280, beef: 285 })),
  recordCalving: (i: CalvingInput) => recordCalving(i),
}));

afterEach(() => {
  cleanup();
  recordCalving.mockClear();
});

const mount = async () => {
  const { default: Calvings } = await import("./Calvings");
  render(
    <MemoryRouter>
      <Calvings />
    </MemoryRouter>,
  );
  await screen.findByText("Recorded");
};

describe("Calvings", () => {
  it("names the live calf and says how the others went", async () => {
    await mount();
    const row = document.querySelector(".grid-row--body")!;
    expect(row.textContent).toContain("Patience");
    expect(row.textContent).toContain("twins");
    // The live one by its own name, the stillborn one by what happened.
    expect(row.textContent).toContain("Bess, bull stillborn");
    // The service behind it, so the sire on the calf is visible on the row.
    expect(row.textContent).toContain("Bull · Dutton");
    expect(row.textContent).toContain("easy pull");
    expect(row.textContent).toContain("retained placenta");
    expect(row.textContent).toContain("78lb");
  });

  it("won't record a live calf with no sex", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });

    // A live calf is the default, and its sex starts unrecorded.
    expect(screen.getByText(/needs a sex/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Record it" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("takes twins as a second calf", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Calf 1 sex"), { target: { value: "female" } });
    fireEvent.change(screen.getByLabelText("Calf 1 ear tag"), { target: { value: "99" } });

    fireEvent.click(screen.getByRole("button", { name: /another calf/ }));
    fireEvent.change(screen.getByLabelText("Calf 2 outcome"), { target: { value: "stillborn" } });
    fireEvent.change(screen.getByLabelText("Calf 2 sex"), { target: { value: "male" } });

    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    await waitFor(() => expect(recordCalving).toHaveBeenCalledTimes(1));

    const sent = recordCalving.mock.calls[0][0];
    expect(sent.calves.length).toBe(2);
    expect(sent.calves[0]).toMatchObject({ outcome: "live", sex: "female", earTag: "99" });
    expect(sent.calves[1]).toMatchObject({ outcome: "stillborn", sex: "male" });
  });

  it("stops asking for an ear tag once a calf isn't live", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    expect((screen.getByLabelText("Calf 1 ear tag") as HTMLInputElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Calf 1 outcome"), { target: { value: "stillborn" } });
    expect((screen.getByLabelText("Calf 1 ear tag") as HTMLInputElement).disabled).toBe(true);
  });

  it("says a dairy dam is freshening, and doesn't say it about a beef one", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));

    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });
    expect(screen.getByText(/This also freshens her/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-2" } });
    expect(screen.queryByText(/This also freshens her/)).toBeNull();
  });

  it("sends the calving's own details", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-2" } });
    fireEvent.change(screen.getByLabelText("Calf 1 sex"), { target: { value: "male" } });
    fireEvent.change(screen.getByLabelText("Calving ease"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Assistance"), { target: { value: "hard_pull" } });
    fireEvent.change(screen.getByLabelText("Presentation"), { target: { value: "breech" } });
    fireEvent.click(screen.getByLabelText("Retained placenta"));

    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    await waitFor(() => expect(recordCalving).toHaveBeenCalledTimes(1));
    expect(recordCalving.mock.calls[0][0]).toMatchObject({
      damId: "cow-2",
      calvingEase: 4,
      assistance: "hard_pull",
      presentation: "breech",
      retainedPlacenta: true,
    });
  });

  it("defaults to the service the dates fit, not the most recent one", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Calving date"), { target: { value: CALVED_ON } });

    const service = screen.getByLabelText("Service") as HTMLSelectElement;
    expect(service.value).toBe("b1");
    // And it says how each service dates against this calving.
    expect(service.textContent).toContain("due today");
    expect(service.textContent).toContain("21d early");
  });

  it("sends the chosen service, and keeps the choice when the date moves", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Calving date"), { target: { value: CALVED_ON } });

    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "b2" } });
    // Re-suggesting would quietly undo a deliberate pick.
    fireEvent.change(screen.getByLabelText("Calving date"), { target: { value: "2026-10-10" } });
    expect((screen.getByLabelText("Service") as HTMLSelectElement).value).toBe("b2");

    fireEvent.change(screen.getByLabelText("Calf 1 sex"), { target: { value: "female" } });
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    await waitFor(() => expect(recordCalving).toHaveBeenCalledTimes(1));
    expect(recordCalving.mock.calls[0][0]).toMatchObject({ breedingEventId: "b2" });
  });

  it("says so when there's no service to hang the calf on", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-2" } });

    expect(screen.queryByLabelText("Service")).toBeNull();
    expect(screen.getByText(/No breeding logged for her before this date/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Calf 1 sex"), { target: { value: "male" } });
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    await waitFor(() => expect(recordCalving).toHaveBeenCalledTimes(1));
    expect(recordCalving.mock.calls[0][0].breedingEventId).toBeNull();
  });

  it("offers a calf already on file, once the date matches hers", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });

    // Nothing on file was born today, so there is nothing to attach.
    expect(screen.queryByLabelText("Calf 1 record")).toBeNull();

    // Abigail is on file as born on the calving date — the only pairing the
    // database will accept, so the only one offered.
    fireEvent.change(screen.getByLabelText("Calving date"), { target: { value: CALVED_ON } });
    const picker = screen.getByLabelText("Calf 1 record") as HTMLSelectElement;
    expect(picker.value).toBe("");
    expect(picker.textContent).toContain("Abigail — already on file");
    // Bess was born on another date and is already in a calving; neither
    // belongs in this list.
    expect(picker.textContent).not.toContain("Bess");
  });

  it("takes her details from her own record rather than asking again", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Calving date"), { target: { value: CALVED_ON } });
    fireEvent.change(screen.getByLabelText("Calf 1 record"), { target: { value: "calf-2" } });

    // Filled in from her record, and locked — the database refuses any value
    // that contradicts it, so typing one here could only produce an error.
    expect((screen.getByLabelText("Calf 1 sex") as HTMLSelectElement).value).toBe("female");
    expect((screen.getByLabelText("Calf 1 ear tag") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Calf 1 sex") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Calf 1 ear tag") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/nothing new is created/)).toBeTruthy();
  });

  it("sends the animal to attach instead of a new one", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Calving date"), { target: { value: CALVED_ON } });
    fireEvent.change(screen.getByLabelText("Calf 1 record"), { target: { value: "calf-2" } });

    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    await waitFor(() => expect(recordCalving).toHaveBeenCalledTimes(1));
    expect(recordCalving.mock.calls[0][0].calves[0]).toMatchObject({ animalId: "calf-2", sex: "female" });
  });

  it("won't let a stillborn calf be an animal already on file", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record a calving" }));
    fireEvent.change(screen.getByLabelText("Dam"), { target: { value: "cow-1" } });
    fireEvent.change(screen.getByLabelText("Calving date"), { target: { value: CALVED_ON } });
    fireEvent.change(screen.getByLabelText("Calf 1 record"), { target: { value: "calf-2" } });
    // Only a live calf has an animal record at all.
    fireEvent.change(screen.getByLabelText("Calf 1 outcome"), { target: { value: "stillborn" } });
    expect((screen.getByLabelText("Calf 1 record") as HTMLSelectElement).disabled).toBe(true);
  });

  it("opens filled in when a cow's record sends you here", async () => {
    // The link on her page carries the whole answer: which cow, which day,
    // which service, and which calf already on file. Retyping it is how a
    // one-click fix becomes a chore nobody does.
    const { default: Calvings } = await import("./Calvings");
    render(
      <MemoryRouter
        initialEntries={[`/calvings?dam=cow-1&date=${CALVED_ON}&service=b1&calf=calf-2`]}
      >
        <Calvings />
      </MemoryRouter>,
    );
    await screen.findByText("Recorded");

    await waitFor(() => expect(screen.queryByLabelText("Dam")).toBeTruthy());
    expect((screen.getByLabelText("Dam") as HTMLSelectElement).value).toBe("cow-1");
    expect((screen.getByLabelText("Calving date") as HTMLInputElement).value).toBe(CALVED_ON);
    expect((screen.getByLabelText("Service") as HTMLSelectElement).value).toBe("b1");
    expect((screen.getByLabelText("Calf 1 record") as HTMLSelectElement).value).toBe("calf-2");
    // And her details come from her own record, not from the URL.
    expect((screen.getByLabelText("Calf 1 sex") as HTMLSelectElement).value).toBe("female");
    expect((screen.getByLabelText("Calf 1 ear tag") as HTMLInputElement).value).toBe("3");

    // Ready to save without touching anything.
    expect((screen.getByRole("button", { name: "Record it" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    await waitFor(() => expect(recordCalving).toHaveBeenCalledTimes(1));
    expect(recordCalving.mock.calls[0][0]).toMatchObject({
      damId: "cow-1",
      date: CALVED_ON,
      breedingEventId: "b1",
    });
    expect(recordCalving.mock.calls[0][0].calves[0]).toMatchObject({ animalId: "calf-2", sex: "female" });
  });
});
