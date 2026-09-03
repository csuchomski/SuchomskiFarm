// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { RealAnimal } from "../lib/herd";
import type { Weighing } from "../lib/grazing";
import type { MarketSeries } from "../lib/market";

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
let series: MarketSeries[] = [];
/** Set when the test wants the market reports to be unreachable — a puller
 *  that has not run, or a schema the app cannot read. */
let marketFails = false;

/** Iowa's grade 1 steers as reported on 2026-08-24, trimmed to five rungs. */
const iowaSteers = (over: Partial<MarketSeries> = {}): MarketSeries => ({
  key: "2|Steers|1",
  sourceId: 2,
  label: "Iowa Weekly Cattle Auction Summary",
  reportDate: "2026-08-24",
  isLocal: true,
  klass: "Steers",
  commodity: "Feeder Cattle",
  grade: "1",
  head: 2_140,
  rungs: [
    { weightLb: 472, cwt: 456 },
    { weightLb: 627, cwt: 365.82 },
    { weightLb: 731, cwt: 350.45 },
    { weightLb: 870, cwt: 316.75 },
    { weightLb: 1165, cwt: 256 },
  ],
  dropped: [],
  ...over,
});

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => animals),
}));

vi.mock("../lib/grazing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/grazing")>()),
  fetchWeighings: vi.fn(async () => weighings),
}));

vi.mock("../lib/market", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/market")>()),
  fetchMarketSeries: vi.fn(async () => {
    if (marketFails) throw new Error("market.latest_slide: permission denied");
    return series;
  }),
}));

beforeEach(() => {
  animals = [];
  weighings = [];
  series = [];
  marketFails = false;
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

/** The caveat at the right of a section's heading. Every section has one, so
 *  they are addressed by number rather than by being first. */
const sectionNote = (n: number) =>
  document.querySelectorAll(".sb-h__note")[n - 1]?.textContent ?? null;

const tile = (label: RegExp | string) => {
  const el = [...document.querySelectorAll(".stat-tile")].find((t) =>
    typeof label === "string" ? t.textContent?.includes(label) : label.test(t.textContent ?? ""),
  );
  return el?.querySelector(".stat-tile__value")?.textContent?.trim() ?? null;
};

describe("what the page admits about itself", () => {
  it("says the figures are the farm's own when no report is on file", async () => {
    // A printout of invented prices that does not say so is worse than no
    // page at all.
    await mount();
    expect(screen.getByText(/your own figures — no report on file/)).toBeTruthy();
    expect(screen.getByText(/your own typed figures, not a quote/)).toBeTruthy();
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

describe("the trade across a draft", () => {
  /**
   * The argument the per-head view cannot make: lighter cattle cost more a
   * pound, so the money buys fewer pounds but more head — and every one of
   * them gains at the same rate.
   */
  it("says how many the proceeds buy back, and how many more that is", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Head to sell"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Buy back in at"), { target: { value: "500" } });
    // 40 × $1,830 is $73,200; a 500 lb replacement is $1,588 each.
    expect(tile(/Bought back/)).toBe("46 head");
    expect(tile(/Bought back/)).toBeTruthy();
    expect(screen.getByText(/Bought back — 6 more/)).toBeTruthy();
  });

  it("keeps the remainder as cash rather than part of a steer", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Head to sell"), { target: { value: "40" } });
    const left = tile("Left over after buying");
    expect(left).toMatch(/^\$/);
    expect(left).not.toBe("$0");
  });

  it("makes the case that more mouths gain more a day", async () => {
    // The reason the method exists, and the thing per-head figures hide.
    await mount();
    fireEvent.change(screen.getByLabelText("Head to sell"), { target: { value: "40" } });
    const said = screen.getByText(/a day across the draft/).textContent!;
    expect(said).toContain("46 head");
    expect(said).toContain("comes back in");
  });

  it("says inventory was gained, not given up, when trading up", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Head to sell"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Buy back in at"), { target: { value: "800" } });
    expect(screen.getByText("Inventory gained")).toBeTruthy();
    expect(screen.getByText(/Bought back — \d+ fewer/)).toBeTruthy();
  });

  it("makes no gain-rate case without a gain rate", async () => {
    // Two rates and a countdown, all invented from nothing, is worse than
    // saying less.
    animals = [animal("a1", "Martha")];
    weighings = [weighing("w1", "2026-05-01", 500)];
    await mount();
    fireEvent.change(screen.getByLabelText("Take the weights from"), { target: { value: "a1" } });
    await waitFor(() => expect(screen.getByText(/needs two weighings/)).toBeTruthy());
    expect(screen.queryByText(/a day across the draft/)).toBeNull();
  });

  it("still gives the per-head figures under the draft's", async () => {
    await mount();
    expect(tile(/Sale, at 676 lb, each/)).toBe("$1,830");
  });
});

