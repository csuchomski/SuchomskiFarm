// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * What Settings holds, and who sees which part of it.
 *
 * Settings grew from two tabs to eight by taking in the pages that are set up
 * once and then left alone — the ground, the mobs, the grazing plan, the
 * chart of accounts, the delivery schedules, and what the farm takes at the
 * gate. The two things worth pinning are the ones that break quietly.
 *
 * **Each tab is gated by its module.** Settings itself is not: a business
 * with no herd still has a name and still has people. So the gating has to be
 * inside, tab by tab, and a rental business must not be offered a mob editor.
 *
 * **Only the open tab mounts.** Eight pages that each fetch on mount would
 * mean opening Settings goes and gets the ground, the herd, the plan, the
 * breeds, the chart of accounts and every delivery schedule at once.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };
let modules: string[] = ["herd", "store", "books"];

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules, farmId: "farm-1", role: "owner",
    userId: "u1", migrated: true, setBusinessId: vi.fn(), reload: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
  useHasModule: (m: string) => modules.includes(m),
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

/** The folded pages, stubbed. This test is about which of them Settings
 *  offers and mounts, not about what any one of them draws. */
const mounted: string[] = [];
const stub = (name: string) => ({
  default: () => {
    mounted.push(name);
    return <div>{name} page</div>;
  },
});
vi.mock("./Ground", () => stub("ground"));
vi.mock("./Mobs", () => stub("mobs"));
vi.mock("./GrazingPlan", () => stub("plan"));
vi.mock("./Breeds", () => stub("breeds"));
vi.mock("./BooksAccounts", () => stub("accounts"));
vi.mock("./StoreSchedules", () => stub("schedules"));
vi.mock("./FarmAndPeople", () => stub("farm"));
vi.mock("./Payments", () => stub("payments"));

beforeEach(() => {
  modules = ["herd", "store", "books"];
  mounted.length = 0;
});
afterEach(cleanup);

const mount = async (entry = "/settings") => {
  const { default: Settings } = await import("./Settings");
  render(<MemoryRouter initialEntries={[entry]}><Settings /></MemoryRouter>);
};

const tabs = () => [...document.querySelectorAll(".gr-tab")].map((t) => t.textContent);

describe("what a farm with everything sees", () => {
  it("offers the eight, ground first", async () => {
    await mount();
    expect(tabs()).toEqual([
      "Ground",
      "Mobs",
      "Grazing plan",
      "Breeds",
      "Accounts",
      "Schedules",
      "Payments",
      "Farm & people",
    ]);
    expect(document.querySelector(".gr-tab--on")!.textContent).toBe("Ground");
  });

  it("mounts the open tab and none of the other seven", async () => {
    await mount();
    expect(mounted).toEqual(["ground"]);
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    expect(mounted).toEqual(["ground", "accounts"]);
  });

  it("opens the tab a link names, so Settings → Ground can be pointed at", async () => {
    await mount("/settings?tab=plan");
    expect(document.querySelector(".gr-tab--on")!.textContent).toBe("Grazing plan");
    expect(mounted).toEqual(["plan"]);
  });
});

describe("what a business without the module sees", () => {
  it("keeps the herd's four off a business with no herd", async () => {
    modules = ["books"];
    await mount();
    expect(tabs()).toEqual(["Accounts", "Farm & people"]);
  });

  it("keeps schedules and payments off a farm with no store", async () => {
    modules = ["herd"];
    await mount();
    expect(tabs()).toEqual(["Ground", "Mobs", "Grazing plan", "Breeds", "Farm & people"]);
  });

  it("still gives a business with no modules at all its name and its people", async () => {
    // The one tab that is never gated. With a single section the bar hides
    // itself, so the page has to still be the page rather than an empty shell.
    modules = [];
    await mount();
    expect(tabs()).toEqual([]);
    expect(mounted).toEqual(["farm"]);
    expect(screen.getByText("farm page")).toBeTruthy();
  });
});

describe("hidden is not deleted", () => {
  it("still routes the two pages that came off the rail", async () => {
    // Accounts and Schedules left the Books and Store rails for Settings.
    // A bookmark to either must still resolve, the way /breeds does.
    const src = (await import("../App.tsx?raw")).default;
    expect(src).toContain('path="/books/accounts"');
    expect(src).toContain('path="/store/schedules"');
  });

  it("takes them off the rail they were on", async () => {
    const { allGroups } = await import("../components/shell/nav");
    const labels = allGroups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels).not.toContain("Accounts");
    expect(labels).not.toContain("Schedules");
  });
});
