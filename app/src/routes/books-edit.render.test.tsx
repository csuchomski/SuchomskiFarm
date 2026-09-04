// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * Correcting a posted entry.
 *
 * The ledger could be added to and never changed, so a mis-keyed amount or an
 * entry filed against the wrong business could only be fixed in the database.
 * These drive the panel that fixes it — and the two things that panel has to
 * be honest about, because nothing in the schema enforces either: the table
 * keeps no history, so a delete is final; and an attribution split against
 * the old amount is not re-split by changing it.
 */

const farm = { id: 5, name: "Suchomski Family Farm", type: "farm" };
const rental = { id: 7, name: "Lyd Street Rental", type: "rental" };

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [farm, rental], business: farm,
    modules: ["herd", "store", "books"], farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const tx = (over: Record<string, unknown> = {}) => ({
  id: 5, business_id: 5, date: "2026-07-20", type: "expense", category: "Feed",
  amount: 30, note: "Co-op feed", payer: "Co-op", account: "Landmark CU - Farm",
  ...over,
});

let transactions = [tx(), tx({ id: 2, type: "income", note: "Milk", amount: 20, payer: "Thomas" })];

const booksData = () => ({
  businesses: [farm, rental],
  accounts: [
    { id: 3, name: "Landmark CU - Farm", opening_balance: 454.54, business_id: 5 },
    { id: 4, name: "Lyd Street Checking", opening_balance: 0, business_id: 7 },
  ],
  transactions,
  types: [
    { code: "income", label: "Income", direction: "income" as const, active: true, sort_order: 10 },
    { code: "expense", label: "Expense", direction: "expense" as const, active: true, sort_order: 20 },
    { code: "old_thing", label: "Retired type", direction: "expense" as const, active: false, sort_order: 30 },
  ],
  typesTableExists: true,
});

const updateFn = vi.fn(async (_i: unknown) => tx());
const deleteFn = vi.fn(async (_id: number) => undefined);
let updateThrows: string | null = null;

vi.mock("../lib/books-data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/books-data")>()),
  fetchBooksData: vi.fn(async () => booksData()),
  updateTransaction: (i: unknown) => {
    if (updateThrows !== null) throw new Error(updateThrows);
    return updateFn(i);
  },
  deleteTransaction: (id: number) => deleteFn(id),
}));

vi.mock("../lib/tax", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/tax")>()),
  fetchTaxCategories: vi.fn(async () => []),
}));

vi.mock("../lib/herd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/herd")>()),
  fetchAnimals: vi.fn(async () => [{ id: "cow-1", ear_tag: "101", barn_name: "Rosie" }]),
}));

const unattributeFn = vi.fn(async () => undefined);
/** Transaction 5 carries $30 across one animal unless a test says otherwise. */
let existing: { id: string; kind: "cost" | "revenue"; transactionId: number; animalId: string; amount: number }[] = [];

vi.mock("../lib/attribution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/attribution")>()),
  fetchAttributions: vi.fn(async () => existing),
  fetchExpenseCategories: vi.fn(async () => [{ id: "cat-feed", code: "feed", label: "Feed and hay" }]),
  unattribute: () => unattributeFn(),
}));

beforeEach(() => {
  transactions = [tx(), tx({ id: 2, type: "income", note: "Milk", amount: 20, payer: "Thomas" })];
  existing = [];
  updateThrows = null;
  updateFn.mockClear();
  deleteFn.mockClear();
  unattributeFn.mockClear();
});

afterEach(cleanup);

const mount = async () => {
  const { default: BooksTransactions } = await import("./BooksTransactions");
  render(<MemoryRouter><BooksTransactions /></MemoryRouter>);
  await waitFor(() => expect(screen.queryAllByText("Loading the books…")).toHaveLength(0));
};

const open = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const sel = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

describe("getting into an entry", () => {
  it("opens the entry behind its description", async () => {
    await mount();
    expect(screen.queryByLabelText("Edit amount")).toBeNull();
    open("Co-op feed");
    expect(screen.getByLabelText("Edit amount")).toBeTruthy();
  });

  it("gives an entry with no description something to click", async () => {
    // The cell used to render "—" for a blank note. A dash is not a control,
    // and an entry nobody described is exactly the one worth opening.
    transactions = [tx({ note: null })];
    await mount();
    open("(no description)");
    expect(screen.getByLabelText("Edit amount")).toBeTruthy();
  });

  it("fills the panel with what was posted", async () => {
    await mount();
    open("Co-op feed");
    expect(field("Edit date").value).toBe("2026-07-20");
    expect(field("Edit description").value).toBe("Co-op feed");
    expect(field("Edit category").value).toBe("Feed");
    expect(field("Edit payer").value).toBe("Co-op");
    expect(field("Edit account").value).toBe("Landmark CU - Farm");
    expect(sel("Edit type").value).toBe("expense");
    expect(sel("Edit business").value).toBe("5");
  });

  it("shows the amount positive, the way it is entered", async () => {
    // The type carries the direction. A minus sign in the box would post as
    // a positive anyway, so showing one would be a lie about what saves.
    transactions = [tx({ amount: -30 })];
    await mount();
    open("Co-op feed");
    expect(field("Edit amount").value).toBe("30");
  });

  it("closes again on a second click", async () => {
    await mount();
    open("Co-op feed");
    open("Co-op feed");
    expect(screen.queryByLabelText("Edit amount")).toBeNull();
  });

  it("keeps a retired type on the entry that already carries it", async () => {
    // Filtering to active types would silently re-file an old entry under
    // whatever happened to be first in the list.
    transactions = [tx({ type: "old_thing" })];
    await mount();
    open("Co-op feed");
    expect(sel("Edit type").value).toBe("old_thing");
  });
});

