// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Today's header.
 *
 * The buttons up here are the shortcuts to the jobs of a day, so what matters
 * is that each one goes where it says — a shortcut to the wrong page is worse
 * than no shortcut, because it is trusted.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

vi.mock("../lib/dashboard-data", () => ({
  fetchDashboardData: vi.fn(async () => ({
    today: "2026-08-15",
    animals: [], profitPerHead: [], transactionsToday: [],
    milkTodayQuantity: 0, milkTodayUnit: null, milkIdentifiedByName: false,
    batchesToday: 0, claimed: 0, openToShop: 0, openOrders: 0,
    monthNet: 0, monthEntries: 0, hasCostData: false,
  })),
}));

vi.mock("../lib/alerts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/alerts")>();
  return { ...actual, fetchAlertInputs: vi.fn(async () => ({})), buildAlerts: vi.fn(() => []) };
});

afterEach(cleanup);

const mount = async () => {
  const { default: Today } = await import("./Today");
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/grazing/move" element={<p>the move page</p>} />
        <Route path="/milkings" element={<p>the milkings page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryAllByText("Loading…")).toHaveLength(0));
};

describe("the shortcuts on Today", () => {
  it("offers the cattle move", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Cattle move" })).toBeTruthy();
  });

  it("goes to the move page, not merely somewhere", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Cattle move" }));
    await waitFor(() => expect(screen.queryByText("the move page")).toBeTruthy());
  });

  it("leaves the other shortcuts where they were", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Log milking" }));
    await waitFor(() => expect(screen.queryByText("the milkings page")).toBeTruthy());
  });
});
