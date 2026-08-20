// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * One customer's page. The parts worth testing are the ones a typecheck
 * can't see: that the two ways of removing someone are offered according to
 * whether they have history, and that the buttons are wired to the calls
 * rather than merely present.
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
  // Has bought things: archive is the only option.
  { id: "cust-1", first_name: "Meghan", last_name: "Suchomski", email: "meghan@example.com", phone: "555-0100",
    role: "buyer", archived_at: null, created_at: "2026-05-01T00:00:00Z" },
  // Signed up and never ordered: deletable.
  { id: "cust-2", first_name: "", last_name: "", email: "quiet@example.com", phone: null,
    role: "buyer", archived_at: null, created_at: "2026-05-02T00:00:00Z" },
];

const orders = [
  { id: 9, customer_id: "cust-1", product_id: 1, quantity: 1.5, status: "completed",
    reserved_date: "2026-06-10T00:00:00Z", picked_up_date: "2026-06-24T17:00:00Z", cancelled_date: null,
    unit_price: 10, total_cost: 15, amount_paid: 15, payment_method: "Cash", business_id: 5 },
  // Same day, part paid — $20 billed against $12.
  { id: 8, customer_id: "cust-1", product_id: 1, quantity: 2, status: "completed",
    reserved_date: "2026-06-01T00:00:00Z", picked_up_date: "2026-06-24T20:00:00Z", cancelled_date: null,
    unit_price: 10, total_cost: 20, amount_paid: 12, payment_method: "Check", business_id: 5 },
  { id: 12, customer_id: "cust-1", product_id: 1, quantity: 2, status: "reserved",
    reserved_date: "2026-08-05T12:00:00Z", picked_up_date: null, cancelled_date: null,
    unit_price: null, total_cost: null, amount_paid: null, payment_method: null, business_id: 5 },
];

vi.mock("../lib/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/orders")>()),
  fetchCustomers: vi.fn(async () => customers),
  fetchOrders: vi.fn(async () => orders),
}));

vi.mock("../lib/store-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/store-data")>()),
  fetchStoreData: vi.fn(async () => ({
    products: [{ id: 1, name: "Milk", unit: "gallon", price: 10, onHand: 6, claimed: 2, openToShop: 4, batches: [] }],
    discards: [],
    production: [],
  })),
}));

type Patch = Parameters<typeof import("../lib/customers").updateCustomer>[1];
const updateCustomer = vi.fn(async (_id: string, _patch: Patch) => customers[0]);
const setArchived = vi.fn(async (_id: string, _archived: boolean) => undefined);
const deleteCustomer = vi.fn(async (_id: string, _businessId: number) => undefined);

vi.mock("../lib/customers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/customers")>()),
  updateCustomer: (id: string, patch: Patch) => updateCustomer(id, patch),
  setArchived: (id: string, archived: boolean) => setArchived(id, archived),
  deleteCustomer: (id: string, businessId: number) => deleteCustomer(id, businessId),
}));

afterEach(() => {
  cleanup();
  updateCustomer.mockClear();
  setArchived.mockClear();
  deleteCustomer.mockClear();
});

const mount = async (id: string) => {
  const { default: Detail } = await import("./StoreCustomerDetail");
  render(
    <MemoryRouter initialEntries={[`/store/customers/${id}`]}>
      <Routes>
        <Route path="/store/customers/:id" element={<Detail />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Purchase history");
};

describe("Customer detail", () => {
  it("shows who they are", async () => {
    await mount("cust-1");
    expect(screen.getAllByText("Meghan Suchomski").length).toBeGreaterThan(0);
    expect(screen.getByText("meghan@example.com")).toBeTruthy();
    expect(screen.getByText("555-0100")).toBeTruthy();
  });

  it("totals lifetime purchases, and what's still owed", async () => {
    await mount("cust-1");
    const stats = document.querySelector(".stat-row")!.textContent ?? "";
    // Two collected orders: $15 + $20 billed, $15 + $12 paid, $8 short.
    expect(stats).toContain("$35.00");
    expect(stats).toContain("$27.00");
    expect(stats).toContain("$8.00");
    // The open order isn't a purchase yet.
    expect(stats).toContain("2");
  });

  it("groups the history by day, like the customer's own account page", async () => {
    await mount("cust-1");
    const days = [...document.querySelectorAll(".customer-day")];
    expect(days.length).toBe(1);
    expect(days[0].querySelector(".customer-day__heading")?.textContent).toMatch(/June.*24|24.*June/);
    // $15 + $20 for the day.
    expect(days[0].querySelector(".customer-day__total")?.textContent).toBe("$35.00");

    // Two rows, not three: the open order isn't history yet.
    const rows = [...days[0].querySelectorAll(".grid-row--body")];
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Cash"),
      expect.stringContaining("Check"),
    ]);
    // And the part-paid one carries what's still outstanding.
    expect(rows.find((r) => r.textContent?.includes("Check"))?.textContent).toContain("$8.00 owed");
  });

  it("edits their details through the form", async () => {
    await mount("cust-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const phone = screen.getByDisplayValue("555-0100");
    fireEvent.change(phone, { target: { value: "555-0200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1));
    expect(updateCustomer.mock.calls[0][0]).toBe("cust-1");
    expect(updateCustomer.mock.calls[0][1]).toMatchObject({ phone: "555-0200", first_name: "Meghan" });
  });

  it("won't save an email that isn't one", async () => {
    await mount("cust-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("meghan@example.com"), { target: { value: "nope" } });

    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateCustomer).not.toHaveBeenCalled();
  });

  it("offers only archiving to a customer with orders, and says why", async () => {
    await mount("cust-1");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(document.querySelector(".customer-danger")?.textContent).toMatch(/3 orders on file/);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(setArchived).toHaveBeenCalledWith("cust-1", true));
  });

  it("offers delete to someone who never ordered, behind a confirmation", async () => {
    await mount("cust-2");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // One press arms it; it doesn't delete.
    expect(deleteCustomer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(deleteCustomer).toHaveBeenCalledWith("cust-2", 5));
  });

  it("says so when the id matches nobody", async () => {
    const { default: Detail } = await import("./StoreCustomerDetail");
    render(
      <MemoryRouter initialEntries={["/store/customers/nope"]}>
        <Routes>
          <Route path="/store/customers/:id" element={<Detail />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No customer with that id/)).toBeTruthy();
  });
});
