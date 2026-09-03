// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { HistoryRow } from "../lib/market-history";

/**
 * Herd → Market → Classes.
 *
 * The arithmetic is `market-history.test.ts`. What is tested here is what the
 * page says about itself: that it opens on a drawing the data can fill, that
 * it names the money it is showing, that it never invents a figure for a week
 * a class did not sell into, and that it stops adding colours before it runs
 * out of ones a colour-blind reader can tell apart.
 */

const business = { id: 5, name: "Golden Acres", type: "farm" };

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

let rows: HistoryRow[] = [];
let historyFails = false;

vi.mock("../lib/market-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/market-history")>()),
  fetchMarketHistory: vi.fn(async () => {
    if (historyFails) throw new Error("market.quote_history: permission denied");
    return rows;
  }),
}));

/**
 * Weekly Iowa reports.
 *
 * Feeder steers and heifers every week; slaughter cows on two weeks in three,
 * because a class that skips a report is the case the chart has to draw as a
 * gap rather than a line straight across.
 */
const build = (weeks: number): HistoryRow[] => {
  const out: HistoryRow[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const date = new Date(Date.UTC(2026, 5, 7 + w * 7)).toISOString().slice(0, 10);
    const push = (
      commodity: string, klass: string, grade: string,
      rungs: [number, number][], head: number,
    ) => {
      for (const [wt, cwt] of rungs) {
        out.push({
          report_date: date, source_id: 2, label: "Iowa Weekly Cattle Auction Summary",
          is_local: true, commodity, class: klass, grade, wt, cwt: cwt + w, head,
        });
      }
    };
    push("Feeder Cattle", "Steers", "1", [[472, 456], [627, 386], [870, 317], [1024, 286]], 300);
    push("Feeder Cattle", "Heifers", "1", [[426, 400], [628, 351], [830, 303], [963, 274]], 180);
    if (w % 3 !== 1) {
      push("Slaughter Cattle", "Cows", "N/A", [[943, 128], [1150, 140], [1360, 150]], 40);
    }
  }
  return out;
};

beforeEach(() => {
  rows = build(10);
  historyFails = false;
});

afterEach(cleanup);

const mount = async () => {
  const { default: MarketClasses } = await import("./MarketClasses");
  render(<MemoryRouter><MarketClasses /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

const openView = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const on = (name: string) =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed") === "true";
const chips = () => [...document.querySelectorAll(".mc-chip")];
const chip = (name: string) => chips().find((c) => c.textContent?.startsWith(name));
const readout = () => document.querySelector(".xy-tip")?.textContent ?? null;

const step = (times: number, i = 0) => {
  const plot = document.querySelectorAll(".xy-plot")[i];
  for (let k = 0; k < times; k += 1) fireEvent.keyDown(plot, { key: "ArrowRight" });
};

describe("what the page opens on", () => {
  it("opens on the ladder when there is only one report", async () => {
    // A row of single dots is a worthless first look, and the ladder is the
    // one drawing a single report can fill.
    rows = build(1);
    await mount();
    expect(on("Price by weight")).toBe(true);
    expect(on("One chart each")).toBe(false);
  });

  it("says so, and says what is waiting on more reports", async () => {
    rows = build(1);
    await mount();
    expect(screen.getByText(/One report so far/)).toBeTruthy();
    expect(screen.getByText(/A trend, a rolling average/)).toBeTruthy();
  });

  it("opens on a chart per class once there is a trend to draw", async () => {
    await mount();
    expect(on("One chart each")).toBe(true);
  });

  it("does not talk about a single report when there are ten", async () => {
    await mount();
    expect(screen.queryByText(/One report so far/)).toBeNull();
  });

  it("still lets a single report be looked at every other way", async () => {
    rows = build(1);
    await mount();
    openView("One chart each");
    expect(on("One chart each")).toBe(true);
  });
});

describe("what the figures are figures of", () => {
  it("says the money is as reported until told otherwise", async () => {
    await mount();
    expect(document.body.textContent).toContain("$ per cwt, as reported");
  });

  it("names whose inflation figure it is, and admits it is not an index", async () => {
    // There is no price index in the database. A page that quietly deflated
    // by an invented one would be worse than one that does not deflate.
    await mount();
    fireEvent.change(screen.getByLabelText(/Money/i), { target: { value: "real" } });
    expect(screen.getByText(/your figure, not an index/)).toBeTruthy();
    expect(screen.getByText(/there is no price index in this database/)).toBeTruthy();
  });

  it("says how small the correction is next to what cattle do", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/Money/i), { target: { value: "real" } });
    expect(screen.getByText(/cattle move thirty percent in a year and this moves three/)).toBeTruthy();
  });

  it("says which year's dollars it has restated to", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/Money/i), { target: { value: "real" } });
    expect(document.body.textContent).toContain("$ per cwt, in 2026 dollars");
  });

  it("says what a fixed weight does and does not answer", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/Priced/i), { target: { value: "atWeight" } });
    expect(screen.getByText(/does not read as a rally/)).toBeTruthy();
    expect(screen.getByText(/the line breaks rather than guessing/)).toBeTruthy();
  });

  it("changes the axis when the level is indexed", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/Level/i), { target: { value: "indexed" } });
    expect(document.body.textContent).toContain("Index, first report = 100");
  });
});

