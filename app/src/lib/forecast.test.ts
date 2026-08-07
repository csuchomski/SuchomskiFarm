import { describe, expect, it } from "vitest";
import { buildForecast, dailyProductionFromHistory, summarise, weeklyCommitment } from "./forecast";
import type { Schedule } from "./schedules";

// A Friday.
const TODAY = "2026-08-07";

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: over.id ?? 1,
  customer_id: "cust-1",
  product_id: over.product_id ?? 1,
  quantity: over.quantity ?? 4,
  day: over.day ?? "Thursday",
  start_date: "start_date" in over ? over.start_date! : null,
  skipped_dates: over.skipped_dates ?? [],
  fulfilled_dates: over.fulfilled_dates ?? [],
  cancelled_at: over.cancelled_at ?? null,
  business_id: 5,
  note: "",
});

/** `days` days of history at `perDay` each, ending yesterday. */
const history = (perDay: number, days = 14, endBefore = TODAY) => {
  const out: { produced_date: string; quantity: number }[] = [];
  const end = Date.parse(`${endBefore}T00:00:00Z`);
  for (let i = 1; i <= days; i++) {
    out.push({ produced_date: new Date(end - i * 86_400_000).toISOString().slice(0, 10), quantity: perDay });
  }
  return out;
};

describe("dailyProductionFromHistory", () => {
  it("averages over the window", () => {
    expect(dailyProductionFromHistory(history(5), TODAY)).toBe(5);
  });

  it("excludes today, which may only be half recorded", () => {
    // Today's evening milking usually isn't in yet. Counting today would
    // drag the average down every morning and then recover by night.
    const withToday = [...history(5), { produced_date: TODAY, quantity: 1 }];
    expect(dailyProductionFromHistory(withToday, TODAY)).toBe(5);
  });

  it("divides by the whole window, not the days that happen to have rows", () => {
    // Three days of 7 in a 14-day window is 1.5/day, not 7.
    const sparse = [
      { produced_date: "2026-08-04", quantity: 7 },
      { produced_date: "2026-08-05", quantity: 7 },
      { produced_date: "2026-08-06", quantity: 7 },
    ];
    expect(dailyProductionFromHistory(sparse, TODAY)).toBe(1.5);
  });

  it("is null with no history at all, rather than zero", () => {
    // Zero is a claim; null is "I don't know", and the caller says so.
    expect(dailyProductionFromHistory([], TODAY)).toBeNull();
  });

  it("ignores anything older than the window", () => {
    expect(dailyProductionFromHistory([{ produced_date: "2026-01-01", quantity: 999 }], TODAY)).toBeNull();
  });
});

