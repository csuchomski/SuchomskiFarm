// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { Person } from "../lib/farm-people";

/**
 * Settings → Farm & people.
 *
 * Two things that had no screen: the farm's name, and who can sign in to it.
 * The parts worth driving are the guards, because every one of them protects
 * against a mistake that needs a support request to undo.
 *
 * **You cannot demote or remove yourself.** A farm whose last owner made
 * themselves a viewer has nobody left who can put it back.
 *
 * **The last owner cannot be removed by anyone**, which is the same hole
 * reached from the other side.
 *
 * **A non-owner reads.** The policies already refuse the write; offering the
 * control anyway would mean a farmhand clicking Save and getting a database
 * error for an answer.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };
const reload = vi.fn();
let role: string | null = "owner";

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules: ["herd"], farmId: "farm-1", role,
    userId: "u1", migrated: true, setBusinessId: vi.fn(), reload,
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
  useHasModule: () => true,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

const me: Person = {
  userId: "u1", role: "owner", addedAt: "2025-03-04T12:00:00Z",
  name: "Chris Suchomski", email: "chris@example.com",
};
const helper: Person = {
  userId: "u2", role: "helper", addedAt: "2026-01-09T12:00:00Z",
  name: "Dale Kirsch", email: "dale@example.com",
};

let people: Person[] = [];

const fetchPeople = vi.fn(async (_businessId: number) => people);
const renameFarm = vi.fn(async (_i: { businessId: number; farmId: string | null; name: string }) => undefined);
const setPersonRole = vi.fn(async (_b: number, _u: string, _r: Person["role"]) => undefined);
const removePerson = vi.fn(async (_b: number, _u: string) => undefined);

vi.mock("../lib/farm-people", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/farm-people")>()),
  fetchPeople: (b: number) => fetchPeople(b),
  renameFarm: (i: { businessId: number; farmId: string | null; name: string }) => renameFarm(i),
  setPersonRole: (b: number, u: string, r: Person["role"]) => setPersonRole(b, u, r),
  removePerson: (b: number, u: string) => removePerson(b, u),
}));

beforeEach(() => {
  role = "owner";
  people = [me, helper];
  vi.clearAllMocks();
});
afterEach(cleanup);

const mount = async () => {
  const { default: FarmAndPeople } = await import("./FarmAndPeople");
  render(<MemoryRouter><FarmAndPeople /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
};

describe("the farm's name", () => {
  it("starts on the name the farm already has, and will not save until it changes", async () => {
    await mount();
    const input = screen.getByLabelText("Farm name") as HTMLInputElement;
    expect(input.value).toBe("Suchomski Family Farm");
    expect((screen.getByRole("button", { name: "Save the name" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the new name and tells the rest of the app to re-read it", async () => {
    // The name is on the rail and on the printed record. Without the reload
    // the topbar keeps showing the old one until a refresh.
    await mount();
    fireEvent.change(screen.getByLabelText("Farm name"), { target: { value: "  Rocky Ridge Farm  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save the name" }));
    await waitFor(() => expect(renameFarm).toHaveBeenCalled());
    expect(renameFarm.mock.calls[0][0]).toEqual({
      businessId: 5, farmId: "farm-1", name: "  Rocky Ridge Farm  ",
    });
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.getByText("The farm is called Rocky Ridge Farm now.")).toBeTruthy();
  });

  it("refuses a farm with no name at all", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Farm name"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Save the name" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so when the save fails rather than looking like it worked", async () => {
    renameFarm.mockRejectedValueOnce(new Error("businesses: new row violates policy"));
    await mount();
    fireEvent.change(screen.getByLabelText("Farm name"), { target: { value: "Nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the name" }));
    await waitFor(() => expect(screen.getByText(/violates policy/)).toBeTruthy());
  });
});

describe("who can sign in", () => {
  it("lists them, and marks which one is you", async () => {
    await mount();
    expect(fetchPeople).toHaveBeenCalledWith(5);
    expect(screen.getByText("Chris Suchomski")).toBeTruthy();
    expect(screen.getByText("Dale Kirsch")).toBeTruthy();
    expect(screen.getByText("you")).toBeTruthy();
    expect(screen.getByText("2 people have access to this farm.")).toBeTruthy();
  });

  it("names somebody with no profile row rather than showing a blank", async () => {
    people = [me, { ...helper, name: null, email: null }];
    await mount();
    expect(screen.getByText("Somebody with no profile yet")).toBeTruthy();
  });

  it("shows what each person can do now, rather than the first role on the list", async () => {
    await mount();
    expect((screen.getByLabelText("What Dale Kirsch can do") as HTMLSelectElement).value).toBe(
      "helper",
    );
  });

  it("changes what a helper may do", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("What Dale Kirsch can do"), { target: { value: "viewer" } });
    await waitFor(() => expect(setPersonRole).toHaveBeenCalledWith(5, "u2", "viewer"));
  });

  it("asks before it removes anybody", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove Dale Kirsch" }));
    expect(removePerson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "really remove Dale Kirsch" }));
    await waitFor(() => expect(removePerson).toHaveBeenCalledWith(5, "u2"));
  });

  it("lets the ask be backed out of", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove Dale Kirsch" }));
    fireEvent.click(screen.getByRole("button", { name: "keep" }));
    expect(screen.getByRole("button", { name: "remove Dale Kirsch" })).toBeTruthy();
    expect(removePerson).not.toHaveBeenCalled();
  });
});

describe("the guards", () => {
  it("gives you no way to demote or remove yourself", async () => {
    await mount();
    expect(screen.queryByLabelText("What Chris Suchomski can do")).toBeNull();
    expect(screen.queryByRole("button", { name: "remove Chris Suchomski" })).toBeNull();
    expect(screen.getByText("yourself")).toBeTruthy();
  });

  it("says which row is the only owner, so nobody looks for the missing button", async () => {
    // Signed in as somebody who is not a member row at all — a farmer reading
    // another farm, whose role comes back null. There are no controls, and
    // the owner's row says why rather than sitting blank.
    role = null;
    people = [{ ...me, userId: "u9", name: "Pat Owner" }, helper];
    await mount();
    expect(screen.getByText("the only owner")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "remove Pat Owner" })).toBeNull();
  });

  it("removes an owner when there is another one left", async () => {
    people = [{ ...me, userId: "u9", name: "Pat Owner" }, { ...helper, userId: "u1", role: "owner" }];
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "remove Pat Owner" }));
    fireEvent.click(screen.getByRole("button", { name: "really remove Pat Owner" }));
    await waitFor(() => expect(removePerson).toHaveBeenCalledWith(5, "u9"));
  });

  it("reads for a helper, and says that is what it is doing", async () => {
    role = "helper";
    await mount();
    expect((screen.getByLabelText("Farm name") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save the name" })).toBeNull();
    expect(screen.queryByLabelText("What Dale Kirsch can do")).toBeNull();
    expect(screen.queryByRole("button", { name: "remove Dale Kirsch" })).toBeNull();
    expect(screen.getByText(/You are a helper on this farm/)).toBeTruthy();
  });
});
