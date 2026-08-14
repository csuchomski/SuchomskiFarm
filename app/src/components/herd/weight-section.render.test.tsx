// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Weighing } from "../../lib/grazing";
import type { RealAnimal } from "../../lib/herd";

/**
 * Weight on the animal record.
 *
 * One field, a dated row behind it. The point of the section is that it reads
 * as a property and keeps a history — a single overwritable field would lose
 * the spring figure the moment an autumn one arrived.
 */

const rows: Weighing[] = [];
const recorded = vi.fn(async (_input: unknown) => "w-new");

vi.mock("../../lib/grazing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/grazing")>();
  return {
    ...actual,
    fetchWeighings: vi.fn(async () => rows),
    recordWeight: recorded,
  };
});

const animal = { id: "a1", ear_tag: "12", barn_name: "Martha" } as unknown as RealAnimal;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  rows.length = 0;
  recorded.mockClear();
});

const mount = async (farmId: string | null = "farm-1") => {
  const { WeightSection } = await import("./WeightSection");
  render(<WeightSection animal={animal} farmId={farmId} />);
  if (farmId !== null) await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

const weighing = (over: Partial<Weighing> = {}): Weighing => ({
  id: "w1", animalId: "a1", date: "2026-08-01",
  weightLb: 1150, weightType: "adhoc", notes: null, ...over,
});

describe("what it shows", () => {
  it("says never weighed rather than nothing at all", async () => {
    await mount();
    expect(screen.getByText("Never weighed.")).toBeTruthy();
  });

  it("leads with the most recent figure", async () => {
    rows.push(weighing({ id: "w2", date: "2026-08-01", weightLb: 1150 }));
    rows.push(weighing({ id: "w1", date: "2026-04-01", weightLb: 980 }));
    await mount();
    expect(document.querySelector(".wt-now")?.textContent).toMatch(/^1,150 lb/);
  });

  it("keeps the earlier ones, which is why it is not a single field", async () => {
    rows.push(weighing({ id: "w2", date: "2026-08-01", weightLb: 1150 }));
    rows.push(weighing({ id: "w1", date: "2026-04-01", weightLb: 980 }));
    await mount();
    expect(screen.getByText("Before that")).toBeTruthy();
    expect(screen.getByText("980 lb")).toBeTruthy();
  });

  it("names the kind of weighing when it is not a routine one", async () => {
    rows.push(weighing({ weightType: "weaning" }));
    await mount();
    expect(screen.getByText(/at weaning/)).toBeTruthy();
  });

  it("says why grazing wants it", async () => {
    await mount();
    expect(screen.getByText(/what set how much they eat in a day/)).toBeTruthy();
  });

  it("draws nothing without a farm to attach it to", async () => {
    await mount(null);
    expect(document.querySelector(".wt-now")).toBeNull();
  });
});

describe("recording one", () => {
  it("saves the weight against today by default", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Weight, lb"), { target: { value: "1150" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(recorded).toHaveBeenCalledTimes(1));
    expect(recorded.mock.calls[0][0]).toMatchObject({
      farmId: "farm-1", animalId: "a1", weightLb: 1150, date: "2026-08-13",
    });
  });

  it("takes a date, because a weighing happened on a day", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Weight, lb"), { target: { value: "980" } });
    fireEvent.change(screen.getByLabelText("Weighed on"), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByText("Record it"));

    await waitFor(() => expect(recorded).toHaveBeenCalledTimes(1));
    expect(recorded.mock.calls[0][0]).toMatchObject({ weightLb: 980, date: "2026-04-01" });
  });

  it("will not save nothing, or a nonsense figure", async () => {
    await mount();
    fireEvent.click(screen.getByText("Record it"));
    expect(recorded).not.toHaveBeenCalled();

    for (const bad of ["0", "-40", "heavy"]) {
      fireEvent.change(screen.getByLabelText("Weight, lb"), { target: { value: bad } });
      fireEvent.click(screen.getByText("Record it"));
      expect(recorded).not.toHaveBeenCalled();
    }
  });

  it("says so when the save fails, rather than clearing the field", async () => {
    recorded.mockRejectedValueOnce(new Error("network"));
    await mount();
    fireEvent.change(screen.getByLabelText("Weight, lb"), { target: { value: "1150" } });
    fireEvent.click(screen.getByText("Record it"));

    await screen.findByText("network");
    expect((screen.getByLabelText("Weight, lb") as HTMLInputElement).value).toBe("1150");
  });
});