describe("saving a correction", () => {
  it("writes every field it showed", async () => {
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit amount"), { target: { value: "42.50" } });
    fireEvent.change(field("Edit description"), { target: { value: "Co-op feed, corrected" } });
    fireEvent.change(field("Edit payer"), { target: { value: "The Co-op" } });
    open("Save changes");
    await waitFor(() => expect(updateFn).toHaveBeenCalled());
    expect(updateFn.mock.calls[0][0]).toMatchObject({
      id: 5, amount: 42.5, note: "Co-op feed, corrected", payer: "The Co-op",
    });
  });

  it("can move an entry to another business", async () => {
    // A cheque written for the rental and logged against the farm is one of
    // the likelier things anybody opens this panel to fix.
    await mount();
    open("Co-op feed");
    fireEvent.change(sel("Edit business"), { target: { value: "7" } });
    open("Save changes");
    await waitFor(() => expect(updateFn).toHaveBeenCalled());
    expect(updateFn.mock.calls[0][0]).toMatchObject({ businessId: 7 });
  });

  it("posts the amount positive however it was typed", async () => {
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit amount"), { target: { value: "-42.50" } });
    open("Save changes");
    await waitFor(() => expect(updateFn).toHaveBeenCalled());
    expect(updateFn.mock.calls[0][0]).toMatchObject({ amount: 42.5 });
  });

  it("will not save an entry with no payer, which the column refuses", async () => {
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit payer"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("will not save an amount of nothing", async () => {
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit amount"), { target: { value: "0" } });
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the panel open and says so when the write fails", async () => {
    updateThrows = "new row violates row-level security policy";
    await mount();
    open("Co-op feed");
    open("Save changes");
    await waitFor(() => expect(screen.getByText(/row-level security/)).toBeTruthy());
    expect(screen.getByLabelText("Edit amount")).toBeTruthy();
  });

  it("drops the draft on cancel rather than writing it", async () => {
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit amount"), { target: { value: "999" } });
    open("Cancel");
    expect(updateFn).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Edit amount")).toBeNull();
  });
});

describe("an entry that is attributed to animals", () => {
  beforeEach(() => {
    existing = [{ id: "cost-1", kind: "cost", transactionId: 5, animalId: "cow-1", amount: 30 }];
  });

  it("says when the new amount is under what is already on the animals", async () => {
    // Nothing in the schema enforces this, so the page is the only thing that
    // will ever mention it.
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit amount"), { target: { value: "10" } });
    expect(screen.getByText(/already attributed/)).toBeTruthy();
    expect(screen.getByText(/no longer adds up/)).toBeTruthy();
  });

  it("does not block the save on it", async () => {
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit amount"), { target: { value: "10" } });
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says nothing when the amount still covers the split", async () => {
    await mount();
    open("Co-op feed");
    fireEvent.change(field("Edit amount"), { target: { value: "40" } });
    expect(screen.queryByText(/already attributed/)).toBeNull();
  });
});

describe("deleting an entry", () => {
  it("asks before it does it", async () => {
    await mount();
    open("Co-op feed");
    open("Delete this entry");
    expect(deleteFn).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Yes, delete it" })).toBeTruthy();
  });

  it("says it cannot be undone, because the table keeps no history", async () => {
    await mount();
    open("Co-op feed");
    open("Delete this entry");
    expect(screen.getByText(/keeps no history of deleted entries/)).toBeTruthy();
  });

  it("backs out on keep it", async () => {
    await mount();
    open("Co-op feed");
    open("Delete this entry");
    open("Keep it");
    expect(deleteFn).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Edit amount")).toBeTruthy();
  });

  it("deletes on the second press", async () => {
    await mount();
    open("Co-op feed");
    open("Delete this entry");
    open("Yes, delete it");
    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith(5));
  });

  it("takes the attributions off the animals first", async () => {
    // The foreign key is `on delete set null`, so deleting the transaction on
    // its own leaves an animal carrying a cost with nothing tying it back to
    // a cheque — a figure on its record that no page can explain.
    existing = [
      { id: "cost-1", kind: "cost", transactionId: 5, animalId: "cow-1", amount: 20 },
      { id: "cost-2", kind: "cost", transactionId: 5, animalId: "cow-1", amount: 10 },
    ];
    await mount();
    open("Co-op feed");
    open("Delete this entry");
    open("Yes, delete it");
    await waitFor(() => expect(deleteFn).toHaveBeenCalled());
    expect(unattributeFn).toHaveBeenCalledTimes(2);
    expect(unattributeFn.mock.invocationCallOrder[0]).toBeLessThan(deleteFn.mock.invocationCallOrder[0]);
  });

  it("says what deleting will take off the animals", async () => {
    existing = [{ id: "cost-1", kind: "cost", transactionId: 5, animalId: "cow-1", amount: 30 }];
    await mount();
    open("Co-op feed");
    open("Delete this entry");
    expect(screen.getByText(/nothing is left carrying a cost with no cheque behind it/)).toBeTruthy();
  });

  it("does not mention attributions on an entry that has none", async () => {
    await mount();
    open("Co-op feed");
    open("Delete this entry");
    expect(screen.queryByText(/carrying a cost with no cheque/)).toBeNull();
  });
});
