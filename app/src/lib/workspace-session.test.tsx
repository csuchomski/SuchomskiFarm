// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

/**
 * The regression this file exists for.
 *
 * WorkspaceProvider wraps the sign-in screen, so it mounts while you're
 * still signed out. It used to read the user once, in an effect keyed only
 * on [selectedId]. On a fresh sign-in that ran before a session existed and
 * never ran again, so an owner of three businesses was told "you're not a
 * member of any business yet" for the rest of the session.
 *
 * Nothing in the suite could catch that — there was no React environment at
 * all — which is why it reached production. The test that matters is the
 * second one: a session arriving *after* mount must load the workspace.
 */

const authState: { session: Session | null; loading: boolean } = { session: null, loading: true };

vi.mock("./auth", () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  signOut: vi.fn(),
}));

const from = vi.fn();
vi.mock("./supabase", () => ({
  supabase: { from: (...a: unknown[]) => from(...a), schema: () => ({ from: (...a: unknown[]) => from(...a) }) },
  herdSchema: () => ({ from: (...a: unknown[]) => from(...a) }),
}));

const sessionFor = (id: string) => ({ user: { id } }) as unknown as Session;

/** Minimal stand-in for the PostgREST builder, per table. */
function stubTables(userId: string) {
  from.mockImplementation((table: string) => {
    const result = (data: unknown) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "is", "limit"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve({ data: null, error: null });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
      return b;
    };

    if (table === "business_members") {
      return result([
        { role: "owner", business_id: 5, businesses: { id: 5, name: "Suchomski Family Farm", type: "farm" } },
        { role: "owner", business_id: 4, businesses: { id: 4, name: "5553 N Lydell Ave", type: "rental" } },
      ]);
    }
    if (table === "business_type_modules") return result([{ module_code: "books" }, { module_code: "herd" }]);
    return result([]);
  });
  return userId;
}

let WorkspaceProvider: typeof import("./workspace").WorkspaceProvider;
let useWorkspace: typeof import("./workspace").useWorkspace;

beforeEach(async () => {
  vi.resetModules();
  from.mockReset();
  authState.session = null;
  authState.loading = true;
  localStorage.clear();
  const mod = await import("./workspace");
  WorkspaceProvider = mod.WorkspaceProvider;
  useWorkspace = mod.useWorkspace;
});

afterEach(() => {
  // Vitest globals are off, so RTL's automatic cleanup never registers and
  // mounted trees pile up across tests until every query finds two.
  cleanup();
  vi.clearAllMocks();
});

function Probe() {
  const { businesses, business, loading } = useWorkspace();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{businesses.length}</span>
      <span data-testid="current">{business?.name ?? "none"}</span>
    </div>
  );
}

const renderProvider = () =>
  render(
    <WorkspaceProvider>
      <Probe />
    </WorkspaceProvider>,
  );

describe("WorkspaceProvider follows the session", () => {
  it("loads the workspace when a session is already present at mount", async () => {
    stubTables("u1");
    authState.session = sessionFor("u1");
    authState.loading = false;

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
    expect(screen.getByTestId("current").textContent).toBe("Suchomski Family Farm");
  });

  it("loads the workspace when the session arrives after mount", async () => {
    // The actual regression: mounted signed-out, then signed in.
    stubTables("u1");
    authState.session = null;
    authState.loading = false;

    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("count").textContent).toBe("0");

    authState.session = sessionFor("u1");
    view.rerender(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
    expect(screen.getByTestId("current").textContent).toBe("Suchomski Family Farm");
  });

  it("stays loading until auth resolves, rather than deciding there's no user", async () => {
    stubTables("u1");
    authState.loading = true;

    renderProvider();

    // Must not settle on an empty workspace while auth is still unknown.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(from).not.toHaveBeenCalled();
  });

  it("clears the workspace on sign-out", async () => {
    stubTables("u1");
    authState.session = sessionFor("u1");
    authState.loading = false;

    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));

    authState.session = null;
    view.rerender(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("0"));
    expect(screen.getByTestId("current").textContent).toBe("none");
  });
});
