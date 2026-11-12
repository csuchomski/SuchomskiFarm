// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    products: [
      { id: 1, name: "Milk", unit: "gallon", price: 10, jars_per_unit: 2, onHand: 6, claimed: 2, openToShop: 4, batches: [] },
    ],
    discards: [],
    production: [],
  })),
}));

/** The farm's jars: what each customer has, and the lines behind it. */
let jarBalances = new Map<string, number>([["cust-1", 4]]);
let jarLines: import("../lib/jars").JarLine[] = [
  { id: 3, kind: "return", change: -1, at: "2026-06-30T17:00:00Z", orderId: null, enteredBy: "u1" },
  { id: 2, kind: "pickup", change: 4, at: "2026-06-24T20:00:00Z", orderId: 8, enteredBy: "cust-1" },
  { id: 1, kind: "correction", change: 1, at: "2026-06-20T12:00:00Z", orderId: null, enteredBy: "u1" },
];
const recordJarReturn = vi.fn(async (_b: number, customerId: string, n: number) => {
  const left = (jarBalances.get(customerId) ?? 0) - n;
  jarBalances = new Map(jarBalances).set(customerId, left);
  return left;
});
const setJarCount = vi.fn(async (_b: number, customerId: string, n: number) => {
  jarBalances = new Map(jarBalances).set(customerId, n);
  return n;
});

vi.mock("../lib/jars", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/jars")>()),
  fetchJarBalances: vi.fn(async () => jarBalances),
  fetchJarLines: vi.fn(async (_b: number, customerId: string) => (customerId === "cust-1" ? jarLines : [])),
  recordJarReturn: (b: number, c: string, n: number) => recordJarReturn(b, c, n),
  setJarCount: (b: number, c: string, n: number) => setJarCount(b, c, n),
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
  recordJarReturn.mockClear();
  setJarCount.mockClear();
  jarBalances = new Map([["cust-1", 4]]);
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

describe("Customer detail · jars", () => {
  const jars = () => screen.getByRole("region", { name: "Jars" });
  const back = () => screen.getByLabelText("Jars returned") as HTMLInputElement;
  const count = () => screen.getByLabelText("Set the jar count to") as HTMLInputElement;
  const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

  it("says how many of the farm's jars they have", async () => {
    await mount("cust-1");
    expect(within(jars()).getByText("4 jars")).toBeTruthy();
    expect(jars().textContent).toContain("Meghan Suchomski has 4 jars of yours.");
    const tile = screen.getByText("Jars out").closest<HTMLElement>(".stat-tile")!;
    expect(tile.textContent).toContain("4");
  });

  it("records jars that came back without the customer saying so", async () => {
    await mount("cust-1");
    expect(button("Record return").disabled).toBe(true);
    fireEvent.change(back(), { target: { value: "3" } });
    fireEvent.click(button("Record return"));

    await waitFor(() => expect(recordJarReturn).toHaveBeenCalledTimes(1));
    expect(recordJarReturn).toHaveBeenCalledWith(5, "cust-1", 3);
    await waitFor(() => expect(jars().textContent).toContain("has 1 jar of yours."));
    expect(back().value).toBe("");
  });

  it("won't record more coming back than they have", async () => {
    await mount("cust-1");
    fireEvent.change(back(), { target: { value: "5" } });
    expect(button("Record return").disabled).toBe(true);
    expect(within(jars()).getByText("That's more than the 4 jars on record.")).toBeTruthy();
    expect(recordJarReturn).not.toHaveBeenCalled();
  });

  it("lets the count be set outright, up or down", async () => {
    await mount("cust-1");
    // The same number is no change, so there's nothing to press.
    fireEvent.change(count(), { target: { value: "4" } });
    expect(button("Set count").disabled).toBe(true);
    fireEvent.change(count(), { target: { value: "-1" } });
    expect(button("Set count").disabled).toBe(true);

    fireEvent.change(count(), { target: { value: "7" } });
    fireEvent.click(button("Set count"));
    await waitFor(() => expect(setJarCount).toHaveBeenCalledTimes(1));
    expect(setJarCount).toHaveBeenCalledWith(5, "cust-1", 7);
    await waitFor(() => expect(jars().textContent).toContain("has 7 jars of yours."));
  });

  it("keeps the history folded away until it's asked for", async () => {
    await mount("cust-1");
    expect(screen.queryByRole("group", { name: "Jar history" })).toBeNull();
    expect(jars().querySelectorAll(".grid-row--body")).toHaveLength(0);
    // The count and the two forms are still there without it.
    expect(jars().textContent).toContain("has 4 jars of yours.");
    expect(back()).toBeTruthy();

    const toggle = button("Show history (3)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("group", { name: "Jar history" })).toBeTruthy();
    expect(jars().querySelectorAll(".grid-row--body")).toHaveLength(3);

    fireEvent.click(button("Hide history"));
    expect(screen.queryByRole("group", { name: "Jar history" })).toBeNull();
  });

  it("stays open while a return is recorded, and shows nothing to open with no history", async () => {
    await mount("cust-1");
    fireEvent.click(button("Show history (3)"));
    fireEvent.change(back(), { target: { value: "1" } });
    fireEvent.click(button("Record return"));
    await waitFor(() => expect(recordJarReturn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(jars().textContent).toContain("has 3 jars of yours."));
    expect(screen.getByRole("group", { name: "Jar history" })).toBeTruthy();

    cleanup();
    await mount("cust-2");
    expect(screen.queryByRole("button", { name: /history/i })).toBeNull();
  });

  it("says what each line on the record was", async () => {
    await mount("cust-1");
    fireEvent.click(button("Show history (3)"));
    const rows = [...jars().querySelectorAll(".grid-row--body")].map((r) => r.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Returned");
    expect(rows[0]).toContain("-1");
    // The pickup names the order it came from.
    expect(rows[1]).toContain("Took home 2 gallon of milk");
    expect(rows[1]).toContain("+4");
    expect(rows[2]).toContain("Count set");
  });

  it("keeps the explanation behind an (i), not on the page", async () => {
    await mount("cust-1");
    expect(screen.queryByText(/A pickup adds a jar for every half gallon/)).toBeNull();
    fireEvent.click(within(jars()).getByRole("button", { name: "How the jar count works" }));
    expect(screen.getByText(/A pickup adds a jar for every half gallon/)).toBeTruthy();
    expect(screen.getByText(/Customers see their count in the shop but can't change it/)).toBeTruthy();
  });

  it("starts someone with no jars at none, with a count that can still be set", async () => {
    await mount("cust-2");
    expect(jars().textContent).toContain("quiet@example.com has none of your jars.");
    expect(back().disabled).toBe(true);
    fireEvent.change(count(), { target: { value: "2" } });
    fireEvent.click(button("Set count"));
    await waitFor(() => expect(setJarCount).toHaveBeenCalledWith(5, "cust-2", 2));
  });
});
