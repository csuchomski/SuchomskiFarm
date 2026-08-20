// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The shop's three tabs. They existed before this as inert divs at the
 * bottom of the page — three labels that looked like navigation and did
 * nothing, with `activeTab` a prop nobody ever passed. Nothing failed;
 * they simply weren't wired, which is the class of thing a unit test can't
 * see and a render test can.
 */

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1", email: "meghan@example.com" } }, loading: false }),
  signOut: vi.fn(),
}));

const products = [
  { id: 1, name: "Milk", unit: "gallon", price: 10, business_id: 5, available: 4, type_code: "milk" },
  { id: 3, name: "Eggs", unit: "dozen", price: 7, business_id: 5, available: 0, type_code: "eggs" },
];

/**
 * What public.schedule_capacity returns, per product. Milk grows through the
 * week as production lands; Friday is deliberately flat at 0.3 — under a
 * single half gallon, so that day has nothing to offer at all.
 */
const capacity: Record<number, { weekday: string; pickupDate: string; available: number }[]> = {
  1: [
    { weekday: "Saturday", pickupDate: "2026-08-08", available: 2 },
    { weekday: "Sunday", pickupDate: "2026-08-09", available: 3.2 },
    { weekday: "Monday", pickupDate: "2026-08-10", available: 6 },
    { weekday: "Tuesday", pickupDate: "2026-08-11", available: 6 },
    { weekday: "Wednesday", pickupDate: "2026-08-12", available: 6 },
    { weekday: "Thursday", pickupDate: "2026-08-13", available: 1.5 },
    { weekday: "Friday", pickupDate: "2026-08-14", available: 0.3 },
  ],
  3: [
    { weekday: "Saturday", pickupDate: "2026-08-08", available: 1 },
    { weekday: "Sunday", pickupDate: "2026-08-09", available: 1.4 },
    { weekday: "Monday", pickupDate: "2026-08-10", available: 1.8 },
    { weekday: "Tuesday", pickupDate: "2026-08-11", available: 2.2 },
    { weekday: "Wednesday", pickupDate: "2026-08-12", available: 2.7 },
    { weekday: "Thursday", pickupDate: "2026-08-13", available: 3.1 },
    { weekday: "Friday", pickupDate: "2026-08-14", available: 3.5 },
  ],
};

const fetchScheduleCapacity = vi.fn(async (productId: number) => capacity[productId] ?? null);
type CreateInput = Parameters<typeof import("../lib/schedules").createSchedule>[0];
const createSchedule = vi.fn(async (_input: CreateInput) => ({}) as never);

const orders = [
  {
    id: 12,
    product_id: 1,
    quantity: 2,
    status: "reserved",
    reserved_date: "2026-08-05T12:00:00Z",
    picked_up_date: null,
    cancelled_date: null,
    unit_price: 10,
    total_cost: 20,
    amount_paid: null,
    payment_method: null,
  },
  {
    id: 9,
    product_id: 1,
    quantity: 1.5,
    status: "completed",
    reserved_date: "2026-06-10T00:00:00Z",
    picked_up_date: "2026-06-24T17:00:00Z",
    cancelled_date: null,
    unit_price: 10,
    total_cost: 15,
    amount_paid: 15,
    payment_method: "Cash",
  },
  // Same day as order 9, so one heading covers two rows and has a subtotal
  // worth showing. Reserved earlier than 9 but collected the same day —
  // grouping goes on when it finished, not when it was reserved.
  {
    id: 10,
    product_id: 3,
    quantity: 1,
    status: "completed",
    reserved_date: "2026-06-02T00:00:00Z",
    picked_up_date: "2026-06-24T20:00:00Z",
    cancelled_date: null,
    unit_price: 7,
    total_cost: 7,
    amount_paid: 7,
    payment_method: "Venmo",
  },
  // Collected, part paid — $20 of milk against $12 handed over.
  {
    id: 8,
    product_id: 1,
    quantity: 2,
    status: "completed",
    reserved_date: "2026-06-01T00:00:00Z",
    picked_up_date: "2026-06-03T17:00:00Z",
    cancelled_date: null,
    unit_price: 10,
    total_cost: 20,
    amount_paid: 12,
    payment_method: "Check",
  },
  // Collected before the store priced anything. Four real orders look like
  // this, and "$0.00" would be a claim rather than a blank.
  {
    id: 7,
    product_id: 1,
    quantity: 4,
    status: "completed",
    reserved_date: "2026-05-01T00:00:00Z",
    picked_up_date: "2026-05-02T17:00:00Z",
    cancelled_date: null,
    unit_price: null,
    total_cost: null,
    amount_paid: null,
    payment_method: null,
  },
  {
    id: 6,
    product_id: 3,
    quantity: 1,
    status: "cancelled",
    reserved_date: "2026-05-20T00:00:00Z",
    picked_up_date: null,
    cancelled_date: "2026-05-21T17:00:00Z",
    unit_price: null,
    total_cost: null,
    amount_paid: null,
    payment_method: null,
  },
];

