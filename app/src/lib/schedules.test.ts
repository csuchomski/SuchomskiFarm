import { describe, expect, it } from "vitest";
import {
  isActive,
  isHeld,
  nextPickup,
  occurrencesBetween,
  untilLabel,
  validateSchedule,
  type Schedule,
} from "./schedules";

// 2026-08-07 is a Friday.
const TODAY = "2026-08-07";

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: over.id ?? 1,
  customer_id: over.customer_id ?? "cust-1",
  product_id: over.product_id ?? 1,
  quantity: over.quantity ?? 4,
  day: over.day ?? "Thursday",
  start_date: "start_date" in over ? over.start_date! : null,
  skipped_dates: over.skipped_dates ?? [],
  fulfilled_dates: over.fulfilled_dates ?? [],
  cancelled_at: over.cancelled_at ?? null,
  business_id: over.business_id ?? 5,
  note: over.note ?? "",
});

describe("nextPickup", () => {
  it("finds the coming Thursday", () => {
    // Friday the 7th -> Thursday the 13th.
    expect(nextPickup(sched({ day: "Thursday" }), TODAY)).toBe("2026-08-13");
  });

  it("returns today when today is the day", () => {
    // The 13th is itself a Thursday.
    expect(nextPickup(sched({ day: "Thursday" }), "2026-08-13")).toBe("2026-08-13");
  });

  it("waits for the start date", () => {
    expect(nextPickup(sched({ day: "Thursday", start_date: "2026-09-01" }), TODAY)).toBe("2026-09-03");
  });

  it("ignores a start date already passed", () => {
    expect(nextPickup(sched({ day: "Thursday", start_date: "2026-01-01" }), TODAY)).toBe("2026-08-13");
  });

  it("jumps a skipped week", () => {
    expect(nextPickup(sched({ day: "Thursday", skipped_dates: ["2026-08-13"] }), TODAY)).toBe("2026-08-20");
  });

  it("jumps several consecutive skips", () => {
    const s = sched({ day: "Thursday", skipped_dates: ["2026-08-13", "2026-08-20"] });
    expect(nextPickup(s, TODAY)).toBe("2026-08-27");
  });

  it("jumps a week already collected", () => {
    // Fulfilled and skipped behave the same: that week is done with.
    expect(nextPickup(sched({ day: "Thursday", fulfilled_dates: ["2026-08-13"] }), TODAY)).toBe("2026-08-20");
  });

  it("handles every weekday", () => {
    expect(nextPickup(sched({ day: "Friday" }), TODAY)).toBe("2026-08-07");
    expect(nextPickup(sched({ day: "Saturday" }), TODAY)).toBe("2026-08-08");
    expect(nextPickup(sched({ day: "Sunday" }), TODAY)).toBe("2026-08-09");
    expect(nextPickup(sched({ day: "Monday" }), TODAY)).toBe("2026-08-10");
  });

  it("crosses a month and a year boundary", () => {
    expect(nextPickup(sched({ day: "Friday" }), "2026-12-29")).toBe("2027-01-01");
  });

  it("is null for a weekday the database wouldn't recognise", () => {
    // next_pickup_date() returns null for this too; picking Sunday instead
    // would put a standing order on a day nobody agreed to.
    expect(nextPickup(sched({ day: "Thurs" }), TODAY)).toBeNull();
  });
});

describe("occurrencesBetween", () => {
  it("lists every weekly pickup in the window", () => {
    const dates = occurrencesBetween(sched({ day: "Thursday" }), TODAY, "2026-09-03");
    expect(dates).toEqual(["2026-08-13", "2026-08-20", "2026-08-27", "2026-09-03"]);
  });

  it("leaves out skipped and fulfilled weeks", () => {
    const s = sched({ day: "Thursday", skipped_dates: ["2026-08-20"], fulfilled_dates: ["2026-08-13"] });
    expect(occurrencesBetween(s, TODAY, "2026-09-03")).toEqual(["2026-08-27", "2026-09-03"]);
  });

  it("is empty for a cancelled standing order", () => {
    expect(occurrencesBetween(sched({ cancelled_at: "2026-08-01T00:00:00Z" }), TODAY, "2026-12-01")).toEqual([]);
  });

  it("respects a future start date", () => {
    const s = sched({ day: "Thursday", start_date: "2026-08-25" });
    expect(occurrencesBetween(s, TODAY, "2026-09-10")).toEqual(["2026-08-27", "2026-09-03", "2026-09-10"]);
  });

  it("includes the last day when it is a pickup day", () => {
    expect(occurrencesBetween(sched({ day: "Thursday" }), TODAY, "2026-08-13")).toEqual(["2026-08-13"]);
  });

  it("is empty when the window ends before the first pickup", () => {
    expect(occurrencesBetween(sched({ day: "Thursday" }), TODAY, "2026-08-12")).toEqual([]);
  });

  it("is empty when the range runs backwards", () => {
    expect(occurrencesBetween(sched(), "2026-09-01", "2026-08-01")).toEqual([]);
  });
});

