import { describe, expect, it } from "vitest";
import { typeMap, type RealTransaction, type TransactionType } from "./books-data";
import { buildForecast } from "./forecast";
import type { Schedule } from "./schedules";
import {
  addDays,
  averageWeeklyPayments,
  orderReceipts,
  projectCash,
  summariseCash,
  weekLabel,
} from "./cash-forecast";

/**
 * The thirteen-week rolling cash forecast.
 *
 * The report exists to answer one question — which week do I run out — so
 * the tests are mostly about not answering it optimistically.
 */

const TODAY = "2026-08-26";

const TYPES: TransactionType[] = [
  { code: "income", label: "Income", direction: "income", active: true, sort_order: 10 },
  { code: "expense", label: "Expense", direction: "expense", active: true, sort_order: 20 },
  { code: "transfer", label: "Transfer", direction: "neutral", active: true, sort_order: 30 },
];
const types = typeMap(TYPES);

const tx = (over: Partial<RealTransaction> = {}): RealTransaction => ({
  id: over.id ?? 1,
  business_id: 5,
  date: over.date ?? "2026-08-01",
  type: over.type ?? "expense",
  category: "Feed",
  amount: over.amount ?? 100,
  note: null,
  payer: "Co-op",
  account: "Landmark CU - Farm",
});

/** Typed, not cast. A `as Schedule` here is what lets a fixture drift out
 * of shape with the thing it stands in for and still compile. */
const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: 1,
  customer_id: "c1",
  product_id: 1,
  quantity: 2,
  // 2026-08-26 is a Wednesday, so a Thursday order falls the next day.
  day: "Thursday",
  start_date: null,
  skipped_dates: [],
  fulfilled_dates: [],
  cancelled_at: null,
  business_id: 5,
  note: "",
  ...over,
});

/** Milk at $10. A product with no price returns null. */
const priceOf = (id: number) => (id === 1 ? 10 : id === 3 ? 7 : null);

const base = {
  todayIso: TODAY,
  openingCash: 1000,
  forecasts: [],
  priceOf,
  schedules: [],
  receipts: [],
  weeklyPayments: null,
  weeks: 13,
};

describe("what is owed on open orders", () => {
  it("counts a reserved order and ignores a completed or cancelled one", () => {
    // The live ledger has a cancelled order still carrying a $20 total with
    // nothing paid. Filtering on "not completed" would forecast money that
    // nobody owes — which is exactly the mistake worth a test.
    const { receipts } = orderReceipts(
      [
        { status: "reserved", reserved_date: "2026-08-28", total_cost: 20, amount_paid: null },
        { status: "cancelled", reserved_date: "2026-08-28", total_cost: 20, amount_paid: null },
        { status: "completed", reserved_date: "2026-08-28", total_cost: 50, amount_paid: 50 },
      ],
      TODAY,
    );
    expect(receipts).toEqual([{ dueDate: "2026-08-28", owed: 20 }]);
  });

  it("nets off what has already been part-paid", () => {
    const { receipts } = orderReceipts(
      [{ status: "reserved", reserved_date: "2026-08-28", total_cost: 50, amount_paid: 20 }],
      TODAY,
    );
    expect(receipts[0].owed).toBe(30);
  });

  it("counts an order with no price rather than inventing one", () => {
    // Several live orders carry quantity and no total_cost. Guessing from
    // today's price would be a figure nobody agreed to; reporting the gap
    // lets the page say the forecast is incomplete.
    const { receipts, unpriced } = orderReceipts(
      [{ status: "reserved", reserved_date: "2026-08-28", total_cost: null, amount_paid: null }],
      TODAY,
    );
    expect(receipts).toEqual([]);
    expect(unpriced).toBe(1);
  });

  it("pulls an overdue pickup into this week rather than dropping it", () => {
    // Still open, still owed. A date in the past would bucket outside the
    // window and the money would vanish off the forecast.
    const { receipts } = orderReceipts(
      [{ status: "reserved", reserved_date: "2026-07-01", total_cost: 40, amount_paid: null }],
      TODAY,
    );
    expect(receipts[0].dueDate).toBe(TODAY);
  });
});

describe("outgoings, averaged from history", () => {
  it("divides by the whole window, not by the weeks that had entries", () => {
    // A quiet fortnight is part of the rate. Dividing by active weeks would
    // overstate what a normal week costs and invent a shortfall.
    const spent = [tx({ id: 1, date: "2026-08-01", amount: 130 }), tx({ id: 2, date: "2026-08-10", amount: 130 })];
    expect(averageWeeklyPayments(spent, types, TODAY, 13)).toBe(20);
  });

  it("ignores income and transfers", () => {
    const rows = [
      tx({ id: 1, date: "2026-08-01", type: "expense", amount: 130 }),
      tx({ id: 2, date: "2026-08-02", type: "income", amount: 9999 }),
      tx({ id: 3, date: "2026-08-03", type: "transfer", amount: 9999 }),
    ];
    expect(averageWeeklyPayments(rows, types, TODAY, 13)).toBe(10);
  });

  it("says it has nothing rather than returning zero", () => {
    // Zero would read as "this business spends nothing", which is a claim.
    expect(averageWeeklyPayments([], types, TODAY)).toBeNull();
  });

  it("leaves out anything older than the window", () => {
    expect(averageWeeklyPayments([tx({ date: "2025-01-01", amount: 500 })], types, TODAY, 13)).toBeNull();
  });
});