vi.mock("../lib/customer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/customer")>()),
  fetchShop: vi.fn(async () => products),
  fetchMyOrders: vi.fn(async () => orders),
  fetchProfile: vi.fn(async () => ({
    id: "u1",
    first_name: "Meghan",
    last_name: "Suchomski",
    email: "meghan@example.com",
    phone: "555-0100",
    role: "buyer",
  })),
}));

/**
 * Two standing orders, pinned to the day the test actually runs rather than
 * to a literal weekday: one due today (inside the three-day hold, so
 * collectable) and one four days out (outside it, so not). Faking the clock
 * would be the other way to do this, and it fights the async render.
 */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const todayIso = new Date().toISOString().slice(0, 10);
const todayIndex = new Date(`${todayIso}T00:00:00Z`).getUTCDay();

const scheduleBase = {
  customer_id: "u1",
  product_id: 1,
  start_date: null,
  skipped_dates: [],
  fulfilled_dates: [],
  cancelled_at: null,
  business_id: 5,
  note: "",
};

const dueToday = { ...scheduleBase, id: 1, quantity: 4, day: WEEKDAY_NAMES[todayIndex] };
const notDueYet = { ...scheduleBase, id: 2, quantity: 3, day: WEEKDAY_NAMES[(todayIndex + 4) % 7] };

type FulfilInput = Parameters<typeof import("../lib/schedules").fulfilPickup>[0];
const fulfilPickup = vi.fn(async (_input: FulfilInput) => 99);

vi.mock("../lib/schedules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/schedules")>()),
  fetchMySchedules: vi.fn(async () => [dueToday, notDueYet]),
  fulfilPickup: (input: FulfilInput) => fulfilPickup(input),
  fetchScheduleCapacity: (productId: number) => fetchScheduleCapacity(productId),
  createSchedule: (input: CreateInput) => createSchedule(input),
}));

type CompleteInput = Parameters<typeof import("../lib/orders").completePickup>[0];
const completePickup = vi.fn(async (_input: CompleteInput) => undefined);

vi.mock("../lib/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orders")>()),
  completePickup: (input: CompleteInput) => completePickup(input),
}));

vi.mock("../lib/payment-methods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/payment-methods")>()),
  // The shop spans businesses, so the storefront reads every shop's methods
  // and picks the seller's at collection. Rocky Ridge's Zelle is here to be
  // left out: offering it on a Suchomski pickup is what the database's
  // composite key now refuses.
  fetchShopPaymentMethods: vi.fn(async () => [
    { code: "Cash", label: "Cash", active: true, sort_order: 10, business_id: 5 },
    { code: "Venmo", label: "Venmo", active: true, sort_order: 20, business_id: 5 },
    { code: "Check", label: "Check", active: true, sort_order: 30, business_id: 5 },
    { code: "Zelle", label: "Zelle", active: true, sort_order: 10, business_id: 13 },
  ]),
}));

afterEach(() => {
  cleanup();
  completePickup.mockClear();
  fulfilPickup.mockClear();
  createSchedule.mockClear();
  fetchScheduleCapacity.mockClear();
});

