// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

/**
 * The farmer hearing from the shop: a customer reserved, started a weekly
 * pickup, or confirmed a pickup. Listed on Alerts, counted beside Alerts in
 * the menu, summed up on Today — and only for the owner, whose the store is.
 *
 * The client is faked at the table level rather than by stubbing lib/
 * store-alerts, so "since you last looked" and "mark as seen" are exercised
 * through the same reads and the same filter the app sends.
 */

const business = { id: 5, name: "Suchomski Family Farm", type: "farm" };
let role = "owner";
let modules = ["herd", "store", "books"];

vi.mock("../lib/workspace", () => ({
  useWorkspace: () => ({
    loading: false, error: null, businesses: [business], business,
    modules, farmId: "farm-1", role,
    userId: "u1", migrated: true, setBusinessId: vi.fn(), reload: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { user: { id: "u1" } }, loading: false }),
  signOut: vi.fn(),
}));

vi.mock("../lib/alerts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/alerts")>();
  return { ...actual, fetchAlertInputs: vi.fn(async () => ({})), buildAlerts: vi.fn(() => []) };
});

vi.mock("../lib/dashboard-data", () => ({
  fetchDashboardData: vi.fn(async () => ({
    today: "2026-10-21",
    animals: [], profitPerHead: [], transactionsToday: [],
    milkTodayQuantity: 0, milkTodayUnit: null, milkIdentifiedByName: false,
    batchesToday: 0, claimed: 0, openToShop: 0, openOrders: 0,
    monthNet: 0, monthEntries: 0, hasCostData: false,
  })),
}));

const NOW = new Date("2026-10-21T15:00:00Z");
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(NOW);
afterAll(() => vi.useRealTimers());

type Row = Record<string, unknown>;
const db: {
  store_events: Row[];
  store_event_marks: Row[];
  profiles: Row[];
  products: Row[];
} = {
  store_events: [],
  store_event_marks: [],
  profiles: [],
  products: [],
};

const seenMark = (e: Row) => db.store_event_marks.find((m) => m.event_id === e.id && m.seen_at !== null);
type View = keyof typeof db | "store_events_unseen" | "store_events_seen";

/** The views from 077, worked out the same way, for this one person. */
const view = (v: View): Row[] => {
  if (v === "store_events_unseen") return db.store_events.filter((e) => !seenMark(e));
  if (v === "store_events_seen")
    return db.store_events.filter(seenMark).map((e) => ({ ...e, seen_at: seenMark(e)!.seen_at }));
  return db[v];
};

/** As if "Mark all as seen" had been pressed at some earlier time. */
const seenUpTo = (at: string, seenAt = at) => {
  for (const e of db.store_events) if (String(e.at) <= at) db.store_event_marks.push({ event_id: e.id, seen_at: seenAt });
};

const rpcCalls: { fn: string; args: Row }[] = [];
const viewsRead: string[] = [];

const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

beforeEach(() => {
  role = "owner";
  modules = ["herd", "store", "books"];
  rpcCalls.length = 0;
  viewsRead.length = 0;
  db.store_event_marks = [];
  db.profiles = [
    { id: "meg", first_name: "Meghan", last_name: "Suchomski", email: "meg@example.com" },
    { id: "tom", first_name: "", last_name: "", email: "tom@example.com" },
  ];
  db.products = [
    { id: 1, name: "Raw milk", unit: "gallon" },
    { id: 2, name: "Eggs", unit: "dozen" },
  ];
  db.store_events = [
    { id: 11, business_id: 5, kind: "reserved", customer_id: "meg", product_id: 1, order_id: 100,
      schedule_id: null, quantity: 2, weekday: null, at: minsAgo(12) },
    { id: 12, business_id: 5, kind: "scheduled", customer_id: "tom", product_id: 2, order_id: null,
      schedule_id: 7, quantity: "1", weekday: "Wednesday", at: minsAgo(5) },
    { id: 13, business_id: 5, kind: "picked_up", customer_id: "meg", product_id: 1, order_id: 101,
      schedule_id: 7, quantity: 1, weekday: null, at: minsAgo(60 * 26) },
    // Another farm's: never on this one's page.
    { id: 14, business_id: 9, kind: "reserved", customer_id: "meg", product_id: 1, order_id: 102,
      schedule_id: null, quantity: 9, weekday: null, at: minsAgo(1) },
  ];
});

/** Enough of PostgREST's builder for these reads: eq, gt, in, order, limit,
 *  maybeSingle, and a head count. */
