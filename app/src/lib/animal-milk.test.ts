import { describe, expect, it } from "vitest";
import { buildMilkDays, dayBefore, emptyMilkContext, summariseMilk, type MilkContext } from "./animal-milk";

/**
 * What she gave, and what became of it.
 *
 * The case that drives this file is 4 Aug 2026 on the real farm: Patience
 * gave 5 gallons and Vera 2, both into one pooled batch; one gallon was
 * collected on the 7th, four of the remaining six are promised to an open
 * order, and two are free. The first version of this code called the whole
 * day "in inventory", because a batch still existed. A day is a set of
 * quantities, not a state.
 *
 * **Sold is what is missing** — produced, less what is still on hand, less
 * what was thrown away — because nothing records a sale against a day
 * directly.
 *
 * **A day is dated only by a pickup that drew from it alone.** An order that
 * drew across a fortnight says nothing about any single day inside it.
 */

const context = (over: Partial<MilkContext> = {}): MilkContext => ({
  ...emptyMilkContext(),
  priceCents: 1000,
  productId: 1,
  ...over,
});

/** The 4 Aug tank, exactly as the database holds it. */
const augustFourth = () =>
  buildMilkDays({
    records: [{ produced_date: "2026-08-04", quantity: 5 }],
    allRecords: [
      { produced_date: "2026-08-04", quantity: 5 },
      { produced_date: "2026-08-04", quantity: 2 },
    ],
    context: context({
      onHand: new Map([["2026-08-04", { quantity: 6, reserved: 4 }]]),
      soldOn: new Map([["2026-08-04", ["2026-08-07"]]]),
    }),
    days: 1,
    today: "2026-08-04",
  })[0];

describe("a pooled day", () => {
  it("splits the tank into sold, promised, free and binned", () => {
    const day = augustFourth();
    expect(day.tank).toEqual({ produced: 7, sold: 1, promised: 4, free: 2, binned: 0 });
  });

  it("does not call a partly sold day inventory", () => {
    // The bug this file was rewritten for: one gallon left on the 7th, and
    // the row said the day was sitting in the shop.
    expect(augustFourth().tank.sold).toBe(1);
  });

  it("knows when it was collected, because the pickup drew from that day alone", () => {
    expect(augustFourth().soldOn).toEqual(["2026-08-07"]);
  });

  it("keeps her share of the tank rather than inventing a gallon of her own", () => {
    const day = augustFourth();
    expect(day.gallons).toBe(5);
    expect(day.share).toBeCloseTo(5 / 7, 6);
  });

  it("colours the bar by whichever part is largest", () => {
    // 2 free + 4 promised on hand against 1 sold: the day is mostly stock.
    expect(augustFourth().status).toBe("inventory");
  });
});

describe("a day that has gone", () => {
  const gone = (over: Partial<MilkContext> = {}) =>
    buildMilkDays({
      records: [{ produced_date: "2026-08-01", quantity: 4 }],
      allRecords: [{ produced_date: "2026-08-01", quantity: 4 }],
      context: context(over),
      days: 1,
      today: "2026-08-01",
    })[0];

  it("is sold when no batch is left and nothing was binned", () => {
    const day = gone();
    expect(day.tank.sold).toBe(4);
    expect(day.status).toBe("sold");
    expect(day.valueCents).toBe(4000);
  });

  it("is undated when only a multi-day pickup covers it", () => {
    // added_from 10 Jun to added_to 24 Jun cannot date the 12th.
    expect(gone().soldOn).toEqual([]);
  });

  it("counts a discard against the day it was produced", () => {
    const day = gone({ binned: new Map([["2026-08-01", 4]]) });
    expect(day.tank).toEqual({ produced: 4, sold: 0, promised: 0, free: 0, binned: 4 });
    expect(day.status).toBe("discarded");
  });

  it("earns nothing for what was thrown away, and remembers what it would have fetched", () => {
    const half = gone({ binned: new Map([["2026-08-01", 2]]) });
    expect(half.valueCents).toBe(2000);
    expect(half.lostCents).toBe(2000);
  });
});