const mount = async () => {
  const { default: CustomerStore } = await import("./CustomerStore");
  render(<CustomerStore />);
  await screen.findByText("Fresh today");
};

describe("Shop tabs", () => {
  it("opens on Store, showing what's for sale", async () => {
    await mount();
    expect(screen.getByRole("button", { name: /Store/ })).toBeTruthy();
    expect(screen.getAllByText("Milk").length).toBeGreaterThan(0);
    // Pickup and Account content is not on screen yet.
    expect(screen.queryByText("History")).toBeNull();
  });

  it("puts reserved and scheduled items on Pickup, not on Store", async () => {
    await mount();
    // The open order and the weekly pickup both belong to Pickup.
    expect(screen.queryByText("Every week")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Pickup/ }));
    expect(screen.getByText("Every week")).toBeTruthy();
    expect(screen.getByText("Your pickups")).toBeTruthy();
    // And the store's product list is gone.
    expect(screen.queryByText("Fresh today")).toBeNull();
  });

  it("counts what's waiting on the Pickup tab", async () => {
    await mount();
    // One open order plus two standing orders.
    const pickup = screen.getByRole("button", { name: /Pickup/ });
    expect(pickup.textContent).toContain("3");
  });

  it("shows account details and history on Account", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));

    expect(screen.getByText("Meghan Suchomski")).toBeTruthy();
    expect(screen.getByText("meghan@example.com")).toBeTruthy();
    expect(screen.getByText("555-0100")).toBeTruthy();
    // Four collected orders: $15 + $7 + $20, and one that was never priced.
    expect(screen.getByText(/4 orders · \$42\.00/)).toBeTruthy();
    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("puts what each past order cost on the history row", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));

    const rows = [...document.querySelectorAll(".shop-pickup")].map((r) => r.textContent ?? "");

    // Paid in full: the cost, and what it was paid by. The date isn't on the
    // row any more — it's the heading over the group.
    expect(rows.some((t) => t.includes("Cash") && t.includes("$15.00"))).toBe(true);

    // Part paid: the cost, plus what's still outstanding.
    const short = rows.find((t) => t.includes("$20.00"));
    expect(short).toBeTruthy();
    expect(short).toContain("Check");
    expect(short).toContain("$8.00 still owed");

    // Never priced: a dash, not $0.00 — those are different claims.
    const unpriced = rows.find((t) => t.startsWith("4 gallon milk"));
    expect(unpriced).toContain("—");
    expect(unpriced).not.toContain("$");

    // Cancelled: nothing was collected, so there's no cost to show.
    const cancelled = rows.find((t) => t.includes("Cancelled"));
    expect(cancelled).toBeTruthy();
    expect(cancelled).not.toContain("$");
  });

  it("groups history under one heading per day, newest first", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));

    const days = [...document.querySelectorAll(".shop-history__day")];
    // 24 June (two orders), 3 June, 21 May, 2 May.
    expect(days.length).toBe(4);

    // Matched on the parts rather than the whole string: the label is
    // formatted in the viewer's locale, so "June 24" and "24 June" are both
    // correct and neither is worth pinning.
    const labels = days.map((d) => d.querySelector(".shop-history__heading .eyebrow")?.textContent ?? "");
    expect(labels[0]).toMatch(/June.*24|24.*June/);
    expect(labels[1]).toMatch(/June.*3|3.*June/);
    expect(labels[2]).toMatch(/May.*21|21.*May/);
    expect(labels[3]).toMatch(/May.*2|2.*May/);

    const totals = days.map((d) => d.querySelector(".shop-history__day-total")?.textContent ?? null);

    // The day with two pickups carries both, and totals them: $15 + $7.
    expect(days[0].querySelectorAll(".shop-pickup").length).toBe(2);
    expect(totals[0]).toBe("$22.00");

    // A day whose only order was cancelled has nothing to total.
    expect(days[2].textContent).toContain("Cancelled");
    expect(totals[2]).toBeNull();
  });

  it("goes back to Store when the tab is pressed again", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Account/ }));
    expect(screen.queryByText("Fresh today")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Store/ }));
    expect(screen.getByText("Fresh today")).toBeTruthy();
  });

  it("marks the current tab for assistive tech", async () => {
    await mount();
    expect(screen.getByRole("button", { name: /Store/ }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: /Pickup/ }));
    expect(screen.getByRole("button", { name: /Pickup/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /Store/ }).getAttribute("aria-current")).toBeNull();
  });
});

