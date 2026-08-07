// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LactationCharts } from "./LactationCharts";
import type { RealLactation } from "../../lib/lactations";
import type { RealAnimal } from "../../lib/herd";
import type { ProductionRecord } from "../../lib/lactation-curve";

/**
 * The arithmetic is covered in lactation-curve.test.ts. This checks the
 * chart renders it — a bar with no height, or a legend naming the wrong
 * lactation, is invisible to a unit test and obvious on screen.
 */

const TODAY = "2026-08-07";

const animal = (id: string, name: string): RealAnimal => ({
  id,
  ear_tag: id,
  barn_name: name,
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2020-07-04",
  sire_id: null,
  dam_id: null,
  notes: null,
  purpose: "dairy",
  origin: "born_on_farm",
  record_type: "herd",
});

const lac = (over: Partial<RealLactation>): RealLactation => ({
  id: over.id ?? "l1",
  animal_id: over.animal_id ?? "a1",
  lactation_number: over.lactation_number ?? 1,
  fresh_date: over.fresh_date ?? "2026-01-01",
  dry_off_date: "dry_off_date" in over ? over.dry_off_date! : null,
  calving_id: null,
  peak_milk_lb: null,
  peak_dim: null,
  total_yield_lb: null,
  me305_lb: null,
  termination_reason: "",
});

const rec = (date: string, quantity: number, animalId = "a1"): ProductionRecord => ({
  animal_id: animalId,
  produced_date: date,
  quantity,
});

const first = lac({ id: "l1", lactation_number: 1, fresh_date: "2025-01-01", dry_off_date: "2025-03-01" });
const second = lac({ id: "l2", lactation_number: 2, fresh_date: "2026-01-01" });

const records = [rec("2025-01-01", 4), rec("2025-01-08", 8), rec("2026-01-01", 6), rec("2026-01-08", 10)];

const animals = [animal("a1", "Patience")];

afterEach(cleanup);

const mount = (props: Partial<Parameters<typeof LactationCharts>[0]> = {}) =>
  render(
    <LactationCharts
      lactations={[first, second]}
      records={records}
      animals={animals}
      todayIso={TODAY}
      {...props}
    />,
  );

describe("LactationCharts", () => {
  it("opens on her most recent lactation", () => {
    const { container } = mount();
    // "Lactation 2" appears in the panel title and again in the legend, so
    // this reads the title element rather than searching the whole tree.
    expect(container.querySelector(".lac-panel__title")?.textContent).toMatch(/Lactation 2/);
    expect(screen.getByText(/still milking/)).toBeTruthy();
  });

  it("names the lactation it's comparing against", () => {
    mount();
    // Lactation 1 totalled 12 and appears in the legend as the faint trace.
    expect(screen.getByText(/Lactation 1 \(12 gal\)/)).toBeTruthy();
  });

  it("draws a bar per week, both series", () => {
    const { container } = mount();
    // Two weeks of data, current and prior bar each.
    expect(container.querySelectorAll(".lac-curve__col")).toHaveLength(2);
    expect(container.querySelectorAll(".lac-curve__bar--current")).toHaveLength(2);
    expect(container.querySelectorAll(".lac-curve__bar--prior")).toHaveLength(2);
  });

  it("scales both series against one shared peak", () => {
    const { container } = mount();
    const current = container.querySelectorAll<HTMLElement>(".lac-curve__bar--current");
    const prior = container.querySelectorAll<HTMLElement>(".lac-curve__bar--prior");
    // Week 2: current 10 is the tallest bar anywhere, prior 8 is 80% of it.
    expect(current[1].style.height).toBe("100%");
    expect(prior[1].style.height).toBe("80%");
  });

  it("lists every lactation in the yield comparison", () => {
    mount();
    expect(screen.getByText("Yield by lactation")).toBeTruthy();
    expect(screen.getByText("2 lactations, on one scale.")).toBeTruthy();
    expect(screen.getByText("12 gal")).toBeTruthy();
    expect(screen.getByText("16 gal")).toBeTruthy();
  });

  it("hatches an unfinished lactation so it can't read as a final figure", () => {
    const { container } = mount();
    expect(container.querySelectorAll(".lac-yield__fill--open")).toHaveLength(1);
    expect(screen.getByText(/total so far, not a final figure/)).toBeTruthy();
  });

  it("says so for a first lactation rather than drawing an empty comparison", () => {
    mount({ lactations: [first], records: [rec("2025-01-01", 4), rec("2025-01-08", 8)] });
    expect(screen.getByText(/first lactation — nothing to compare/)).toBeTruthy();
  });

  it("offers a picker only when more than one cow has a curve", () => {
    const { container } = mount();
    // One cow: no cow chips, but two lactation chips.
    expect(container.querySelectorAll(".lac-charts__cows")).toHaveLength(1);

    cleanup();
    render(
      <LactationCharts
        lactations={[second, lac({ id: "l3", animal_id: "a2", lactation_number: 1, fresh_date: "2026-01-01" })]}
        records={[...records, rec("2026-01-02", 3, "a2")]}
        animals={[...animals, animal("a2", "Vera")]}
        todayIso={TODAY}
      />,
    );
    // Two cows now, so both are offered by name.
    expect(screen.getByText("Patience")).toBeTruthy();
    expect(screen.getByText("Vera")).toBeTruthy();
  });

  it("says there's nothing to draw rather than rendering an empty chart", () => {
    mount({ lactations: [second], records: [] });
    expect(screen.getByText(/No milk has been recorded against a lactation yet/)).toBeTruthy();
  });
});
