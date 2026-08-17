// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The way in for somebody who does not have an account yet.
 *
 * Signing up deliberately does not create a farm. With email confirmation on
 * there is no session, so nothing can be written as this person — the farm
 * comes after, on its own screen, once they are actually signed in.
 */

const signInWithPassword = vi.fn<(e: string, p: string) => Promise<void>>(async () => {});
const signUpFarmer = vi.fn<(e: string, p: string) => Promise<{ needsConfirmation: boolean }>>(
  async () => ({ needsConfirmation: true }),
);

vi.mock("../../lib/auth", () => ({ signInWithPassword: (...a: [string, string]) => signInWithPassword(...a) }));
vi.mock("../../lib/onboarding", () => ({
  signUpFarmer: (...a: [string, string]) => signUpFarmer(...a),
  createFarm: vi.fn(),
}));

beforeEach(() => {
  signInWithPassword.mockClear();
  signUpFarmer.mockClear();
  signUpFarmer.mockResolvedValue({ needsConfirmation: true });
});
afterEach(cleanup);

const mount = async () => {
  const { SignIn } = await import("./SignIn");
  render(<SignIn />);
};

const fill = () => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@farm.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "longenough1" } });
};

describe("getting in", () => {
  it("signs in by default", async () => {
    await mount();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith("new@farm.test", "longenough1"));
    expect(signUpFarmer).not.toHaveBeenCalled();
  });

  it("offers a way to start a farm without one", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Start a farm instead" }));
    expect(screen.getByRole("button", { name: "Create an account" })).toBeTruthy();
  });

  it("creates the account, and says where to look when a link is in the way", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Start a farm instead" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await waitFor(() => expect(signUpFarmer).toHaveBeenCalledWith("new@farm.test", "longenough1"));
    await waitFor(() => expect(screen.getByText(/Check new@farm.test for a link/)).toBeTruthy());
    // and it drops back to signing in, which is what they do next
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("surfaces a refusal rather than looking like nothing happened", async () => {
    signUpFarmer.mockRejectedValueOnce(new Error("Password is too short"));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Start a farm instead" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await waitFor(() => expect(screen.getByText("Password is too short")).toBeTruthy());
  });

  it("keeps the two verbs apart, so a mistyped password never makes an account", async () => {
    await mount();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalled());
    expect(signUpFarmer).not.toHaveBeenCalled();
  });
});