describe("the awkward shapes", () => {
  const day = (input: Partial<Parameters<typeof buildMilkDays>[0]> = {}) =>
    buildMilkDays({
      records: [{ produced_date: "2026-08-01", quantity: 4 }],
      allRecords: [{ produced_date: "2026-08-01", quantity: 4 }],
      context: context(),
      days: 1,
      today: "2026-08-01",
      ...input,
    })[0];

  it("never reports negative sales when stock was added on top of a milking", () => {
    // A batch added from the Store screen for the same day puts more in the
    // shop than the cows gave.
    const over = day({ context: context({ onHand: new Map([["2026-08-01", { quantity: 9, reserved: 0 }]]) }) });
    expect(over.tank.sold).toBe(0);
    expect(over.tank.free).toBe(4);
  });

  it("keeps promised inside on hand, never beyond it", () => {
    const odd = day({ context: context({ onHand: new Map([["2026-08-01", { quantity: 2, reserved: 5 }]]) }) });
    expect(odd.tank.promised).toBe(2);
    expect(odd.tank.free).toBe(0);
  });

  it("adds up two milkings on one day", () => {
    const twice = day({
      records: [
        { produced_date: "2026-08-01", quantity: 3 },
        { produced_date: "2026-08-01", quantity: 5 },
      ],
      allRecords: [
        { produced_date: "2026-08-01", quantity: 3 },
        { produced_date: "2026-08-01", quantity: 5 },
      ],
    });
    expect(twice.gallons).toBe(8);
    expect(twice.tank.produced).toBe(8);
  });
});

describe("the window", () => {
  const across = (days: number) =>
    buildMilkDays({
      records: [
        { produced_date: "2026-08-19", quantity: 4.2 },
        { produced_date: "2026-08-21", quantity: 4.6 },
      ],
      allRecords: [
        { produced_date: "2026-08-19", quantity: 4.2 },
        { produced_date: "2026-08-21", quantity: 4.6 },
      ],
      context: context(),
      days,
      today: "2026-08-21",
    });

  it("returns every day in it, oldest first", () => {
    expect(across(3).map((d) => d.date)).toEqual(["2026-08-19", "2026-08-20", "2026-08-21"]);
  });

  it("keeps a day she was not milked as a gap rather than a zero row", () => {
    expect(across(3).map((d) => d.recorded)).toEqual([true, false, true]);
  });

  it("leaves out anything older than the window", () => {
    expect(across(1).filter((d) => d.recorded).map((d) => d.date)).toEqual(["2026-08-21"]);
  });

  it("counts back by the calendar, so a month boundary is not 30 days of milliseconds", () => {
    expect(dayBefore("2026-08-03", 5)).toBe("2026-07-29");
    expect(dayBefore("2026-01-01", 1)).toBe("2025-12-31");
  });
});

describe("the summary", () => {
  it("apportions the tank to her before counting the money", () => {
    // 5 of 7 gallons hers; 1 sold, 4 promised, 2 free, at $10.
    const summary = summariseMilk([augustFourth()], 1000);
    expect(summary.gallons).toBe(5);
    expect(summary.days).toBe(1);
    expect(summary.soldCents).toBe(Math.round((5 / 7) * 1 * 1000));
    expect(summary.onHandGallons).toBe(round1((5 / 7) * 6));
    expect(summary.discardedGallons).toBe(0);
  });

  it("counts only the days she was milked", () => {
    const summary = summariseMilk(
      buildMilkDays({
        records: [{ produced_date: "2026-08-21", quantity: 4.6 }],
        allRecords: [{ produced_date: "2026-08-21", quantity: 4.6 }],
        context: context(),
        days: 5,
        today: "2026-08-21",
      }),
      1000,
    );
    expect(summary.days).toBe(1);
    expect(summary.gallons).toBe(4.6);
  });
});

const round1 = (n: number) => Math.round(n * 10) / 10;
