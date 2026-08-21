import { describe, expect, it } from "vitest";
import { buildMilkDays, dayBefore, summariseMilk } from "./animal-milk";

/**
 * What she gave, and what became of it.
 *
 * The three states come from three different places, and each has a way of
 * going quietly wrong:
 *
 * **On hand** is a batch that still exists. `complete_pickup` deletes a batch
 * once it is drawn to nothing, so "still in the table" is the test — asking
 * whether quantity is above zero would count a batch that has been emptied
 * but not yet cleaned up.
 *
 * **Binned** beats on hand. A day partly thrown away is the day worth
 * marking, and the milk that survived it is still milk she gave.
 *
 * **A day with no milking is a gap, not a zero.** Twelve bars squeezed
 * together would say she milked twelve days running.
 */

const record = (produced_date: string, quantity: number, batch_id: number | null = null) => ({
  produced_date,
  quantity,
  batch_id,
});

const build = (over: Partial<Parameters<typeof buildMilkDays>[0]> = {}) =>
  buildMilkDays({
    records: [record("2026-08-19", 4.2, 11), record("2026-08-20", 4.4, 12), record("2026-08-21", 4.6, 13)],
    liveBatchIds: new Set([13]),
    discardedDates: new Set<string>(),
    priceCents: 1000,
    days: 3,
    today: "2026-08-21",
    ...over,
  });

describe("the window", () => {
  it("returns every day in it, oldest first", () => {
    expect(build().map((d) => d.date)).toEqual(["2026-08-19", "2026-08-20", "2026-08-21"]);
  });

  it("keeps a day she was not milked as a gap rather than a zero row", () => {
    const days = build({ records: [record("2026-08-21", 4.6, 13)] });
    expect(days.map((d) => d.recorded)).toEqual([false, false, true]);
    expect(days[0].gallons).toBe(0);
  });

  it("leaves out anything before the window or after today", () => {
    const days = build({
      records: [record("2026-07-01", 9, 1), record("2026-09-01", 9, 2), record("2026-08-20", 4.4, 12)],
    });
    expect(days.filter((d) => d.recorded).map((d) => d.date)).toEqual(["2026-08-20"]);
  });

  it("adds up a cow milked twice on one day", () => {
    const days = build({ records: [record("2026-08-21", 2.3), record("2026-08-21", 2.4)] });
    expect(days[2].gallons).toBe(4.7);
  });

  it("counts back by the calendar, so a month boundary is not 30 days of milliseconds", () => {
    expect(dayBefore("2026-08-03", 5)).toBe("2026-07-29");
    expect(dayBefore("2026-01-01", 1)).toBe("2025-12-31");
  });
});

describe("what became of it", () => {
  it("calls a day with a batch still on file on hand, and the rest sold", () => {
    const days = build();
    expect(days.map((d) => d.status)).toEqual(["sold", "sold", "inventory"]);
  });

  it("marks a discarded day even when some of it survived", () => {
    const days = build({ discardedDates: new Set(["2026-08-20"]) });
    expect(days[1].status).toBe("discarded");
    // and the milk is still milk she gave
    expect(days[1].gallons).toBe(4.4);
  });

  it("lets binned beat on hand, so a thrown-away day is never labelled stock", () => {
    const days = build({ liveBatchIds: new Set([12, 13]), discardedDates: new Set(["2026-08-20"]) });
    expect(days[1].status).toBe("discarded");
  });
});

describe("value", () => {
  it("prices a day at the product's current price", () => {
    expect(build()[0].valueCents).toBe(4200);
  });

  it("gives a binned day no value, and remembers what it would have fetched", () => {
    const days = build({ discardedDates: new Set(["2026-08-19"]) });
    expect(days[0].valueCents).toBe(0);
    expect(days[0].lostCents).toBe(4200);
  });

  it("values nothing at all when the farm sells no milk", () => {
    expect(build({ priceCents: 0 })[0].valueCents).toBe(0);
  });
});

describe("the summary", () => {
  it("counts only the days she was milked", () => {
    const summary = summariseMilk(build({ records: [record("2026-08-21", 4.6, 13)] }));
    expect(summary.days).toBe(1);
    expect(summary.gallons).toBe(4.6);
  });

  it("splits takings from stock on hand, and keeps the binned loss apart", () => {
    const summary = summariseMilk(build({ discardedDates: new Set(["2026-08-20"]) }));
    expect(summary.soldCents).toBe(4200);
    expect(summary.onHandGallons).toBe(4.6);
    expect(summary.onHandCents).toBe(4600);
    expect(summary.discardedGallons).toBe(4.4);
    expect(summary.discardedCents).toBe(4400);
  });

  it("never counts a discard as takings", () => {
    // The whole reason lostCents is a separate field: a caller summing
    // valueCents across every day can't accidentally bank the milk that
    // went down the drain.
    const summary = summariseMilk(build({ discardedDates: new Set(["2026-08-19", "2026-08-20"]) }));
    expect(summary.soldCents).toBe(0);
    expect(summary.gallons).toBe(13.2);
  });
});
