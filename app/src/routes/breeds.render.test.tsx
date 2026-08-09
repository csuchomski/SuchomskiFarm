// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Breeds and their gestation. The parts worth driving: that a farm figure is
 * distinguishable from a breed default, that clearing it is a real action
 * rather than saving a zero, and that the page says who a change affects.
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
  { id: "cow-2", ear_tag: "0", barn_name: "Patience", sex: "female", class: "cow", status: "active", record_type: "herd", purpose: "dairy" },
];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
}));

const breeds = [
  { id: "bg", code: "BG", name: "Belted Galloway", species_type: "beef", default_gestation_days: 283, active: true },
  { id: "je", code: "JE", name: "Jersey", species_type: "dairy", default_gestation_days: 279, active: true },
  // On file but nobody carries it.
  { id: "bs", code: "BS", name: "Brown Swiss", species_type: "dairy", default_gestation_days: 290, active: true },
];

type SetInput = Parameters<typeof import("../lib/gestation").setOverride>[0];
const setOverrideFn = vi.fn(async (_i: SetInput) => undefined);

vi.mock("../lib/gestation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/gestation")>()),
  fetchBreeds: vi.fn(async () => breeds),
  fetchComposition: vi.fn(async () => [
    { animal_id: "cow-1", breed_id: "bg", percent: 100 },
    { animal_id: "cow-2", breed_id: "je", percent: 100 },
  ]),
  fetchOverrides: vi.fn(async () => [{ id: "o1", breed_id: "je", gestation_days: 281 }]),
  setOverride: (i: SetInput) => setOverrideFn(i),
}));

afterEach(() => {
  cleanup();
  setOverrideFn.mockClear();
});

const mount = async () => {
  const { default: Breeds } = await import("./Breeds");
  render(
    <MemoryRouter>
      <Breeds />
    </MemoryRouter>,
  );
  await screen.findByText("Belted Galloway");
};

const row = (name: string) =>
  [...document.querySelectorAll(".grid-row--body")].find((r) => r.textContent?.includes(name))!;

describe("Breeds", () => {
  it("shows each breed's default and who carries it", async () => {
    await mount();
    expect(row("Belted Galloway").textContent).toContain("283d");
    expect(row("Belted Galloway").textContent).toContain("Martha");
    expect(row("Brown Swiss").textContent).toContain("nobody");
  });

  it("distinguishes a farm figure from the breed's default", async () => {
    await mount();
    const jersey = row("Jersey");
    // Default stays visible; the farm's 281 sits beside it, marked.
    expect(jersey.textContent).toContain("279d");
    expect(jersey.textContent).toContain("281d");
    expect(jersey.textContent).toContain("set");
    // A breed with no farm figure shows a dash rather than repeating the default.
    expect(row("Belted Galloway").textContent).toContain("—");
  });

  it("saves a farm figure for the breed", async () => {
    await mount();
    fireEvent.click([...row("Belted Galloway").querySelectorAll("button")].find((b) => b.textContent?.includes("set a farm figure"))!);
    fireEvent.change(screen.getByLabelText("Gestation days for Belted Galloway"), { target: { value: "285" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setOverrideFn).toHaveBeenCalledTimes(1));
    expect(setOverrideFn.mock.calls[0][0]).toMatchObject({ farmId: "farm-1", breedId: "bg", days: "285" });
  });

  it("treats clearing it as going back to the default, not as zero", async () => {
    await mount();
    fireEvent.click([...row("Jersey").querySelectorAll("button")].find((b) => b.textContent === "change")!);

    // It opens holding the current farm figure.
    expect((screen.getByLabelText("Gestation days for Jersey") as HTMLInputElement).value).toBe("281");

    fireEvent.change(screen.getByLabelText("Gestation days for Jersey"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Use the default" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use the default" }));

    await waitFor(() => expect(setOverrideFn).toHaveBeenCalledTimes(1));
    expect(setOverrideFn.mock.calls[0][0].days).toBe("");
  });

  it("says who a change would affect", async () => {
    await mount();
    fireEvent.click([...row("Jersey").querySelectorAll("button")].find((b) => b.textContent === "change")!);
    expect(screen.getByText(/This changes the due date for Patience/)).toBeTruthy();
  });

  it("refuses an implausible figure", async () => {
    await mount();
    fireEvent.click([...row("Jersey").querySelectorAll("button")].find((b) => b.textContent === "change")!);
    fireEvent.change(screen.getByLabelText("Gestation days for Jersey"), { target: { value: "28" } });

    expect(screen.getByText(/not a plausible gestation/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
