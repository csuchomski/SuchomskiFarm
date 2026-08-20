import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A customer belongs to a business.
 *
 * The leak this exists for: `fetchCustomers` selected `profiles` with no
 * filter of any kind, and the policy behind it read
 * `auth.uid() = id OR is_farmer()` — "is this account a farmer", not "a
 * farmer *here*". So a second farm on the instance meant every farmer saw
 * every profile, and the Customers page dutifully listed another business's
 * owner among the people who buy eggs.
 *
 * Migration 056 fixed the policy. This pins the other half: the page has to
 * *ask* for one business's customers. A farmer with three businesses passes
 * the policy for all three, and only the argument keeps them apart.
 */

const calls: { table?: string; rpc?: string; args?: unknown; ids?: unknown }[] = [];
const profiles: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const rpc: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      calls.push({ rpc: name, args });
      return Promise.resolve(rpc);
    },
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, ids: unknown) => {
          calls.push({ table, ids });
          return { order: () => Promise.resolve(profiles) };
        },
      }),
    }),
  },
  herdSchema: () => ({}),
}));

const load = async () => await import("./orders");

afterEach(() => {
  calls.length = 0;
  profiles.data = [];
  profiles.error = null;
  rpc.data = [];
  rpc.error = null;
});

describe("fetchCustomers", () => {
  it("asks for one business's customers, and reads only those profiles", async () => {
    rpc.data = ["cust-1", "cust-2"];
    profiles.data = [{ id: "cust-1" }, { id: "cust-2" }];

    const { fetchCustomers } = await load();
    const rows = await fetchCustomers(5);

    expect(calls[0]).toEqual({ rpc: "customer_ids_of", args: { p_business_id: 5 } });
    expect(calls[1]).toEqual({ table: "profiles", ids: ["cust-1", "cust-2"] });
    expect(rows).toHaveLength(2);
  });

  it("reads no profiles at all when the business has no customers", async () => {
    // Not "select every profile and filter to none" — the empty case is
    // exactly where an unfiltered `.in()` would fall back to the whole table.
    rpc.data = [];
    const { fetchCustomers } = await load();
    expect(await fetchCustomers(13)).toEqual([]);
    expect(calls.filter((c) => c.table === "profiles")).toEqual([]);
  });

  it("carries the business through, so two of one farmer's businesses stay apart", async () => {
    rpc.data = ["cust-9"];
    profiles.data = [{ id: "cust-9" }];
    const { fetchCustomers } = await load();
    await fetchCustomers(4);
    expect(calls[0]).toEqual({ rpc: "customer_ids_of", args: { p_business_id: 4 } });
  });

  it("says which read failed rather than returning an empty list", async () => {
    rpc.error = { message: "permission denied" };
    const { fetchCustomers } = await load();
    await expect(fetchCustomers(5)).rejects.toThrow(/customer_ids_of: permission denied/);
  });
});
