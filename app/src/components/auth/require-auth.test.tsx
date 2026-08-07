// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Signing in must land you on the app.
 *
 * There used to be a FarmCheck screen between the two: a Supabase connection
 * test that counted rows across 22 tables and waited for a "Continue to the
 * app" click. It was scaffolding for wiring the app to the database, and it
 * ran on every single sign-in — 22 count queries and a click before the farm
 * was reachable. This pins the interstitial as gone, since the natural way
 * to reintroduce one is to add a gate here.
 */

const authState: { session: { user: { id: string } } | null; loading: boolean } = {
  session: null,
  loading: true,
};

vi.mock("../../lib/auth", () => ({
  useAuth: () => authState,
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

afterEach(cleanup);

async function mount() {
  const { RequireAuth } = await import("./RequireAuth");
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<div>THE APP</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  it("waits while the session is still being restored", async () => {
    authState.session = null;
    authState.loading = true;
    await mount();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows the sign-in form when signed out", async () => {
    authState.session = null;
    authState.loading = false;
    await mount();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.queryByText("THE APP")).toBeNull();
  });

  it("goes straight to the app once signed in, with nothing in between", async () => {
    authState.session = { user: { id: "u1" } };
    authState.loading = false;
    await mount();

    expect(screen.getByText("THE APP")).toBeTruthy();
    // The interstitial's two giveaways: its heading and its button.
    expect(screen.queryByText("Supabase connection check")).toBeNull();
    expect(screen.queryByText("Continue to the app")).toBeNull();
  });
});