function query(table: View) {
  const filters: ((r: Row) => boolean)[] = [];
  let desc: string | null = null;
  let limit = Infinity;
  let head = false;
  let single = false;
  const run = () => {
    let rows = view(table).filter((r) => filters.every((f) => f(r)));
    if (desc) rows = [...rows].sort((a, b) => String(b[desc!]).localeCompare(String(a[desc!])));
    rows = rows.slice(0, limit);
    if (head) return { data: null, count: rows.length, error: null };
    if (single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };
  const b = {
    select: (_cols: string, opts?: { head?: boolean }) => ((head = !!opts?.head), b),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
    gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), b),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
    order: (c: string, o: { ascending: boolean }) => ((desc = o.ascending ? null : c), b),
    limit: (n: number) => ((limit = n), b),
    maybeSingle: () => ((single = true), b),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
  };
  return b;
}

vi.mock("../lib/supabase", () => {
  const client = {
    from: (t: View) => (viewsRead.push(t), query(t)),
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      const mark = (id: unknown, seen_at: string | null) => {
        const m = db.store_event_marks.find((x) => x.event_id === id);
        if (m) m.seen_at = seen_at;
        else db.store_event_marks.push({ event_id: id, seen_at });
      };
      if (fn === "mark_store_events_seen")
        for (const e of db.store_events)
          if (e.business_id === args.p_business_id && String(e.at) <= String(args.p_through) && !seenMark(e))
            mark(e.id, NOW.toISOString());
      if (fn === "mark_store_event_seen") mark(args.p_event_id, NOW.toISOString());
      if (fn === "mark_store_event_unseen") mark(args.p_event_id, null);
      return { data: null, error: null };
    },
  };
  return { supabase: { ...client, schema: () => client }, herdSchema: () => client };
});

afterEach(cleanup);

const mountAlerts = async () => {
  const { default: Alerts } = await import("./Alerts");
  render(
    <MemoryRouter initialEntries={["/alerts"]}>
      <Alerts />
    </MemoryRouter>,
  );
};

const storeSection = () => screen.getByRole("region", { name: "Farm store" });