describe("taking prices from a market report", () => {
  /**
   * The USDA auction summaries, once the puller has run. What matters is that
   * the page says which report it is showing and when it was, that editing a
   * rung stops it claiming to be that report, and that a row the report got
   * wrong is named rather than quietly dropped.
   */
  const pick = (value: string) =>
    fireEvent.change(screen.getByLabelText("Take the prices from"), { target: { value } });

  it("offers no picker on a farm with no report on file", async () => {
    // The puller may never have run, and the page has to work on typed
    // figures alone — which is what it did before any of this.
    await mount();
    expect(screen.queryByLabelText("Take the prices from")).toBeNull();
  });

  it("opens on the farm's own figures, not on a report", async () => {
    // Somebody's own slide is not to be replaced by a market average without
    // them asking.
    series = [iowaSteers()];
    await mount();
    expect((screen.getByLabelText("Take the prices from") as HTMLSelectElement).value).toBe("");
    expect(tile("Price at this weight")).toContain("270.78");
  });

  it("takes the report's rungs when one is picked", async () => {
    series = [iowaSteers()];
    await mount();
    pick("2|Steers|1");
    // 676 lb interpolates between Iowa's 627 and 731 rungs, not the sample's.
    expect(tile("Price at this weight")).not.toContain("270.78");
    // Twice over on purpose: the section heading carries it so it is legible
    // at a glance, and the panel repeats it with the detail.
    expect(screen.getAllByText(/Iowa Weekly Cattle Auction Summary, Aug 24, 2026/)).toHaveLength(2);
    expect(sectionNote(2)).toContain("Iowa Weekly Cattle Auction Summary, Aug 24, 2026");
  });

  it("says how deep the market behind it was", async () => {
    // A series built on nine head is a rumour; one on two thousand is a
    // market, and which one you have changes how much to trust it.
    series = [iowaSteers()];
    await mount();
    pick("2|Steers|1");
    expect(screen.getByText(/across 2,140 head/)).toBeTruthy();
  });

  it("says when the barn is not a local one", async () => {
    series = [iowaSteers({ isLocal: false })];
    await mount();
    pick("2|Steers|1");
    expect(screen.getByText(/freight is on you/)).toBeTruthy();
  });

  it("names the rows the report got wrong rather than hiding them", async () => {
    // Iowa's real 2026-08-24 heifers: a 450 lb lot quoted at "1900", which as
    // a price per hundredweight makes her worth $8,550.
    series = [
      iowaSteers({
        key: "2|Heifers|1",
        klass: "Heifers",
        dropped: [{ weightLb: 450, cwt: 1900 }],
      }),
    ];
    await mount();
    pick("2|Heifers|1");
    expect(screen.getByText(/left out as impossible/)).toBeTruthy();
    expect(screen.getByText(/450 lb at \$1900/)).toBeTruthy();
    expect(screen.getByText(/per-head figure in the per-hundredweight column/)).toBeTruthy();
  });

  it("says nothing about dropped rows on a clean report", async () => {
    series = [iowaSteers()];
    await mount();
    pick("2|Steers|1");
    expect(screen.queryByText(/left out as impossible/)).toBeNull();
  });

  it("stops claiming to be the report once a rung is edited", async () => {
    // A slide with a report's name on it that has since been hand-edited is
    // the worst of both: it is neither the market's figures nor plainly the
    // farm's.
    series = [iowaSteers()];
    await mount();
    pick("2|Steers|1");
    fireEvent.click(screen.getByRole("button", { name: "Edit the slide" }));
    fireEvent.change(screen.getByLabelText("Price at 627 lb"), { target: { value: "300" } });
    expect(screen.queryAllByText(/Iowa Weekly Cattle Auction Summary, Aug 24, 2026/)).toHaveLength(0);
    expect(sectionNote(2)).toContain("your own figures");
  });

  it("goes back to the farm's own figures when the report is cleared", async () => {
    series = [iowaSteers()];
    await mount();
    pick("2|Steers|1");
    pick("");
    expect(tile("Price at this weight")).toContain("270.78");
  });

  it("changes what the footer claims the figures are", async () => {
    series = [iowaSteers()];
    await mount();
    expect(screen.getByText(/your own typed figures, not a quote/)).toBeTruthy();
    pick("2|Steers|1");
    expect(screen.getByText(/what cattle actually sold for at that barn/)).toBeTruthy();
  });

  it("still works when the market reports cannot be reached", async () => {
    // A puller that has not run, or a schema the app cannot read, must not
    // take the page down with it — the farm's own figures were the whole
    // page before any of this existed.
    marketFails = true;
    series = [iowaSteers()];
    await mount();
    // The page's sections are not gated on the load, so it draws either way.
    // What must not happen is an error banner over a page that is working —
    // unreachable market reports are an absence, not a fault.
    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(screen.queryByLabelText("Take the prices from")).toBeNull();
    expect(tile("Price at this weight")).toContain("270.78");
  });
});

