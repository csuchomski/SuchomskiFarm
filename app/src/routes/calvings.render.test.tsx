// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Recording a calving. The parts worth driving: that a live calf can't be
 * saved without a sex (its animal record needs one), that twins are a second
 * row rather than a flag, and that a dairy dam is told she's freshening.
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
  { id: "cow-1", ear_tag: "0", barn_name: "Patience", sex: "female", class: "cow", status: "active", record_type: "herd", purpose: "dairy" },
  { id: "cow-2", ear_tag: "1", barn_name: "Martha", sex: "female", class: "cow", status: "active", record_type: "herd", purpose: "beef" },
  { id: "calf-1", ear_tag: "99", barn_name: "Bess", sex: "female", class: "calf", status: "active", record_type: "herd", purpose: "dairy" },
  { id: "bull-1", ear_tag: "", barn_name: "Dutton", sex: "male", class: "bull", status: "active", record_type: "reference", purpose: "dairy" },
];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
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
});
