import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * What customers did in the farm store since the farmer last looked.
 *
 * Different in kind from the herd's alerts in lib/alerts.ts. Those are
 * conditions — a cow is overdue until she isn't — worked out fresh from the
 * record each time. These are events: a reservation happened, and having
 * happened it stays happened. So they are kept, by the database, as they
 * occur (migration 075), and they go away when the farmer says they've seen
 * them rather than when anything changes.
 *
 * Only the customer's own actions are recorded. An order the farmer reserved
 * on someone's behalf, or ticked off as collected on the Orders page, is not
 * news to the farmer.
 */

export type StoreEventKind = "reserved" | "scheduled" | "picked_up";

export interface StoreEvent {
  id: number;
  kind: StoreEventKind;
  customerId: string | null;
  productId: number | null;
  orderId: number | null;
  scheduleId: number | null;
  quantity: number | null;
  /** The weekday of a weekly pickup. */
  weekday: string | null;
  at: string;
  /** Filled in from profiles and products; null where neither could be read. */
  customerName: string | null;
  productName: string | null;
  unit: string | null;
}

export interface StoreActivity {
  /** Unseen, newest first. */
  events: StoreEvent[];
}

/** How many to show. A farm store does not have a hundred customers acting in
 *  a day, and if it does the list is not the right tool any more. */
const LIMIT = 50;

/** When the farmer last cleared these, for this farm. Null when never. */
async function seenThrough(businessId: number): Promise<string | null> {
  const { data, error } = await supabase
    .from("store_event_reads")
    .select("seen_through")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(`store_event_reads: ${error.message}`);
  return (data as { seen_through: string } | null)?.seen_through ?? null;
}

export async function fetchStoreActivity(businessId: number): Promise<StoreActivity> {
  const since = await seenThrough(businessId);
  let q = supabase
    .from("store_events")
    .select("id, kind, customer_id, product_id, order_id, schedule_id, quantity, weekday, at")
    .eq("business_id", businessId)
    .order("at", { ascending: false })
    .limit(LIMIT);
  if (since) q = q.gt("at", since);
  const { data, error } = await q;
  if (error) throw new Error(`store_events: ${error.message}`);
  const rows = (data ?? []) as {
    id: number;
    kind: StoreEventKind;
    customer_id: string | null;
    product_id: number | null;
    order_id: number | null;
    schedule_id: number | null;
    quantity: number | string | null;
    weekday: string | null;
    at: string;
  }[];
  if (rows.length === 0) return { events: [] };

  // Names in two reads rather than a join: profiles and products have their
  // own policies, and an event whose customer can't be read should still show.
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((id): id is string => id !== null))];
  const productIds = [...new Set(rows.map((r) => r.product_id).filter((id): id is number => id !== null))];
  const [people, products] = await Promise.all([
    customerIds.length
      ? supabase.from("profiles").select("id, first_name, last_name, email").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase.from("products").select("id, name, unit").in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const personName = new Map(
    ((people.data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map(
      (p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || null],
    ),
  );
  const product = new Map(
    ((products.data ?? []) as { id: number; name: string; unit: string }[]).map((p) => [p.id, p]),
  );

  return {
    events: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      customerId: r.customer_id,
      productId: r.product_id,
      orderId: r.order_id,
      scheduleId: r.schedule_id,
      quantity: r.quantity === null ? null : Number(r.quantity),
      weekday: r.weekday,
      at: r.at,
      customerName: r.customer_id ? (personName.get(r.customer_id) ?? null) : null,
      productName: r.product_id ? (product.get(r.product_id)?.name ?? null) : null,
      unit: r.product_id ? (product.get(r.product_id)?.unit ?? null) : null,
    })),
  };
}

/**
 * Clear them, up to and including the newest one on screen — not up to "now".
 * A reservation that lands while the page is open would otherwise be marked
 * seen by a click on a list it was never in.
 */