/**
 * Reading the chart.
 *
 * The chart drew two lines against an axis of bare dollars and said nowhere
 * what they were dollars of. These are the parts that answer "what am I
 * looking at" — and the rule that the hover must never be the only place a
 * figure lives.
 */
describe("what the chart says about itself", () => {
  /** Text inside the SVG, which testing-library's text queries reach but the
   *  `.textContent` of a node concatenates without spaces. */
  const chartText = () => document.querySelector(".sb-figure")?.textContent ?? "";

  const toVog = () => fireEvent.click(screen.getByRole("button", { name: "Value of gain" }));

  it("says what the money on the y axis is money of", async () => {
    await mount();
    expect(chartText()).toContain("$ per head, over cost of gain");
    toVog();
    expect(chartText()).toContain("$ per pound of gain");
  });

  it("says which end of the weight axis is today", async () => {
    // Weight rising left to right is a convention, not a fact on the page,
    // and the first thing a reader has to settle before anything else means
    // anything.
    await mount();
    expect(chartText()).toContain("Weight, lb — today's 676 lb at the left");
  });

  it("names both lines when there are two of them", async () => {
    await mount();
    toVog();
    const legend = document.querySelector(".sb-legend");
    expect(legend?.textContent).toContain("What the next 10 lb add, per pound");
    expect(legend?.textContent).toContain("Cost of gain, $1.15 a pound");
  });

  it("carries no legend for a single line", async () => {
    // A legend box for one series is furniture: the caption already names it.
    await mount();
    expect(document.querySelector(".sb-legend")).toBeNull();
  });

  it("labels the line margin is measured against", async () => {
    await mount();
    expect(chartText()).toContain("break even");
  });

  it("labels its axis in steps that match where the rules are drawn", async () => {
    // The axis used to round every label to the dollar. On a 2.5 step that
    // prints "-$2" against a gridline sitting at -2.50 — a chart lying about
    // its own scale. Read back, the labels must be evenly spaced, because
    // the gridlines they sit on are.
    await mount();
    const ticks = [...document.querySelectorAll(".sb-svg text.sb-axis")]
      .filter((t) => t.getAttribute("text-anchor") === "end")
      // "break even" sits on the same rule with the same anchor; it is a
      // label for the line, not a step on the scale.
      .map((t) => /^(-?)\$([\d,.]+)$/.exec(t.textContent ?? ""))
      .filter((m) => m !== null)
      .map((m) => Number(m[1] + m[2].replace(/,/g, "")));
    expect(ticks.length).toBeGreaterThan(2);
    const gaps = ticks.slice(1).map((v, i) => Math.abs(v - ticks[i]));
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
  });
});