describe("the run of weeks", () => {
  it("closes each week where the next one opens", () => {
    const f = projectCash({ ...base, weeklyPayments: 100, weeks: 4 });
    expect(f.weeks.map((w) => [w.opening, w.closing])).toEqual([
      [1000, 900],
      [900, 800],
      [800, 700],
      [700, 600],
    ]);
  });

  it("buckets a standing order into the week it falls in, at price", () => {
    // Thursday, 2 gallons at $10. One pickup a week, every week.
    const f = projectCash({ ...base, schedules: [schedule()], weeks: 3 });
    expect(f.weeks.map((w) => w.standing)).toEqual([20, 20, 20]);
    expect(f.totalStanding).toBe(60);
  });

  it("counts a product with no price as nothing, not as zero dollars of sales", () => {
    // Product 4 has no price. It must not quietly contribute $0 alongside
    // priced products as though somebody decided it was free.
    const f = projectCash({ ...base, schedules: [schedule({ product_id: 4 })], weeks: 2 });
    expect(f.totalStanding).toBe(0);
  });

  it("puts money owed into the week the pickup is due", () => {
    const f = projectCash({
      ...base,
      receipts: [
        { dueDate: "2026-08-27", owed: 20 },
        { dueDate: "2026-09-10", owed: 30 },
      ],
      weeks: 4,
    });
    expect(f.weeks.map((w) => w.reserved)).toEqual([20, 0, 30, 0]);
  });

  it("names the first week it runs short, and how deep it gets later", () => {
    // Two different numbers on purpose, the same way the product forecast
    // keeps them apart: the week it first goes under, and the worst point.
    const f = projectCash({ ...base, openingCash: 250, weeklyPayments: 100, weeks: 4 });
    expect(f.weeks.map((w) => w.closing)).toEqual([150, 50, -50, -150]);
    expect(f.firstShortWeek).toBe(addDays(TODAY, 14));
    expect(f.worstShortfall).toBe(150);
  });

  it("never reports a shortfall when it stays above zero", () => {
    const f = projectCash({ ...base, weeklyPayments: 10, weeks: 4 });
    expect(f.firstShortWeek).toBeNull();
    expect(f.worstShortfall).toBe(0);
  });
});

describe("committed and expected are kept apart", () => {
  /** 7 gallons a day produced, 2 promised on Thursdays. */
  const producing = () =>
    buildForecast({
      productId: 1,
      openingOnHand: 0,
      batches: [{ produced_date: addDays(TODAY, -1), quantity: 98 }],
      schedules: [schedule()],
      todayIso: TODAY,
      days: 91,
    });

  it("leaves unsold production out of the running balance", () => {
    // The one thing this report must never do is say you are fine when the
    // money is only fine if every gallon finds a buyer.
    const f = projectCash({ ...base, forecasts: [producing()], schedules: [schedule()], weeks: 2 });

    expect(f.weeks[0].expected).toBeGreaterThan(0);
    // Closing moved by the committed standing order only: $20 a week.
    expect(f.weeks[0].closing).toBe(1020);
    expect(f.weeks[1].closing).toBe(1040);
  });

  it("shows where the balance would land if it all sold", () => {
    const f = projectCash({ ...base, forecasts: [producing()], schedules: [schedule()], weeks: 2 });
    expect(f.weeks[0].closingWithExpected).toBe(round(1020 + f.weeks[0].expected));
    // And it compounds across weeks rather than restating one week's gain.
    expect(f.weeks[1].closingWithExpected).toBe(
      round(1040 + f.weeks[0].expected + f.weeks[1].expected),
    );
  });

  it("does not count a promised gallon twice", () => {
    // The 2 gallons on the standing order are committed revenue. They must
    // not also appear as expected surplus.
    const f = projectCash({ ...base, forecasts: [producing()], schedules: [schedule()], weeks: 1 });
    // 7/day x 7 days = 49 produced; 2 promised. 47 spare at $10.
    expect(f.weeks[0].standing).toBe(20);
    expect(f.weeks[0].expected).toBe(470);
  });

  it("does not let a short day cancel out another day's surplus", () => {
    // A day with nothing spare is a day with nothing to sell, not a credit
    // against the day before it.
    const heavy = buildForecast({
      productId: 1,
      openingOnHand: 0,
      batches: [{ produced_date: addDays(TODAY, -1), quantity: 14 }],
      // 1/day produced, 20 promised on one day: that day is deeply short.
      schedules: [schedule({ quantity: 20 })],
      todayIso: TODAY,
      days: 7,
    });
    const f = projectCash({ ...base, forecasts: [heavy], schedules: [], weeks: 1 });
    // Six days of 1 gallon spare at $10. The short day contributes 0, not −190.
    expect(f.weeks[0].expected).toBe(60);
  });
});

describe("what it says out loud", () => {
  it("leads with the shortfall even when it has no payments history", () => {
    const f = projectCash({ ...base, openingCash: -50, weeklyPayments: null, weeks: 2 });
    const said = summariseCash(f);
    expect(said).toMatch(/^Runs short in the week of/);
    expect(said).toMatch(/counts money coming in and nothing going out/);
  });

  it("says it is covered when it is", () => {
    expect(summariseCash(projectCash({ ...base, weeklyPayments: 10, weeks: 13 }))).toMatch(
      /Covered for the next 13 weeks on what is already committed/,
    );
  });

  it("labels where the payments figure came from", () => {
    expect(projectCash({ ...base, weeklyPayments: 40 }).paymentsBasis).toBe("history");
    expect(projectCash({ ...base, weeklyPayments: null }).paymentsBasis).toBe("none");
  });
});

describe("week labels", () => {
  it("does not repeat the month inside one week", () => {
    expect(weekLabel("2026-08-03", "2026-08-09")).toBe("Aug 3 – 9");
  });

  it("names both months when the week crosses one", () => {
    expect(weekLabel("2026-08-26", "2026-09-01")).toBe("Aug 26 – Sep 1");
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
