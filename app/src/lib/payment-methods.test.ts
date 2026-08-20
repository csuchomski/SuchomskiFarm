import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What a farm takes, and whose farm it is.
 *
 * Two rules meet in this file.
 *
 * **The fallback.** Before migration 022 both pickup functions carried
 * `not in ('Cash','Venmo')` as a literal, so a form offering Check would be
 * refused by the database at the moment of collection. If
 * `public.payment_methods` isn't there, the app is talking to a database that
 * still behaves that way and has to offer the old pair — quietly widening the
 * list would produce exactly that failure.
 *
 * **The business.** Since migration 057 the list belongs to a business: one
 * farm takes Zelle, the next takes cash at the gate. Every read is scoped,
 * and an empty result is now a real answer rather than a reason to fall back
 * — a farm that has switched every method off takes none, and offering Cash
 * anyway would be the 022 failure again, in the other direction.
 */

const result: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const filters: { businessId: number | null }[] = [];

vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const rows = {
          eq: (_col: string, value: number) => {
            filters.push({ businessId: value });
            return { order: () => Promise.resolve(result) };
          },
          order: () => {
            filters.push({ businessId: null });
            return Promise.resolve(result);
          },
        };
        return rows;
      },
    }),
  },
}));

const load = async () => {
  const mod = await import("./payment-methods");
  return mod;
};

const method = (over: Partial<{ code: string; label: string; active: boolean; sort_order: number; business_id: number }>) => ({
  code: "Cash", label: "Cash", active: true, sort_order: 10, business_id: 5, ...over,
});

afterEach(() => {
  result.data = null;
  result.error = null;
  filters.length = 0;
});

describe("fetchPaymentMethods", () => {
  it("asks for one business's methods, in the table's order", async () => {
    result.data = [
      method({ code: "Cash", sort_order: 10 }),
      method({ code: "Venmo", label: "Venmo", sort_order: 20 }),
      method({ code: "Check", label: "Check", sort_order: 30 }),
    ];
    const { fetchPaymentMethods } = await load();
    expect((await fetchPaymentMethods(5)).map((m) => m.code)).toEqual(["Cash", "Venmo", "Check"]);
    expect(filters).toEqual([{ businessId: 5 }]);
  });

  it("leaves a retired method out, the same way the functions do", async () => {
    result.data = [method({ code: "Cash" }), method({ code: "Venmo", active: false })];
    const { fetchPaymentMethods } = await load();
    expect((await fetchPaymentMethods(5)).map((m) => m.code)).toEqual(["Cash"]);
  });

  it("falls back to the pre-022 pair when the table isn't there", async () => {
    result.error = { message: 'relation "public.payment_methods" does not exist' };
    const { fetchPaymentMethods, FALLBACK_PAYMENT_METHODS } = await load();
    expect(await fetchPaymentMethods(5)).toEqual(FALLBACK_PAYMENT_METHODS);
  });

  it("does not offer Check in that fallback, because the database would refuse it", async () => {
    const { FALLBACK_PAYMENT_METHODS } = await load();
    expect(FALLBACK_PAYMENT_METHODS.map((m) => m.code)).toEqual(["Cash", "Venmo"]);
  });

  it("offers nothing when a farm has retired everything, rather than the old pair", async () => {
    // The rule changed with 057 and the reason inverted with it. A farm's
    // empty list is a decision, and `orders.payment_method` now carries a
    // composite foreign key — offering Cash to a farm that does not have a
    // Cash row would be refused at the moment of collection.
    result.data = [method({ code: "Cash", active: false })];
    const { fetchPaymentMethods } = await load();
    expect(await fetchPaymentMethods(5)).toEqual([]);
  });

  it("raises anything that isn't a missing table", async () => {
    result.error = { message: "permission denied for table payment_methods" };
    const { fetchPaymentMethods } = await load();
    await expect(fetchPaymentMethods(5)).rejects.toThrow(/permission denied/);
  });
});

describe("fetchShopPaymentMethods", () => {
  it("reads every shop's, because the storefront spans businesses", async () => {
    result.data = [method({ business_id: 5 }), method({ code: "Zelle", business_id: 13 })];
    const { fetchShopPaymentMethods } = await load();
    expect(await fetchShopPaymentMethods()).toHaveLength(2);
    expect(filters).toEqual([{ businessId: null }]);
  });
});

describe("methodsFor", () => {
  it("keeps the seller's methods and drops the other farm's", async () => {
    const { methodsFor } = await load();
    const all = [method({ code: "Cash", business_id: 5 }), method({ code: "Zelle", business_id: 13 })];
    expect(methodsFor(all, 5).map((m) => m.code)).toEqual(["Cash"]);
    expect(methodsFor(all, 13).map((m) => m.code)).toEqual(["Zelle"]);
  });

  it("keeps the fallback list, which belongs to no business and answers for all", async () => {
    const { methodsFor, FALLBACK_PAYMENT_METHODS } = await load();
    expect(methodsFor(FALLBACK_PAYMENT_METHODS, 5)).toHaveLength(2);
  });

  it("offers nothing for a product whose shop is unknown", async () => {
    const { methodsFor } = await load();
    expect(methodsFor([method({ business_id: 5 })], null)).toEqual([]);
  });
});

describe("methodCodes", () => {
  it("is just the codes, which is what validation compares against", async () => {
    const { methodCodes } = await load();
    expect(methodCodes([method({ code: "Check", label: "Cheque" })])).toEqual(["Check"]);
  });
});