describe("buildForecast", () => {
  const base = {
    productId: 1,
    openingOnHand: 10,
    batches: history(5),
    schedules: [] as Schedule[],
    todayIso: TODAY,
    days: 14,
  };

  it("adds production and takes out standing orders on the right days", () => {
    const f = buildForecast({ ...base, schedules: [sched({ day: "Thursday", quantity: 4 })] });
    const thursday = f.days.find((d) => d.date === "2026-08-13");
    expect(thursday).toMatchObject({ scheduled: 4, production: 5, net: 1 });
    // A day with no pickup is production only.
    expect(f.days.find((d) => d.date === "2026-08-12")).toMatchObject({ scheduled: 0, net: 5 });
  });

  it("runs a balance forward day by day", () => {
    const f = buildForecast({ ...base, openingOnHand: 10, schedules: [] });
    // 10 + 5 a day.
    expect(f.days[0].balance).toBe(15);
    expect(f.days[1].balance).toBe(20);
  });

  it("finds the first day it runs short", () => {
    // No production at all, 8 on hand, 4 a week out on Thursdays: fine on
    // the 13th (4 left), short on the 20th.
    const f = buildForecast({
      ...base,
      openingOnHand: 8,
      batches: [],
      schedules: [sched({ day: "Thursday", quantity: 6 })],
      days: 21,
    });
    expect(f.firstShortfall).toBe("2026-08-20");
    expect(f.worstShortfall).toBeGreaterThan(0);
  });

  it("is never short when production covers the commitment", () => {
    const f = buildForecast({ ...base, schedules: [sched({ day: "Thursday", quantity: 4 })], days: 28 });
    expect(f.firstShortfall).toBeNull();
    expect(f.worstShortfall).toBe(0);
  });

  it("ignores a cancelled standing order", () => {
    const f = buildForecast({
      ...base,
      openingOnHand: 0,
      batches: [],
      schedules: [sched({ quantity: 99, cancelled_at: "2026-08-01T00:00:00Z" })],
    });
    expect(f.firstShortfall).toBeNull();
  });

  it("skips a week the customer skipped", () => {
    const f = buildForecast({
      ...base,
      openingOnHand: 0,
      batches: [],
      schedules: [sched({ day: "Thursday", quantity: 4, skipped_dates: ["2026-08-13"] })],
      days: 10,
    });
    // The 13th is skipped and the 20th is outside a 10-day window.
    expect(f.days.every((d) => d.scheduled === 0)).toBe(true);
  });

  it("ignores another product's standing orders", () => {
    const f = buildForecast({
      ...base,
      openingOnHand: 0,
      batches: [],
      schedules: [sched({ product_id: 99, quantity: 50 })],
    });
    expect(f.firstShortfall).toBeNull();
  });

  it("counts one-off reservations alongside standing orders", () => {
    const f = buildForecast({
      ...base,
      openingOnHand: 2,
      batches: [],
      reservations: [{ date: "2026-08-08", quantity: 3 }],
      days: 5,
    });
    expect(f.days.find((d) => d.date === "2026-08-08")).toMatchObject({ reserved: 3 });
    expect(f.firstShortfall).toBe("2026-08-08");
  });

  it("treats forecast_override as a weekly figure, matching the schema", () => {
    // product_stats() compares forecast_override against a week of
    // production, so 14 a week is 2 a day — not 14.
    const f = buildForecast({ ...base, forecastOverride: 14, batches: [] });
    expect(f.dailyProduction).toBe(2);
    expect(f.basis).toBe("override");
  });

  it("falls back to history when there's no override", () => {
    expect(buildForecast(base).basis).toBe("history");
  });

  it("says it has no basis rather than assuming zero production is a forecast", () => {
    const f = buildForecast({ ...base, batches: [] });
    expect(f.basis).toBe("none");
    expect(f.dailyProduction).toBe(0);
  });

  it("produces exactly the number of days asked for", () => {
    const f = buildForecast({ ...base, days: 30 });
    expect(f.days).toHaveLength(30);
    expect(f.days[0].date).toBe(TODAY);
    expect(f.days[29].date).toBe("2026-09-05");
  });

  it("totals what's promised across the window", () => {
    const f = buildForecast({ ...base, schedules: [sched({ day: "Thursday", quantity: 4 })], days: 28 });
    // Thursdays on the 13th, 20th, 27th and Sep 3rd.
    expect(f.totalScheduled).toBe(16);
  });
});

describe("summarise", () => {
  const base = {
    productId: 1,
    openingOnHand: 10,
    batches: history(5),
    schedules: [] as Schedule[],
    todayIso: TODAY,
    days: 14,
  };

  it("says when it's covered", () => {
    expect(summarise(buildForecast(base), "gallons")).toMatch(/Covered for the next 14 days/);
  });

  it("keeps the day it goes short apart from how deep it gets", () => {
    // Two Thursdays fall in a 14-day window from the 7th, so the hole is 6
    // on the 13th and 12 by the 20th. Reporting "12 by the 13th" would be
    // wrong; both numbers are real and they are not the same number.
    const f = buildForecast({
      ...base,
      openingOnHand: 0,
      batches: [],
      schedules: [sched({ day: "Thursday", quantity: 6 })],
    });
    expect(f.firstShortfall).toBe("2026-08-13");
    expect(f.worstShortfall).toBe(12);
    expect(summarise(f, "gallons")).toMatch(/Runs short on 2026-08-13, down 12 gallons at the worst/);
  });

  it("admits when it has nothing to go on", () => {
    const f = buildForecast({ ...base, batches: [] });
    expect(summarise(f, "gallons")).toMatch(/No production recorded/);
  });
});

describe("weeklyCommitment", () => {
  it("totals every active standing order for the product", () => {
    const total = weeklyCommitment(
      [sched({ id: 1, quantity: 4 }), sched({ id: 2, quantity: 2 }), sched({ id: 3, product_id: 99, quantity: 50 })],
      1,
    );
    expect(total).toBe(6);
  });

  it("leaves out cancelled ones", () => {
    const total = weeklyCommitment(
      [sched({ id: 1, quantity: 4 }), sched({ id: 2, quantity: 9, cancelled_at: "2026-08-01T00:00:00Z" })],
      1,
    );
    expect(total).toBe(4);
  });

  it("is zero with nothing on the books", () => {
    expect(weeklyCommitment([], 1)).toBe(0);
  });
});