describe("reading a figure off a chart", () => {
  it("gives every drawn class at the week under the pointer", async () => {
    await mount();
    openView("All on one");
    step(3);
    expect(readout()).toContain("Steers grade 1");
    expect(readout()).toContain("Heifers grade 1");
  });

  it("says a class was not quoted rather than showing a number for it", async () => {
    // Slaughter cows skip every third report. A tooltip that carried the week
    // before's figure would be inventing a sale.
    await mount();
    fireEvent.change(screen.getByLabelText(/Cattle/i), { target: { value: "Slaughter Cattle" } });
    openView("All on one");
    step(1);
    expect(readout()).toContain("not quoted");
  });

  it("draws a skipped week as a break rather than a line across it", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/Cattle/i), { target: { value: "Slaughter Cattle" } });
    openView("All on one");
    // One path per unbroken run: a class quoted on weeks 0,2,3,5,6,8,9 is
    // several runs, not one.
    const paths = document.querySelectorAll(".xy-svg path");
    expect(paths.length).toBeGreaterThan(1);
  });

  it("clears the readout on escape", async () => {
    await mount();
    openView("All on one");
    step(2);
    expect(document.querySelector(".xy-tip")).toBeTruthy();
    fireEvent.keyDown(document.querySelectorAll(".xy-plot")[0], { key: "Escape" });
    expect(document.querySelector(".xy-tip")).toBeNull();
  });
});

describe("the rolling average", () => {
  it("is off until asked for", async () => {
    await mount();
    expect(document.body.textContent).not.toContain("report average");
  });

  it("is named by its own window when it is on", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText(/Rolling avg/i), { target: { value: "5" } });
    expect(screen.getAllByText("5-report average").length).toBeGreaterThan(0);
  });
});

describe("picking classes", () => {
  it("offers only the classes of the chosen cattle", async () => {
    await mount();
    expect(chip("Steers grade 1")).toBeTruthy();
    expect(chip("Cows")).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/Cattle/i), { target: { value: "Slaughter Cattle" } });
    expect(chip("Cows")).toBeTruthy();
    expect(chip("Steers grade 1")).toBeUndefined();
  });

  it("says how much of a market each class is", async () => {
    // A class built on forty head is a rumour and one on three thousand is a
    // market, and the page should let you tell which you are reading.
    await mount();
    expect(chip("Steers grade 1")?.textContent).toContain("12,000 hd");
    expect(chip("Steers grade 1")?.textContent).toContain("472–1024 lb");
  });

  it("draws one chart for each class ticked", async () => {
    await mount();
    expect(document.querySelectorAll(".mc-panel")).toHaveLength(2);
    fireEvent.click(chip("Heifers grade 1")!.querySelector("input")!);
    expect(document.querySelectorAll(".mc-panel")).toHaveLength(1);
  });

  it("asks for a class rather than drawing an empty chart", async () => {
    await mount();
    for (const c of chips()) {
      const box = c.querySelector("input") as HTMLInputElement;
      if (box.checked) fireEvent.click(box);
    }
    expect(screen.getByText(/Tick a class above/)).toBeTruthy();
  });
});

describe("when the reports cannot be read", () => {
  it("says so and points at the tab that still works", async () => {
    historyFails = true;
    await mount();
    expect(screen.getByText(/permission denied/)).toBeTruthy();
    expect(screen.getByText(/sell\/buy tab still works/)).toBeTruthy();
  });

  it("says the reports are auction summaries and not a quote", async () => {
    await mount();
    expect(screen.getByText(/which is not a quote for yours/)).toBeTruthy();
  });

  it("says every figure is gross", async () => {
    await mount();
    expect(screen.getByText(/commission, yardage, freight, pencil shrink/)).toBeTruthy();
  });
});
