// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../lib/schedules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/schedules")>()),
  fetchMySchedules: vi.fn(async () => [
    {
      id: 1,
      customer_id: "u1",
      product_id: 1,
      quantity: 4,
      day: "Thursday",
      start_date: null,
      skipped_dates: [],
      fulfilled_dates: [],
      cancelled_at: null,
      business_id: 5,
      note: "",
    },
  ]),
}));

afterEach(cleanup);

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
    // One open order plus one standing order.
    const pickup = screen.getByRole("button", { name: /Pickup/ });
    expect(pickup.textContent).toContain("2");
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