describe("isHeld", () => {
  it("holds stock once the pickup is inside three days", () => {
    // Monday the 10th, pickup Thursday the 13th — exactly three days.
    expect(isHeld(sched({ day: "Thursday" }), "2026-08-10")).toBe(true);
  });

  it("doesn't hold stock four days out", () => {
    // A week-long hold was blocking the shop from the previous Friday.
    expect(isHeld(sched({ day: "Thursday" }), "2026-08-09")).toBe(false);
  });

  it("holds nothing for a cancelled standing order", () => {
    expect(isHeld(sched({ day: "Thursday", cancelled_at: "2026-08-01T00:00:00Z" }), "2026-08-10")).toBe(false);
  });

  it("holds nothing for a skipped week", () => {
    const s = sched({ day: "Thursday", skipped_dates: ["2026-08-13"] });
    expect(isHeld(s, "2026-08-10")).toBe(false);
  });
});

describe("untilLabel", () => {
  it("reads naturally near the day", () => {
    expect(untilLabel("2026-08-07", TODAY)).toBe("today");
    expect(untilLabel("2026-08-08", TODAY)).toBe("tomorrow");
    expect(untilLabel("2026-08-13", TODAY)).toBe("in 6 days");
  });

  it("says so when there's no next pickup", () => {
    expect(untilLabel(null, TODAY)).toBe("no next pickup");
  });
});

describe("isActive", () => {
  it("is false once cancelled", () => {
    expect(isActive(sched())).toBe(true);
    expect(isActive(sched({ cancelled_at: "2026-08-01T00:00:00Z" }))).toBe(false);
  });
});

describe("validateSchedule", () => {
  const base = {
    productId: "1",
    customerId: "cust-1",
    quantity: "4",
    day: "Thursday",
    startDate: "",
    todayIso: TODAY,
  };

  it("accepts a normal standing order", () => {
    expect(validateSchedule(base)).toBeNull();
  });

  it("needs a customer, a product and a real weekday", () => {
    expect(validateSchedule({ ...base, customerId: "" })).toMatch(/Who is this standing order for/);
    expect(validateSchedule({ ...base, productId: "" })).toMatch(/Pick a product/);
    expect(validateSchedule({ ...base, day: "Thurs" })).toMatch(/day of the week/);
  });

  it("rejects zero, which the database refuses too", () => {
    expect(validateSchedule({ ...base, quantity: "0" })).toMatch(/above zero/);
    expect(validateSchedule({ ...base, quantity: "-2" })).toMatch(/above zero/);
  });

  it("rejects a start date in the past", () => {
    expect(validateSchedule({ ...base, startDate: "2026-01-01" })).toMatch(/in the past/);
  });

  it("accepts starting today", () => {
    expect(validateSchedule({ ...base, startDate: TODAY })).toBeNull();
  });
});

describe("nextPickup agrees with the database", () => {
  /**
   * These are not invented expectations — they are the values
   * public.next_pickup_date() actually returned for the same inputs, run
   * against the live function on 2026-08-07 (a Friday, matching TODAY).
   *
   * The two implementations exist for different reasons: the database uses
   * its copy to decide what stock to hold, and this file uses its copy to
   * project forward for the forecast. If they drift, the forecast promises
   * milk the database has already given away. This is the guard.
   */
  const fromDatabase: [string, Partial<Schedule>, string | null][] = [
    ["coming Thursday", { day: "Thursday" }, "2026-08-13"],
    ["start in future", { day: "Thursday", start_date: "2026-09-01" }, "2026-09-03"],
    ["start in past", { day: "Thursday", start_date: "2026-01-01" }, "2026-08-13"],
    ["one skip", { day: "Thursday", skipped_dates: ["2026-08-13"] }, "2026-08-20"],
    ["two skips", { day: "Thursday", skipped_dates: ["2026-08-13", "2026-08-20"] }, "2026-08-27"],
    ["fulfilled week", { day: "Thursday", fulfilled_dates: ["2026-08-13"] }, "2026-08-20"],
    ["today is Friday", { day: "Friday" }, "2026-08-07"],
    ["Saturday", { day: "Saturday" }, "2026-08-08"],
    ["Sunday", { day: "Sunday" }, "2026-08-09"],
    ["Monday", { day: "Monday" }, "2026-08-10"],
    ["bad weekday", { day: "Thurs" }, null],
  ];

  it.each(fromDatabase)("matches the database for %s", (_label, over, expected) => {
    expect(nextPickup(sched(over), TODAY)).toBe(expected);
  });
});