describe("Alerts · from the farm store", () => {
  it("lists what customers did, newest first, in words", async () => {
    await mountAlerts();
    await screen.findByText("tom@example.com started a weekly pickup");
    const titles = within(storeSection())
      .getAllByRole("link")
      .map((a) => a.querySelector(".alert-row__title")!.textContent);
    expect(titles).toEqual([
      "tom@example.com started a weekly pickup",
      "Meghan Suchomski reserved 2 gallon of raw milk",
      "Meghan Suchomski picked up 1 gallon of raw milk",
    ]);
    expect(screen.getByText("1 dozen of eggs, every Wednesday")).toBeTruthy();
    expect(screen.getByText("This week of a weekly pickup")).toBeTruthy();
  });

  it("keeps to this farm", async () => {
    await mountAlerts();
    await screen.findByText(/reserved 2 gallon/);
    expect(screen.queryByText(/reserved 9 gallon/)).toBeNull();
  });

  it("says when, and what kind", async () => {
    await mountAlerts();
    const row = (await screen.findByText(/reserved 2 gallon/)).closest<HTMLElement>(".alert-row")!;
    expect(within(row).getByText("12 min ago")).toBeTruthy();
    expect(within(row).getByText("Reserved")).toBeTruthy();
    const older = screen.getByText(/picked up 1 gallon/).closest<HTMLElement>(".alert-row")!;
    expect(within(older).getByText("yesterday")).toBeTruthy();
  });

  it("sends each row to where the farmer acts on it", async () => {
    await mountAlerts();
    const href = (t: RegExp) => screen.getByText(t).closest("a")!.getAttribute("href");
    await screen.findByText(/reserved 2 gallon/);
    expect(href(/reserved 2 gallon/)).toBe("/store/orders");
    expect(href(/started a weekly pickup/)).toBe("/store/schedules");
    expect(href(/picked up 1 gallon/)).toBe("/store/customers/meg");
  });

  it("shows only what came after the last clearing", async () => {
    seenUpTo(minsAgo(10));
    await mountAlerts();
    await screen.findByText(/started a weekly pickup/);
    expect(screen.queryByText(/reserved 2 gallon/)).toBeNull();
    expect(screen.queryByText(/picked up 1 gallon/)).toBeNull();
  });

  it("clears through the newest one listed, not through now", async () => {
    await mountAlerts();
    fireEvent.click(await screen.findByRole("button", { name: "Mark all as seen" }));
    await screen.findByText("Nothing new since you last looked.");
    expect(rpcCalls).toEqual([
      { fn: "mark_store_events_seen", args: { p_business_id: 5, p_through: minsAgo(5) } },
    ]);
  });

  it("takes the count off the menu when cleared", async () => {
    await mountAlerts();
    const alertsLink = await screen.findByRole("link", { name: /^Alerts/ });
    await waitFor(() => expect(within(alertsLink).getByLabelText("3 new from the farm store")).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: "Mark all as seen" }));
    await waitFor(() => expect(within(alertsLink).queryByLabelText(/new from the farm store/)).toBeNull());
  });

  it("clears one from its own row, leaving the others", async () => {
    await mountAlerts();
    const seen = await screen.findByRole("button", { name: "Mark seen: Meghan Suchomski reserved 2 gallon of raw milk" });
    fireEvent.click(seen);
    await waitFor(() => expect(screen.queryByText(/reserved 2 gallon/)).toBeNull());
    expect(screen.getByText(/started a weekly pickup/)).toBeTruthy();
    expect(screen.getByText(/picked up 1 gallon/)).toBeTruthy();
    expect(rpcCalls).toEqual([{ fn: "mark_store_event_seen", args: { p_event_id: 11 } }]);
  });

  it("counts one fewer in the menu", async () => {
    await mountAlerts();
    const alertsLink = await screen.findByRole("link", { name: /^Alerts/ });
    await waitFor(() => expect(within(alertsLink).getByLabelText("3 new from the farm store")).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: /^Mark seen: tom@example.com/ }));
    await waitFor(() => expect(within(alertsLink).getByLabelText("2 new from the farm store")).toBeTruthy());
  });

  it("stays cleared next time the page is opened", async () => {
    await mountAlerts();
    fireEvent.click(await screen.findByRole("button", { name: /^Mark seen: Meghan Suchomski picked up/ }));
    await waitFor(() => expect(screen.queryByText(/picked up 1 gallon/)).toBeNull());
    cleanup();
    await mountAlerts();
    await screen.findByText(/reserved 2 gallon/);
    expect(screen.queryByText(/picked up 1 gallon/)).toBeNull();
  });

  it("keeps the button out of the link, so pressing it doesn't open the order", async () => {
    await mountAlerts();
    const seen = await screen.findByRole("button", { name: /^Mark seen: Meghan Suchomski reserved/ });
    expect(seen.closest("a")).toBeNull();
    // ...while the row's text still goes where the row says.
    expect(screen.getByText(/reserved 2 gallon/).closest("a")!.getAttribute("href")).toBe("/store/orders");
  });

  it("says when there's nothing left after clearing them one by one", async () => {
    await mountAlerts();
    for (const name of [/^Mark seen: tom/, /^Mark seen: Meghan Suchomski reserved/, /^Mark seen: Meghan Suchomski picked/]) {
      fireEvent.click(await screen.findByRole("button", { name }));
      await waitFor(() => expect(screen.queryByRole("button", { name })).toBeNull());
    }
    expect(screen.getByText("Nothing new since you last looked.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark all as seen" })).toBeNull();
  });

  it("reads the same as the herd's: kind first, then what, when, and the button", async () => {
    await mountAlerts();
    const row = (await screen.findByText(/reserved 2 gallon/)).closest<HTMLElement>(".alert-row")!;
    expect([...row.children].map((c) => c.className.split(" ").find((k) => k.startsWith("alert-row__")))).toEqual([
      "alert-row__kind",
      "alert-row__body",
      "alert-row__when",
      "alert-row__action",
    ]);
    expect(row.querySelector(".alert-row__kind")!.textContent).toBe("Reserved");
    expect(within(storeSection()).getByText("3", { selector: ".alert-group__count" })).toBeTruthy();
  });

  it("comes before the herd", async () => {
    await mountAlerts();
    await screen.findByText(/reserved 2 gallon/);
    const groups = [...document.querySelectorAll("section.alert-group")].map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Farm store", "Herd"]);
  });

  it("is quiet when there's nothing, with no button to press", async () => {
    db.store_events = [];
    await mountAlerts();
    await screen.findByText("Nothing new since you last looked.");
    expect(screen.queryByRole("button", { name: "Mark all as seen" })).toBeNull();
  });

  it("isn't shown to a helper — the store is the owner's", async () => {
    role = "member";
    await mountAlerts();
    await screen.findByText("Nothing needs doing.");
    expect(screen.queryByRole("region", { name: "Farm store" })).toBeNull();
    expect(screen.queryByLabelText(/new from the farm store/)).toBeNull();
  });

  it("isn't shown on a farm with no store", async () => {
    modules = ["herd", "books"];
    await mountAlerts();
    await screen.findByText("Nothing needs doing.");
    expect(screen.queryByRole("region", { name: "Farm store" })).toBeNull();
  });
});

