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
  { id: 1, name: "Milk", unit: "gallon", price: 10, business_id: 5, available: 4 },
  { id: 3, name: "Eggs", unit: "dozen", price: 7, business_id: 5, available: 0 },
];

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
  },
  {
    id: 9,
    product_id: 1,
    quantity: 1.5,
    status: "completed",
    reserved_date: "2026-06-10T00:00:00Z",
    picked_up_date: "2026-06-24T00:00:00Z",
    cancelled_date: null,
    unit_price: 10,
    total_cost: 15,
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
}));

type CompleteInput = Parameters<typeof import("../lib/orders").completePickup>[0];
const completePickup = vi.fn(async (_input: CompleteInput) => undefined);

vi.mock("../lib/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orders")>()),
  completePickup: (input: CompleteInput) => completePickup(input),
}));

vi.mock("../lib/payment-methods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/payment-methods")>()),
  fetchPaymentMethods: vi.fn(async () => [
    { code: "Cash", label: "Cash", active: true, sort_order: 10 },
    { code: "Venmo", label: "Venmo", active: true, sort_order: 20 },
    { code: "Check", label: "Check", active: true, sort_order: 30 },
  ]),
}));

afterEach(() => {
  cleanup();
  completePickup.mockClear();
  fulfilPickup.mockClear();
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
    // One collected order at $15.
    expect(screen.getByText(/1 order · \$15\.00/)).toBeTruthy();
    expect(screen.getByText("History")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
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

  it("offers Check alongside Cash and Venmo", async () => {
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
