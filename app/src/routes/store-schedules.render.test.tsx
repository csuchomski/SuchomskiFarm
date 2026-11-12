// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Standing orders, from the farm's side — whose jars a weekly pickup goes
 * home in. A customer who fills their own jars shouldn't be counted for the
 * farm's, and the farmer has to be able to say so when setting one up for
 * them and to change it afterwards.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd", "store", "books"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const customers = [
  { id: "cust-1", first_name: "Meghan", last_name: "Suchomski", email: "meghan@example.com", phone: null,
    role: "buyer", archived_at: null, created_at: "2026-05-01T00:00:00Z" },
  { id: "cust-2", first_name: "Tom", last_name: "Vollmer", email: "tom@example.com", phone: null,
    role: "buyer", archived_at: null, created_at: "2026-05-02T00:00:00Z" },
];

vi.mock("../lib/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orders")>()),
  fetchCustomers: vi.fn(async () => customers),
}));

vi.mock("../lib/store-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/store-data")>()),
  fetchStoreData: vi.fn(async () => ({
    products: [
      { id: 1, name: "Milk", unit: "gallon", price: 10, jars_per_unit: 2, onHand: 6, claimed: 0, openToShop: 6, batches: [] },
      { id: 3, name: "Eggs", unit: "dozen", price: 7, jars_per_unit: null, onHand: 6, claimed: 0, openToShop: 6, batches: [] },
    ],
    discards: [],
    production: [],
  })),
}));

const base = {
  start_date: null, skipped_dates: [], fulfilled_dates: [], cancelled_at: null, business_id: 5, note: "",
};
const schedules = [
  { ...base, id: 1, customer_id: "cust-1", product_id: 1, quantity: 2, day: "Wednesday", own_jars: false },
  { ...base, id: 2, customer_id: "cust-2", product_id: 1, quantity: 1, day: "Friday", own_jars: true },
  { ...base, id: 3, customer_id: "cust-2", product_id: 3, quantity: 2, day: "Friday", own_jars: false },
];

type CreateInput = Parameters<typeof import("../lib/schedules").createSchedule>[0];
const createSchedule = vi.fn(async (_input: CreateInput) => schedules[0]);
const setOwnJars = vi.fn(async (_id: number, _own: boolean) => schedules[0]);

vi.mock("../lib/schedules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/schedules")>()),
  fetchSchedules: vi.fn(async () => schedules),
  createSchedule: (input: CreateInput) => createSchedule(input),
  setOwnJars: (id: number, own: boolean) => setOwnJars(id, own),
}));

afterEach(() => {
  cleanup();
  createSchedule.mockClear();
  setOwnJars.mockClear();
});

const mount = async () => {
  const { default: StoreSchedules } = await import("./StoreSchedules");
  render(
    <MemoryRouter>
      <StoreSchedules />
    </MemoryRouter>,
  );
  await screen.findByText("Weekly pickups");
};

const row = (customer: string, product: string) =>
  [...document.querySelectorAll<HTMLElement>(".grid-row--body")].find(
    (r) => r.textContent?.includes(customer) && r.textContent?.includes(product),
  )!;

describe("Schedules · whose jars", () => {
  it("says on each milk pickup whose jars it goes home in", async () => {
    await mount();
    expect(row("Meghan Suchomski", "Milk").textContent).toContain("your jars");
    expect(row("Tom Vollmer", "Milk").textContent).toContain("their own jars");
    // Eggs don't go home in jars, so there's nothing to say or to switch.
    expect(row("Tom Vollmer", "Eggs").textContent).not.toMatch(/jars/);
  });

  it("switches a pickup to the customer's own jars, and back", async () => {
    await mount();
    fireEvent.click(within(row("Meghan Suchomski", "Milk")).getByRole("button", { name: /^Use their own jars/ }));
    await waitFor(() => expect(setOwnJars).toHaveBeenCalledWith(1, true));

    fireEvent.click(within(row("Tom Vollmer", "Milk")).getByRole("button", { name: /^Use your jars/ }));
    await waitFor(() => expect(setOwnJars).toHaveBeenCalledWith(2, false));
  });

  it("asks about jars when setting up a milk pickup, and sends the answer", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New standing order" }));
    const form = document.querySelector<HTMLElement>(".order-form")!;
    const [customer, product] = [...form.querySelectorAll("select")];
    fireEvent.change(customer, { target: { value: "cust-1" } });

    // Not offered until the product is one that goes home in jars.
    expect(screen.queryByLabelText("They bring their own jars")).toBeNull();
    fireEvent.change(product, { target: { value: "3" } });
    expect(screen.queryByLabelText("They bring their own jars")).toBeNull();
    fireEvent.change(product, { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText("They bring their own jars"));

    fireEvent.change(form.querySelector('input[type="number"]')!, { target: { value: "1.5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(createSchedule.mock.calls[0][0]).toMatchObject({ customerId: "cust-1", productId: 1, ownJars: true });
  });

  it("doesn't carry a ticked box over to a product with no jars", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New standing order" }));
    const form = document.querySelector<HTMLElement>(".order-form")!;
    const [customer, product] = [...form.querySelectorAll("select")];
    fireEvent.change(customer, { target: { value: "cust-1" } });
    fireEvent.change(product, { target: { value: "1" } });
    fireEvent.click(screen.getByLabelText("They bring their own jars"));
    fireEvent.change(product, { target: { value: "3" } });

    fireEvent.change(form.querySelector('input[type="number"]')!, { target: { value: "2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createSchedule).toHaveBeenCalledTimes(1));
    expect(createSchedule.mock.calls[0][0]).toMatchObject({ productId: 3, ownJars: false });
  });
});