describe("Alerts · looking back over the seen ones", () => {
  // Seen in the other order from the one they happened in: her pickup
  // (yesterday) looked at three minutes ago, her reservation half an hour ago.
  beforeEach(() => {
    db.store_event_marks = [
      { event_id: 11, seen_at: minsAgo(30) },
      { event_id: 13, seen_at: minsAgo(3) },
    ];
  });

  const seenGroup = () => screen.getByRole("group", { name: "Seen" });

  it("keeps them out of the way until asked for", async () => {
    await mountAlerts();
    await screen.findByText(/started a weekly pickup/);
    expect(screen.queryByRole("group", { name: "Seen" })).toBeNull();
    expect(screen.queryByText(/reserved 2 gallon/)).toBeNull();
    // Not even read: most visits don't want them.
    expect(viewsRead).not.toContain("store_events_seen");
    expect(screen.getByRole("button", { name: "Show seen" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("lists them, most recently seen first, saying when", async () => {
    await mountAlerts();
    fireEvent.click(await screen.findByRole("button", { name: "Show seen" }));
    await within(await screen.findByRole("group", { name: "Seen" })).findByText(/reserved 2 gallon/);
    const titles = [...seenGroup().querySelectorAll(".alert-row__title")].map((t) => t.textContent);
    expect(titles).toEqual([
      "Meghan Suchomski picked up 1 gallon of raw milk",
      "Meghan Suchomski reserved 2 gallon of raw milk",
    ]);
    expect(within(seenGroup()).getByText("This week of a weekly pickup · seen 3 min ago")).toBeTruthy();
    expect(within(seenGroup()).getByText("Waiting to be picked up · seen 30 min ago")).toBeTruthy();
    expect(within(seenGroup()).getAllByRole("button", { name: /^Mark unseen: / })).toHaveLength(2);
  });

  it("puts one back on the list when it's made unseen", async () => {
    await mountAlerts();
    const alertsLink = await screen.findByRole("link", { name: /^Alerts/ });
    await waitFor(() => expect(within(alertsLink).getByLabelText("1 new from the farm store")).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: "Show seen" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Mark unseen: Meghan Suchomski reserved/ }));
    // Back among the new ones, with a "Seen" button again...
    expect(await screen.findByRole("button", { name: /^Mark seen: Meghan Suchomski reserved/ })).toBeTruthy();
    // ...gone from the seen ones, and counted in the menu.
    await waitFor(() => expect(within(seenGroup()).queryByText(/reserved 2 gallon/)).toBeNull());
    await waitFor(() => expect(within(alertsLink).getByLabelText("2 new from the farm store")).toBeTruthy());
    expect(rpcCalls).toEqual([{ fn: "mark_store_event_unseen", args: { p_event_id: 11 } }]);
  });

  it("moves one marked seen into the seen list while it's open", async () => {
    await mountAlerts();
    fireEvent.click(await screen.findByRole("button", { name: "Show seen" }));
    await within(await screen.findByRole("group", { name: "Seen" })).findByText(/reserved 2 gallon/);
    fireEvent.click(screen.getByRole("button", { name: /^Mark seen: tom@example.com/ }));
    await within(seenGroup()).findByText(/started a weekly pickup/);
    expect(screen.getByText("Nothing new since you last looked.")).toBeTruthy();
  });

  it("says so when nothing has been seen yet", async () => {
    db.store_event_marks = [];
    await mountAlerts();
    fireEvent.click(await screen.findByRole("button", { name: "Show seen" }));
    expect(await within(await screen.findByRole("group", { name: "Seen" })).findByText("Nothing marked seen yet.")).toBeTruthy();
  });

  it("folds away again", async () => {
    await mountAlerts();
    fireEvent.click(await screen.findByRole("button", { name: "Show seen" }));
    await screen.findByRole("group", { name: "Seen" });
    fireEvent.click(screen.getByRole("button", { name: "Hide seen" }));
    expect(screen.queryByRole("group", { name: "Seen" })).toBeNull();
  });
});

describe("Today · from the farm store", () => {
  const mountToday = async () => {
    const { default: Today } = await import("./Today");
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );
  };

  it("sums it up in one line that goes to Alerts", async () => {
    await mountToday();
    const title = await screen.findByText("3 new from the farm store");
    expect(screen.getByText("1 reservation · 1 new weekly pickup · 1 pickup")).toBeTruthy();
    expect(title.closest("a")!.getAttribute("href")).toBe("/alerts");
  });

  it("says nothing once it's been seen", async () => {
    seenUpTo(minsAgo(0));
    await mountToday();
    await screen.findByText("Needs you");
    await waitFor(() => expect(screen.queryByText(/new from the farm store/)).toBeNull());
  });

  it("says nothing to a helper", async () => {
    role = "member";
    await mountToday();
    await screen.findByText("Needs you");
    expect(screen.queryByText(/new from the farm store/)).toBeNull();
  });
});