describe("reading a figure off the chart", () => {
  /** The chart is driven from the keyboard as well as the pointer, and only
   *  the keyboard works in jsdom — a pointer needs a layout to aim at. */
  const step = (times: number) => {
    const plot = document.querySelector(".sb-plot")!;
    for (let i = 0; i < times; i += 1) fireEvent.keyDown(plot, { key: "ArrowRight" });
    return plot;
  };

  const readout = () => document.querySelector(".sb-tip")?.textContent ?? null;

  it("shows nothing until asked", async () => {
    await mount();
    expect(document.querySelector(".sb-tip")).toBeNull();
  });

  it("gives the weight, the day it falls on, and what it is worth there", async () => {
    await mount();
    step(2);
    // Third step from 676 at 10 lb a step, and the sample's own gain rate.
    expect(readout()).toContain("696 lb");
    expect(readout()).toContain("9 days out");
    expect(readout()).toContain("$266.38/cwt");
    expect(readout()).toContain("$1,854");
  });

  it("puts the drawn line's own figure first", async () => {
    await mount();
    step(2);
    expect(readout()).toContain("Margin over cost of gain");
    fireEvent.click(screen.getByRole("button", { name: "Value of gain" }));
    step(2);
    expect(readout()).toContain("Next 10 lb add");
    expect(readout()).toContain("Cost of gain");
  });

  it("stops at the ends of the road rather than running off them", async () => {
    await mount();
    const plot = step(500);
    const far = readout();
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(readout()).toBe(far);
    expect(far).toContain("866 lb");
  });

  it("clears on escape and on leaving the chart", async () => {
    await mount();
    const plot = step(2);
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(document.querySelector(".sb-tip")).toBeNull();
    step(2);
    fireEvent.blur(plot);
    expect(document.querySelector(".sb-tip")).toBeNull();
  });

  it("is never the only place a figure lives", async () => {
    // A tooltip that is the only way to read a value is a chart with its
    // data hidden inside it — no print, no screen reader, no reading down a
    // column. Every weight on the line is in the table, unhovered.
    await mount();
    const rows = [...document.querySelectorAll(".sb-figures tbody tr")];
    expect(rows).toHaveLength(20);
    expect(rows[2].textContent).toContain("696 lb");
    expect(rows[2].textContent).toContain("$266.38");
    expect(rows[2].textContent).toContain("$1,854");
  });

  it("marks the sell weight in the table as well as on the line", async () => {
    await mount();
    const peak = document.querySelectorAll(".sb-figures tbody tr.sb-row--peak");
    expect(peak).toHaveLength(1);
    expect(peak[0].textContent).toContain("696 lb");
  });
});

describe("the chart on a phone", () => {
  const viewBox = () => document.querySelector(".sb-svg")?.getAttribute("viewBox") ?? null;

  it("is drawn narrow rather than drawn wide and shrunk", async () => {
    // Everything in an SVG scales with its viewBox, so a 720-wide chart in a
    // 330px column renders its 11px labels at five: present, unreadable, and
    // worse than absent because the page looks like it said something.
    await mount();
    expect(viewBox()).toBe("0 0 720 276");
    cleanup();

    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: /max-width:\s*700px/.test(q),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await mount();
    expect(viewBox()).toBe("0 0 380 300");
    vi.unstubAllGlobals();
  });
});
