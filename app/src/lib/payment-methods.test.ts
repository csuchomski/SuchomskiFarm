import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The fallback is the whole point of these.
 *
 * Before migration 022 both pickup functions carried `not in ('Cash','Venmo')`
 * as a literal, so a form offering Check would be refused by the database at
 * the moment of collection. If public.payment_methods isn't there, the app is
 * talking to a database that still behaves that way and has to offer the old
 * pair — quietly widening the list would produce exactly that failure.
 */

const result: { data: unknown; error: { message: string } | null } = { data: null, error: null };

vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve(result),
      }),
    }),
  },
}));

const load = async () => {
  const mod = await import("./payment-methods");
  return mod;
};

afterEach(() => {
  result.data = null;
  result.error = null;
});

describe("fetchPaymentMethods", () => {
  it("returns the active methods, in the table's order", async () => {
    result.data = [
      { code: "Cash", label: "Cash", active: true, sort_order: 10 },
      { code: "Venmo", label: "Venmo", active: true, sort_order: 20 },
      { code: "Check", label: "Check", active: true, sort_order: 30 },
    ];
    const { fetchPaymentMethods } = await load();
    expect((await fetchPaymentMethods()).map((m) => m.code)).toEqual(["Cash", "Venmo", "Check"]);
  });

  it("leaves a retired method out, the same way the functions do", async () => {
    result.data = [
      { code: "Cash", label: "Cash", active: true, sort_order: 10 },
      { code: "Venmo", label: "Venmo", active: false, sort_order: 20 },
    ];
    const { fetchPaymentMethods } = await load();
    expect((await fetchPaymentMethods()).map((m) => m.code)).toEqual(["Cash"]);
  });

  it("falls back to the pre-022 pair when the table isn't there", async () => {
    result.error = { message: 'relation "public.payment_methods" does not exist' };
    const { fetchPaymentMethods, FALLBACK_PAYMENT_METHODS } = await load();
    expect(await fetchPaymentMethods()).toEqual(FALLBACK_PAYMENT_METHODS);
  });

  it("does not offer Check in that fallback, because the database would refuse it", async () => {
    const { FALLBACK_PAYMENT_METHODS } = await load();
    expect(FALLBACK_PAYMENT_METHODS.map((m) => m.code)).toEqual(["Cash", "Venmo"]);
  });

  it("falls back rather than offering nothing when every method is retired", async () => {
    // An empty dropdown makes a pickup impossible to complete. The old pair
    // is a worse answer than the table's, and a better one than none.
    result.data = [{ code: "Cash", label: "Cash", active: false, sort_order: 10 }];
    const { fetchPaymentMethods, FALLBACK_PAYMENT_METHODS } = await load();
    expect(await fetchPaymentMethods()).toEqual(FALLBACK_PAYMENT_METHODS);
  });

  it("raises anything that isn't a missing table", async () => {
    result.error = { message: "permission denied for table payment_methods" };
    const { fetchPaymentMethods } = await load();
    await expect(fetchPaymentMethods()).rejects.toThrow(/permission denied/);
  });
});

describe("methodCodes", () => {
  it("is just the codes, which is what validation compares against", async () => {
    const { methodCodes } = await load();
    expect(methodCodes([{ code: "Check", label: "Cheque", active: true, sort_order: 1 }])).toEqual(["Check"]);
  });
});
