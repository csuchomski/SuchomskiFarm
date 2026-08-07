// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * The Products page had two buttons with no onClick — "New product" and
 * "Forecast" — so there was no way to add a product or change the price
 * every order is costed from. Nothing failed; they just did nothing, which
 * is precisely what a unit test can't see.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false,
    error: null,
    businesses: [business],
    business,
    modules: ["herd", "store", "books"],
    farmId: "farm-1",
    role: "owner",
    userId: "u1",
    migrated: true,
    setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

vi.mock("../lib/store-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/store-data")>()),
  fetchStoreData: vi.fn(async () => ({
    products: [
      {
        id: 1,
        name: "Milk",
        unit: "gallon",
        price: 10,
        forecast_override: null,
        onHand: 9,
        claimed: 5,
        openToShop: 4,
        batches: [{ id: 13, product_id: 1, produced_date: "2026-08-04", quantity: 7, reserved: 7, herd_animal_id: null }],
      },
    ],
    discards: [],
    production: [],
  })),
}));

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => []),
}));

vi.mock("../lib/lactations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/lactations")>()),
  fetchLactations: vi.fn(async () => []),
}));

vi.mock("../lib/milkings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/milkings")>()),
  fetchMilkProduct: vi.fn(async () => ({ id: 1, name: "Milk", unit: "gallon" })),
}));

vi.mock("../lib/schedules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/schedules")>()),
  fetchSchedules: vi.fn(async () => [
    {
      id: 1,
      customer_id: "cust-1",
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

describe("Products page", () => {
  it("opens a form when New product is pressed", async () => {
    const { default: StoreProducts } = await import("./StoreProducts");
    render(
      <MemoryRouter>
        <StoreProducts />
      </MemoryRouter>,
    );
    await screen.findAllByText("Milk");

    // Before: this button had no onClick at all.
    fireEvent.click(screen.getByRole("button", { name: "New product" }));
    expect(screen.getByText("New product", { selector: ".eyebrow" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Raw milk")).toBeTruthy();
  });

  it("edits an existing product, pre-filled with its price", async () => {
    const { default: StoreProducts } = await import("./StoreProducts");
    render(
      <MemoryRouter>
        <StoreProducts />
      </MemoryRouter>,
    );
    await screen.findAllByText("Milk");

    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByText("Edit product")).toBeTruthy();
    const price = screen.getByDisplayValue("10") as HTMLInputElement;
    expect(price).toBeTruthy();
  });

  it("shows what standing orders have promised, rather than a hard-coded dash", async () => {
    const { default: StoreProducts } = await import("./StoreProducts");
    const { container } = render(
      <MemoryRouter>
        <StoreProducts />
      </MemoryRouter>,
    );
    await screen.findAllByText("Milk");
    // 4 gallons every Thursday.
    expect(container.textContent).toContain("4");
  });

  it("points Forecast at the forecast page", async () => {
    const { default: StoreProducts } = await import("./StoreProducts");
    const { container } = render(
      <MemoryRouter>
        <StoreProducts />
      </MemoryRouter>,
    );
    await screen.findAllByText("Milk");
    const link = container.querySelector('a[href="/store/forecast"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Forecast");
  });

  it("offers a discard, limited to unreserved stock", async () => {
    const { default: StoreProducts } = await import("./StoreProducts");
    render(
      <MemoryRouter>
        <StoreProducts />
      </MemoryRouter>,
    );
    await screen.findAllByText("Milk");

    fireEvent.click(screen.getByRole("button", { name: "discard" }));
    expect(screen.getByText("Fed to Pigs")).toBeTruthy();

    // While the field is empty the form asks for a quantity.
    expect(screen.getByText(/How much is being thrown out/)).toBeTruthy();

    // 9 on hand, 5 already claimed by an order, so only 4 can go. Trying to
    // throw out 6 is refused before it reaches discard_inventory, which
    // would otherwise raise 'Not enough unreserved inventory'.
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity to discard" }), { target: { value: "6" } });
    expect(screen.getByText(/Only 4 unreserved/)).toBeTruthy();
  });
});
