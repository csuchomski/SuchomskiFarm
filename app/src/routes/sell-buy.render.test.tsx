// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";
import type { Weighing } from "../lib/grazing";

/**
 * Herd → Market: the sell/buy analyzer.
 *
 * The arithmetic is `sell-buy.test.ts`. What is tested here is the page's
 * honesty — that it says the slide is play data, that it says its figures are
 * gross, that it admits when the road runs off the end of the slide, and that
 * it never quotes a rate for a trade that is not buying anything back.
 */

const business = { id: 5, name: "Green Pastures Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const animal = (id: string, name: string): RealAnimal =>
  ({
    id, ear_tag: id.toUpperCase(), barn_name: name, sex: "female", class: "cow",
    status: "active", birth_date: "2024-03-01", sire_id: null, dam_id: null,
    notes: null, purpose: "beef", origin: "born",
  }) as RealAnimal;

const weighing = (id: string, date: string, weightLb: number): Weighing => ({
  id, animalId: "a1", date, weightLb, weightType: "scale", notes: null,
});

let animals: RealAnimal[] = [];
let weighings: Weighing[] = [];

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
}));

vi.mock("../lib/grazing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/grazing")>()),
  fetchWeighings: vi.fn(async () => weighings),
}));

beforeEach(() => {
  animals = [];
  weighings = [];
});

afterEach(() => {
  cleanup();
  // The slide is kept per browser, and jsdom keeps one store for the file —
  // so without this the first test that edits it puts every later test on the
  // edited figures.
  localStorage.clear();
});

const mount = async () => {
  const { default: SellBuy } = await import("./SellBuy");
  render(<MemoryRouter><SellBuy /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

const tile = (label: RegExp | string) => {
  const el = [...document.querySelectorAll(".stat-tile")].find((t) =>
    typeof label === "string" ? t.textContent?.includes(label) : label.test(t.textContent ?? ""),
  );
  return el?.querySelector(".stat-tile__value")?.textContent?.trim() ?? null;
};

describe("what the page admits about itself", () => {
  it("says the slide is play data, not a quote", async () => {
    // A printout of invented prices that does not say so is worse than no
    // page at all.
    await mount();
    expect(screen.getByText(/play data — no market feed yet/)).toBeTruthy();
    expect(screen.getByText(/not a quote/)).toBeTruthy();
  });

  it("says every figure is gross", async () => {
    await mount();
    expect(
      screen.getByText(/Commission, yardage, brand and health paper, freight, pencil/),
    ).toBeTruthy();
  });

  it("calls the weights samples until an animal is picked", async () => {
    animals = [animal("a1", "Martha")];
    await mount();
    expect(screen.getByText(/sample figures — pick an animal/)).toBeTruthy();
  });
});

describe("the weight history", () => {
  it("opens on the sample run and reads a gain off it", async () => {
    await mount();
    expect(tile("Weight now")).toContain("676");
    // 208 lb over 98 days.
    expect(tile(/Gain over/)).toContain("2.12");
  });

  it("takes an animal's own weighings when one is picked", async () => {
    animals = [animal("a1", "Martha")];
    weighings = [
      weighing("w1", "2026-05-01", 500),
      weighing("w2", "2026-06-30", 620),
    ];
    await mount();
    fireEvent.change(screen.getByLabelText("Take the weights from"), { target: { value: "a1" } });
    await waitFor(() => expect(tile("Weight now")).toContain("620"));
    expect(screen.getByText(/from the weights table/)).toBeTruthy();
  });

  it("says so rather than showing a rate from one weighing", async () => {
    // A weight is not a rate, and a number here would be invented.
    animals = [animal("a1", "Martha")];
    weighings = [weighing("w1", "2026-05-01", 500)];
    await mount();
    fireEvent.change(screen.getByLabelText("Take the weights from"), { target: { value: "a1" } });
    await waitFor(() => expect(screen.getByText(/needs two weighings/)).toBeTruthy());
    expect(tile(/needs two weighings/)).toBe("—");
  });

  it("offers a way back to the sample when an animal has nothing weighed", async () => {
    animals = [animal("a1", "Martha")];
    await mount();
    fireEvent.change(screen.getByLabelText("Take the weights from"), { target: { value: "a1" } });
    await waitFor(() => expect(screen.getByText(/Nothing weighed on this animal yet/)).toBeTruthy());
  });

  it("goes back to sample figures when the animal is cleared", async () => {
    animals = [animal("a1", "Martha")];
    weighings = [weighing("w1", "2026-05-01", 500), weighing("w2", "2026-06-30", 620)];
    await mount();
    fireEvent.change(screen.getByLabelText("Take the weights from"), { target: { value: "a1" } });
    await waitFor(() => expect(tile("Weight now")).toContain("620"));
    fireEvent.change(screen.getByLabelText("Take the weights from"), { target: { value: "" } });
    await waitFor(() => expect(tile("Weight now")).toContain("676"));
  });

  it("holds what is typed rather than reading it back mid-keystroke", async () => {
    // "5" on its way to "550" must not be read as a five-pound calf.
    await mount();
    const box = screen.getByLabelText("Weighing 3 weight") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "5" } });
    expect(box.value).toBe("5");
  });
});