export async function markStoreActivitySeen(businessId: number, through: string): Promise<void> {
  const { error } = await supabase.rpc("mark_store_events_seen", { p_business_id: businessId, p_through: through });
  if (error) throw new Error(error.message);
  notifyChanged();
}

/** How many are waiting, for the count beside Alerts in the menu. */
export async function countUnseenStoreEvents(businessId: number): Promise<number> {
  const since = await seenThrough(businessId);
  let q = supabase.from("store_events").select("id", { count: "exact", head: true }).eq("business_id", businessId);
  if (since) q = q.gt("at", since);
  const { count, error } = await q;
  if (error) throw new Error(`store_events: ${error.message}`);
  return count ?? 0;
}

// The menu's count and the Alerts page are separate components; clearing on
// one has to reach the other without a reload.
const CHANGED = "grazerbook:store-alerts-changed";
const notifyChanged = () => window.dispatchEvent(new Event(CHANGED));

/** The waiting count for a farm, kept current. Null when it doesn't apply —
 *  not the owner, or no store — so the menu shows nothing rather than a zero. */
export function useStoreAlertCount(businessId: number | null, applies: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!applies || businessId === null) {
      setCount(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      countUnseenStoreEvents(businessId)
        .then((n) => !cancelled && setCount(n))
        // A count that can't be read is not worth an error in the menu.
        .catch(() => !cancelled && setCount(null));
    void load();
    window.addEventListener(CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, load);
    };
  }, [businessId, applies]);
  return count;
}

const amount = (e: Pick<StoreEvent, "quantity" | "unit" | "productName">): string => {
  const what = e.productName ?? "something";
  if (e.quantity === null) return what;
  const q = Number.isInteger(e.quantity) ? String(e.quantity) : String(Math.round(e.quantity * 1000) / 1000);
  return `${q} ${e.unit ?? ""} of ${what.toLowerCase()}`.replace(/\s+/g, " ");
};

/** The sentence a row says, and where clicking it goes. */
export function describeStoreEvent(e: StoreEvent): { title: string; detail: string; href: string } {
  const who = e.customerName ?? "A customer";
  const customerPage = e.customerId ? `/store/customers/${e.customerId}` : "/store/customers";
  switch (e.kind) {
    case "reserved":
      return { title: `${who} reserved ${amount(e)}`, detail: "Waiting to be picked up", href: "/store/orders" };
    case "scheduled":
      return {
        title: `${who} started a weekly pickup`,
        detail: `${amount(e)}${e.weekday ? `, every ${e.weekday}` : ""}`.replace(/^./, (c) => c.toUpperCase()),
        href: "/store/schedules",
      };
    case "picked_up":
      return {
        title: `${who} picked up ${amount(e)}`,
        detail: e.scheduleId ? "This week of a weekly pickup" : "A reserved order",
        href: customerPage,
      };
  }
}

export const STORE_KIND_LABEL: Record<StoreEventKind, string> = {
  reserved: "Reserved",
  scheduled: "Weekly pickup",
  picked_up: "Picked up",
};

/** "just now", "12 min ago", "3 h ago", "yesterday", or the date. */
export function agoInWords(at: string, now: Date = new Date()): string {
  const then = new Date(at);
  const mins = Math.round((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) return `${hours} h ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return "yesterday";
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "2 reservations · 1 pickup" — what is waiting, for a one-line summary. */
export function summarize(events: Pick<StoreEvent, "kind">[]): string {
  const n = (k: StoreEventKind) => events.filter((e) => e.kind === k).length;
  const parts: string[] = [];
  const r = n("reserved"), s = n("scheduled"), p = n("picked_up");
  if (r) parts.push(`${r} reservation${r === 1 ? "" : "s"}`);
  if (s) parts.push(`${s} new weekly pickup${s === 1 ? "" : "s"}`);
  if (p) parts.push(`${p} pickup${p === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