/**
 * Completing a pickup from the customer's side. These press the controls
 * rather than only looking for them: the tabs themselves shipped once as
 * labels that rendered perfectly and did nothing, and only a test that
 * clicks can tell the difference.
 */
describe("Collecting an order", () => {
  const openPickupTab = async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: /Pickup/ }));
  };

  it("offers what the farm selling it takes, and nothing another farm takes", async () => {
    // Check is here because migration 022 put it in the table. Zelle is not,
    // because it belongs to Rocky Ridge and this is a Suchomski pickup — the
    // shop spans businesses but a payment does not, and the composite key on
    // orders.payment_method would refuse it at the moment of collection.
    await openPickupTab();
    fireEvent.click(screen.getAllByRole("button", { name: "I've picked this up" })[0]);

    const select = screen.getByLabelText("How you paid") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["", "Cash", "Venmo", "Check"]);
  });

  it("sends the quantity, the method and the money the price implies", async () => {
    await openPickupTab();
    // The order card comes after the standing orders; it's for 2 gallons.
    const buttons = screen.getAllByRole("button", { name: "I've picked this up" });
    fireEvent.click(buttons[buttons.length - 1]);

    // Pre-filled with the whole order, and priced at $10 a gallon.
    expect((screen.getByLabelText("Quantity of Milk picked up") as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("That's $20.00.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("How you paid"), { target: { value: "Check" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup" }));

    await waitFor(() => expect(completePickup).toHaveBeenCalledTimes(1));
    expect(completePickup).toHaveBeenCalledWith({
      orderId: 12,
      finalQuantity: 2,
      paymentMethod: "Check",
      amountPaid: 20,
    });
  });

  it("reprices a short pickup and says where the rest goes", async () => {
    await openPickupTab();
    const buttons = screen.getAllByRole("button", { name: "I've picked this up" });
    fireEvent.click(buttons[buttons.length - 1]);

    fireEvent.change(screen.getByLabelText("Quantity of Milk picked up"), { target: { value: "1.5" } });
    expect(screen.getByText(/That's \$15\.00\. 0\.5 gallon goes back on the shelf\./)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("How you paid"), { target: { value: "Cash" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup" }));

    await waitFor(() => expect(completePickup).toHaveBeenCalledTimes(1));
    expect(completePickup.mock.calls[0][0]).toMatchObject({ finalQuantity: 1.5, amountPaid: 15 });
  });

  it("won't submit without a payment method, or for more than was ordered", async () => {
    await openPickupTab();
    const buttons = screen.getAllByRole("button", { name: "I've picked this up" });
    fireEvent.click(buttons[buttons.length - 1]);

    // The method starts unchosen, so the button is held until it's answered.
    expect(screen.getByText("How did you pay?")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm pickup" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("How you paid"), { target: { value: "Cash" } });
    fireEvent.change(screen.getByLabelText("Quantity of Milk picked up"), { target: { value: "9" } });
    expect(screen.getByText(/This is for 2\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm pickup" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup" }));
    expect(completePickup).not.toHaveBeenCalled();
  });

  it("collects a standing order only once its stock is being held", async () => {
    await openPickupTab();
    // Two standing orders, one open order — but only the one due today and
    // the open order can be collected.
    expect(screen.getAllByRole("button", { name: "I've picked this up" }).length).toBe(2);

    fireEvent.click(screen.getAllByRole("button", { name: "I've picked this up" })[0]);
    fireEvent.change(screen.getByLabelText("How you paid"), { target: { value: "Venmo" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup" }));

    await waitFor(() => expect(fulfilPickup).toHaveBeenCalledTimes(1));
    expect(fulfilPickup).toHaveBeenCalledWith({
      scheduleId: 1,
      quantity: 4,
      paymentMethod: "Venmo",
      amountPaid: 40,
    });
    expect(completePickup).not.toHaveBeenCalled();
  });
});

/**
 * Starting a weekly pickup. The quantity used to be a free-text box, which
 * would take any number the customer typed and let the insert decide — and
 * for a first pickup more than three days out, check_schedule_capacity waves
 * everything through, so nothing decided at all.
 */
describe("Starting a weekly pickup", () => {
  const openPanel = async (product = "Milk") => {
    await mount();
    const cards = [...document.querySelectorAll(".shop-product")];
    const card = cards.find((c) => c.textContent?.includes(product))!;
    fireEvent.click(card.querySelector(".shop-subscribe-link")!);
    await waitFor(() => expect(fetchScheduleCapacity).toHaveBeenCalled());
    return card;
  };

  const options = (label: string) =>
    [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.textContent);

  it("offers milk by the half gallon, capped at the day's forecast", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Sunday" } });

    // Sunday forecasts 3.2 gallons, so the list stops at 3 — 3.5 would be
    // more than the farm expects to have.
    expect(options("Weekly quantity of Milk")).toEqual([
      "How much?",
      "0.5 gallon",
      "1 gallon",
      "1.5 gallon",
      "2 gallon",
      "2.5 gallon",
      "3 gallon",
    ]);
  });

  it("offers eggs by the dozen, not the half dozen", async () => {
    await openPanel("Eggs");
    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Thursday" } });

    // 3.1 dozen forecast — three whole dozen.
    expect(options("Weekly quantity of Eggs")).toEqual(["How much?", "1 dozen", "2 dozen", "3 dozen"]);
  });

  it("re-caps the list when the day changes", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Monday" } });
    expect(options("Weekly quantity of Milk").length).toBe(13); // 0.5 … 6

    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Thursday" } });
    expect(options("Weekly quantity of Milk")).toEqual(["How much?", "0.5 gallon", "1 gallon", "1.5 gallon"]);
  });

  it("drops a chosen quantity the new day can't cover", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Monday" } });
    fireEvent.change(screen.getByLabelText("Weekly quantity of Milk"), { target: { value: "5" } });
    expect((screen.getByLabelText("Weekly quantity of Milk") as HTMLSelectElement).value).toBe("5");

    // Thursday only forecasts 1.5 — 5 gallons can't quietly survive the move.
    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Thursday" } });
    expect((screen.getByLabelText("Weekly quantity of Milk") as HTMLSelectElement).value).toBe("");
  });

  it("offers nothing on a day that can't cover a single step", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Friday" } });

    // 0.3 of a gallon is not half a gallon, and "0" is not an offer.
    expect(options("Weekly quantity of Milk")).toEqual(["No milk that day"]);
    expect((screen.getByLabelText("Weekly quantity of Milk") as HTMLSelectElement).disabled).toBe(true);
  });

  it("says what each day is expected to have, so another day is a real suggestion", async () => {
    await openPanel();
    expect(options("Pickup day")).toContain("Mondays — 6 gallon expected");
    expect(options("Pickup day")).toContain("Fridays — none expected");
  });

  it("carries the note about inventory", async () => {
    const card = await openPanel();
    expect(card.textContent).toContain(
      "Inventory fluctuates, if we don't have the quantity you're hoping for, try another day or ask us for help!",
    );
  });

  it("won't start until a quantity is chosen, then sends the one that was", async () => {
    await openPanel();
    fireEvent.change(screen.getByLabelText("Pickup day"), { target: { value: "Monday" } });

    const start = screen.getByRole("button", { name: "Start weekly pickup" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Weekly quantity of Milk"), { target: { value: "2.5" } });
    expect(start.disabled).toBe(false);
    fireEvent.click(start);

    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(createSchedule.mock.calls[0][0]).toMatchObject({ productId: 1, quantity: 2.5, day: "Monday" });
  });
});
