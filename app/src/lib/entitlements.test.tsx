// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

/**
 * What a business is entitled to.
 *
 * Before 049 this was a property of the *kind* of business: every farm got
 * books, herd and store, and there was no way to say anything about one of
 * them. These pin the order the answer is resolved in, and the direction that
 * matters is the easy one to get backwards — an entitlement must never be
 * widened by the type it happens to belong to. Somebody paying for herd alone
 * would otherwise get the store back for being a farm.
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

/** Per-table stand-in for the PostgREST builder. */
const stub = (tables: Record<string, { data?: unknown; error?: { message: string } }>) => {
  from.mockImplementation((table: string) => {
    const spec = tables[table] ?? { data: [] };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "is", "limit"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: spec.data ?? null, error: spec.error ?? null }).then(res);
    return b;
  });
};

const members = {
  data: [{ role: "owner", business_id: 5, businesses: { id: 5, name: "A Farm", type: "farm" } }],
};

let WorkspaceProvider: typeof import("./workspace").WorkspaceProvider;
let useWorkspace: typeof import("./workspace").useWorkspace;

beforeEach(async () => {
  vi.resetModules();
  from.mockReset();
  localStorage.clear();
  authState.session = { user: { id: "u1" } } as unknown as Session;
  authState.loading = false;
  const mod = await import("./workspace");
  WorkspaceProvider = mod.WorkspaceProvider;
  useWorkspace = mod.useWorkspace;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Probe() {
  const { modules, error } = useWorkspace();
  return (
    <div>
      <span data-testid="modules">{modules.slice().sort().join(",")}</span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
}

const mount = () => render(<WorkspaceProvider><Probe /></WorkspaceProvider>);
const modules = () => screen.getByTestId("modules").textContent;

describe("which modules a business has", () => {
  it("uses what this business was granted", async () => {
    stub({
      business_members: members,
      business_modules: { data: [{ module_code: "herd" }, { module_code: "grazing" }] },
      business_type_modules: { data: [{ module_code: "books" }, { module_code: "herd" }, { module_code: "store" }] },
    });
    mount();
    await waitFor(() => expect(modules()).toBe("grazing,herd"));
  });

  it("does not let the type it belongs to widen it", async () => {
    // The one that matters commercially: a farm paying for herd alone must
    // not get books and store back for being a farm.
    stub({
      business_members: members,
      business_modules: { data: [{ module_code: "herd" }] },
      business_type_modules: { data: [{ module_code: "books" }, { module_code: "herd" }, { module_code: "store" }] },
    });
    mount();
    await waitFor(() => expect(modules()).toBe("herd"));
    expect(modules()).not.toContain("store");
  });

  it("falls back to what its kind starts with when nothing was granted", async () => {
    stub({
      business_members: members,
      business_modules: { data: [] },
      business_type_modules: { data: [{ module_code: "books" }, { module_code: "herd" }] },
    });
    mount();
    await waitFor(() => expect(modules()).toBe("books,herd"));
  });

  it("falls back on a database that has no entitlement table yet", async () => {
    stub({
      business_members: members,
      business_modules: { error: { message: 'relation "public.business_modules" does not exist' } },
      business_type_modules: { data: [{ module_code: "books" }] },
    });
    mount();
    await waitFor(() => expect(modules()).toBe("books"));
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("surfaces a real fault rather than quietly handing out the type's modules", async () => {
    // A broken policy on the entitlement table must not read as "no
    // entitlement" and fall through to the wider list — that is how a paid
    // tier leaks. It has to be loud.
    stub({
      business_members: members,
      business_modules: { error: { message: "infinite recursion detected in policy for relation business_modules" } },
      business_type_modules: { data: [{ module_code: "books" }, { module_code: "store" }] },
    });
    mount();
    await waitFor(() => expect(screen.getByTestId("error").textContent).toContain("business_modules"));
    expect(modules()).toBe("");
  });
});