describe("the price slide", () => {
  it("reads the slide out before offering to edit it", async () => {
    await mount();
    expect(screen.queryByLabelText("Price at 425 lb")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit the slide" }));
    expect(screen.getByLabelText("Price at 425 lb")).toBeTruthy();
  });

  it("moves every figure downstream when a rung is changed", async () => {
    await mount();
    const before = tile("Worth today");
    fireEvent.click(screen.getByRole("button", { name: "Edit the slide" }));
    fireEvent.change(screen.getByLabelText("Price at 675 lb"), { target: { value: "400" } });
    expect(tile("Worth today")).not.toBe(before);
  });

  it("offers no reset until the slide has been touched", async () => {
    // Nothing to go back to while it is still the sample.
    await mount();
    expect(screen.queryByRole("button", { name: "Reset the slide" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit the slide" }));
    fireEvent.change(screen.getByLabelText("Price at 675 lb"), { target: { value: "400" } });
    expect(screen.getByRole("button", { name: "Reset the slide" })).toBeTruthy();
  });
});

describe("when the gain stops paying", () => {
  it("names the weight the window closes at", async () => {
    await mount();
    // 676 lb today at the sample slide and 1.15 cost of gain. Margin peaks
    // twenty pounds out — and note it is past the first place the marginal
    // line dips under cost, which is the bug the peak rule replaced.
    expect(tile("Sell window closes")).toBe("696 lb");
  });

  it("says to sell now when the next ten pounds already lose money", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Cost of gain"), { target: { value: "9" } });
    expect(tile("Sell window closes")).toBe("Now");
    expect(screen.getByText(/Nothing ahead of today's weight pays for itself/)).toBeTruthy();
  });

  it("says when the slide runs out before the question does", async () => {
    // At a nominal cost of gain it pays to grow them all the way to the top
    // rung — and past it the drawing would only be showing the price clamp.
    await mount();
    fireEvent.change(screen.getByLabelText("Cost of gain"), { target: { value: "0.05" } });
    // A fragment, not the whole sentence: the weight is interpolated, so
    // React splits the line across text nodes and a full match never hits.
    expect(screen.getByText(/and the question does not/)).toBeTruthy();
  });

  it("stops the road at the slide's last rung", async () => {
    // Drawn past it, the flat clamp is the biggest thing on the chart and the
    // eye goes straight to it.
    await mount();
    const labels = [...document.querySelectorAll(".sb-axis")].map((t) => Number(t.textContent));
    expect(Math.max(...labels.filter((n) => n > 100))).toBeLessThanOrEqual(875);
  });

  it("opens on the margin curve, not on the sawtooth", async () => {
    // The marginal line crosses cost of gain four or five times on a real
    // slide. Read first it invites "it is back above the line at 840, so grow
    // them to 840"; the margin hump has one peak and it is the answer.
    await mount();
    expect(screen.getByRole("button", { name: "Margin per head" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(document.querySelector(".sb-line--cog")).toBeNull();
  });

  it("draws the cost line only against the value of gain", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Value of gain" }));
    expect(document.querySelector(".sb-line--cog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Margin per head" }));
    expect(document.querySelector(".sb-line--cog")).toBeNull();
    expect(document.querySelector(".sb-line--vog")).toBeTruthy();
  });
});

describe("trading down the ladder", () => {
  it("quotes what the trade pays per pound to regain the weight", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Buy back in at"), { target: { value: "500" } });
    expect(screen.getByText(/a pound to put those/)).toBeTruthy();
  });

  it("quotes no rate at all when the replacement is not lighter", async () => {
    // Nothing is being bought back, so there is no per-pound rate — and a
    // figure here would be a division by nought dressed as advice.
    await mount();
    fireEvent.change(screen.getByLabelText("Buy back in at"), { target: { value: "800" } });
    expect(screen.queryByText(/a pound to put those/)).toBeNull();
    expect(screen.getByText(/is not lighter, so nothing is being bought back/)).toBeTruthy();
  });

  it("marks the verdict against the trade until it beats cost of gain", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Buy back in at"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Cost of gain"), { target: { value: "9" } });
    expect(document.querySelector(".sb-verdict--yes")).toBeNull();
    expect(screen.getByText(/does not cover your cost of gain/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Cost of gain"), { target: { value: "0.50" } });
    expect(document.querySelector(".sb-verdict--yes")).toBeTruthy();
    expect(screen.getByText(/Worth doing/)).toBeTruthy();
  });
});
