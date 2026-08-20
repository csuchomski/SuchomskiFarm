// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PaymentMethodOption } from "../lib/payment-methods";

/**
 * Settings → Payments: what this farm takes.
 *
 * The list was one global three shared by every business on the instance.
 * Now each farm has its own, and this is where it decides — so the things
 * worth pinning are the ones that would quietly undo that.
 *
 * **Nothing is deleted, only retired.** Every order paid that way still names
 * the method, and the books have to keep being able to say how the money came
 * in. `orders.payment_method` carries a foreign key that would refuse the
 * delete anyway; offering the button at all would just be a dead end.
 *
 * **The business goes with every write.** Without it a farm would be editing
 * whichever list the database reached first, which is the shared-row problem
 * all over again.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };
let role = "owner";

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd", "store"], farmId: "farm-1", role,
    userId: "u1", migrated: true, setBusinessId: vi.fn(), reload: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
  useHasModule: () => true,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const method = (over: Partial<PaymentMethodOption> & { code: string }): PaymentMethodOption => ({
  label: over.code, active: true, sort_order: 10, business_id: 5, ...over,
});

let methods: PaymentMethodOption[] = [];

const fetchAllPaymentMethods = vi.fn(async (_b: number) => methods);
const addPaymentMethod = vi.fn(async (_b: number, _label: string) => undefined);
const renamePaymentMethod = vi.fn(async (_b: number, _c: string, _l: string) => undefined);
const setMethodActive = vi.fn(async (_b: number, _c: string, _a: boolean) => undefined);

vi.mock("../lib/payment-methods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/payment-methods")>()),
  fetchAllPaymentMethods: (b: number) => fetchAllPaymentMethods(b),
  addPaymentMethod: (b: number, l: string) => addPaymentMethod(b, l),
  renamePaymentMethod: (b: number, c: string, l: string) => renamePaymentMethod(b, c, l),
  setMethodActive: (b: number, c: string, a: boolean) => setMethodActive(b, c, a),
}));

beforeEach(() => {
  role = "owner";
  // Labels deliberately unlike their codes: the code is what an order
  // carries and the label is what a customer reads, and this page has to
  // keep them apart.
  methods = [
    method({ code: "Cash", label: "Cash at the gate", sort_order: 10 }),
    method({ code: "Venmo", label: "Venmo to Meghan", sort_order: 20 }),
    method({ code: "Check", label: "Cheque", sort_order: 30, active: false }),
  ];
  vi.clearAllMocks();
});
afterEach(cleanup);

const mount = async () => {
  const { default: Payments } = await import("./Payments");
  render(<MemoryRouter><Payments /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

describe("the list", () => {
  it("reads this business's own, and says how many are on offer", async () => {
    await mount();
    expect(fetchAllPaymentMethods).toHaveBeenCalledWith(5);
    expect(screen.getByText("Cash at the gate")).toBeTruthy();
    expect(screen.getByText(/2 ways to pay/)).toBeTruthy();
  });

  it("keeps a retired method visible, marked, rather than hiding it", async () => {
    // It still has to be findable to be put back, and every order paid that
    // way still names it.
    await mount();
    expect(screen.getByText("Cheque")).toBeTruthy();
    expect(screen.getByText("retired")).toBeTruthy();
  });

  it("says plainly when a farm takes nothing", async () => {
    methods = [method({ code: "Cash", label: "Cash at the gate", active: false })];
    await mount();
    expect(screen.getByText(/Nothing is on offer/)).toBeTruthy();
  });
});

describe("deciding what the farm takes", () => {
  it("adds one, with the business it belongs to", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Another way to pay" }));
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "Zelle" } });
    fireEvent.click(screen.getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(addPaymentMethod).toHaveBeenCalledWith(5, "Zelle"));
  });

  it("will not add one the farm already has", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Another way to pay" }));
    fireEvent.change(screen.getByLabelText("Payment method"), { target: { value: "cash" } });
    expect(screen.getByText(/already on the list/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add it" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renames the label without touching the code the orders carry", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "rename Venmo to Meghan" }));
    fireEvent.change(screen.getByLabelText("Rename Venmo to Meghan"), { target: { value: "Venmo (Meghan)" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(renamePaymentMethod).toHaveBeenCalledWith(5, "Venmo", "Venmo (Meghan)"),
    );
  });

  it("retires rather than deletes", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: "remove Cash at the gate" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "retire Cash at the gate" }));
    await waitFor(() => expect(setMethodActive).toHaveBeenCalledWith(5, "Cash", false));
    expect(screen.getByText(/Orders already paid that way keep it/)).toBeTruthy();
  });

  it("puts a retired one back", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "put Cheque back" }));
    await waitFor(() => expect(setMethodActive).toHaveBeenCalledWith(5, "Check", true));
  });

  it("says so when a write is refused rather than looking like it worked", async () => {
    setMethodActive.mockRejectedValueOnce(new Error("new row violates row-level security policy"));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "retire Cash at the gate" }));
    await waitFor(() => expect(screen.getByText(/row-level security/)).toBeTruthy());
  });
});

describe("who may decide", () => {
  it("reads for a helper, and says that is what it is doing", async () => {
    role = "helper";
    await mount();
    expect(screen.getByText(/You are a helper on this farm/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Another way to pay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "retire Cash at the gate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "rename Venmo to Meghan" })).toBeNull();
    // and still shows the list, which is worth reading
    expect(screen.getByText("Cash at the gate")).toBeTruthy();
  });
});
