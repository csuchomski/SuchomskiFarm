// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * The first screen of the app for somebody who has just made an account.
 *
 * What matters is that a member of nothing is offered a way forward rather
 * than told there is nothing here, and that the workspace is asked again
 * once there is — otherwise the farm exists in the database and the app goes
 * on showing the empty state until a reload.
 */

const workspace = {
  loading: false, error: null as string | null,
  businesses: [] as { id: number; name: string; type: string }[],
  business: null as { id: number; name: string; type: string } | null,
  modules: [] as string[], farmId: null as string | null, role: null as string | null,
  userId: "u1", migrated: true, setBusinessId: vi.fn(), reload: vi.fn(),
};

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => workspace,
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
  useHasModule: () => false,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const createFarm = vi.fn<(name: string, farmName?: string) => Promise<number>>(async () => 12);
vi.mock("../lib/onboarding", () => ({
  createFarm: (...a: [string, string?]) => createFarm(...a),
  signUpFarmer: vi.fn(),
}));

beforeEach(() => {
  createFarm.mockClear();
  createFarm.mockResolvedValue(12);
  workspace.reload = vi.fn();
  workspace.business = null;
  workspace.businesses = [];
  workspace.error = null;
});

afterEach(cleanup);

const mountHome = async () => {
  const { default: Home } = await import("./Home");
  render(<MemoryRouter><Home /></MemoryRouter>);
};

describe("a member of nothing", () => {
  it("is offered a farm rather than told there is nothing here", async () => {
    await mountHome();
    expect(screen.getByLabelText("Farm name")).toBeTruthy();
    expect(document.body.textContent).not.toContain("not a member of any business");
  });

  it("cannot start one without naming it", async () => {
    await mountHome();
    const button = screen.getByText("Start the farm") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Farm name"), { target: { value: "   " } });
    expect(button.disabled).toBe(true);
  });

  it("starts one, and asks the workspace again once it exists", async () => {
    // Without the reload the farm is real but the app keeps showing this
    // screen, which reads exactly like the button did nothing.
    await mountHome();
    fireEvent.change(screen.getByLabelText("Farm name"), { target: { value: "Hilltop Farm" } });
    fireEvent.click(screen.getByText("Start the farm"));
    await waitFor(() => expect(createFarm).toHaveBeenCalledWith("Hilltop Farm"));
    await waitFor(() => expect(workspace.reload).toHaveBeenCalled());
  });

  it("says what went wrong and lets them try again", async () => {
    createFarm.mockRejectedValueOnce(new Error("You already have a farm."));
    await mountHome();
    fireEvent.change(screen.getByLabelText("Farm name"), { target: { value: "Hilltop Farm" } });
    fireEvent.click(screen.getByText("Start the farm"));
    await waitFor(() => expect(screen.getByText(/already have a farm/)).toBeTruthy());
    expect((screen.getByText("Start the farm") as HTMLButtonElement).disabled).toBe(false);
    expect(workspace.reload).not.toHaveBeenCalled();
  });

  it("gets out of the way once there is a farm", async () => {
    workspace.business = { id: 12, name: "Hilltop Farm", type: "farm" };
    workspace.businesses = [workspace.business];
    workspace.modules = ["herd"];
    await mountHome();
    await waitFor(() => expect(screen.queryByLabelText("Farm name")).toBeNull());
  });
});
