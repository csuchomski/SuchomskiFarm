import { describe, expect, it, vi } from "vitest";

/**
 * Today counts livestock, not the semen catalogue.
 *
 * The animals query used to select neither `record_type` nor filter on it, so
 * the four AI bulls the farm buys straws from were counted as head and sat in
 * "profit per head" — a ranking of which animals earn, listing four that
 * structurally cannot. A straw is a cost against the cow it was used on; the
 * bull is a row in a catalogue.
 */

const rows: Record<string, unknown[]> = {};

/** A stand-in for the query builder: every method returns itself, and
 * awaiting it yields whatever rows the table has been given. The real chains
 * differ per query (`.eq().is().order()`, `.gte().lte()`, …) and none of that
 * is what these tests are about. */
function builder(table: string) {
  const result = Promise.resolve({ data: rows[table] ?? [], error: null });
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return result.then.bind(result);
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => builder(table),
    schema: () => ({ from: (table: string) => builder(table) }),
  },
  herdSchema: () => ({ from: (table: string) => builder(table) }),
}));

const animal = (over: Record<string, unknown>) => ({
  ear_tag: "9",
  barn_name: null,
  sex: "female",
  class: "cow",
  status: "active",
  birth_date: "2021-01-01",
  record_type: "herd",
  ...over,
});

describe("fetchDashboardData", () => {
  const load = async () => (await import("./dashboard-data")).fetchDashboardData;

  it("leaves catalogue bulls out of head count and profit per head", async () => {
    rows["animals"] = [
      animal({ id: "cow-1", barn_name: "Patience", ear_tag: "0" }),
      animal({ id: "cow-2", barn_name: "Martha", ear_tag: "1" }),
      animal({ id: "ai-1", barn_name: "Overalls", ear_tag: "7JE2022", sex: "male", class: "bull", record_type: "reference" }),
    ];
    rows["cost_entries"] = [{ animal_id: "cow-2", amount_cents: 9500 }];
    rows["revenue_entries"] = [{ animal_id: "cow-1", amount_cents: 40000 }];

    const fetchDashboardData = await load();
    const data = await fetchDashboardData("2026-08-10", { businessId: 5, farmId: "farm-1" });

    expect(data.animals.map((a) => a.barn_name)).toEqual(["Patience", "Martha"]);
    expect(data.profitPerHead.map((p) => p.animal.barn_name)).toEqual(["Patience", "Martha"]);
    // Best first, and the figures still land on the right animals.
    expect(data.profitPerHead[0].netCents).toBe(40000);
    expect(data.profitPerHead[1].netCents).toBe(-9500);
  });

  it("still knows there is cost data even when it is all against one cow", async () => {
    rows["animals"] = [animal({ id: "cow-1", barn_name: "Patience", ear_tag: "0" })];
    rows["cost_entries"] = [{ animal_id: "cow-1", amount_cents: 7500 }];
    rows["revenue_entries"] = [];

    const fetchDashboardData = await load();
    const data = await fetchDashboardData("2026-08-10", { businessId: 5, farmId: "farm-1" });
    expect(data.hasCostData).toBe(true);
  });
});
