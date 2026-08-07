import { supabase } from "./supabase";

/**
 * The storefront side. A customer is a real Supabase account with a
 * public.profiles row of role 'customer' — not a farm_members row, so none
 * of the herd/business membership applies to them.
 */

export interface CustomerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: string;
}

export interface ShopProduct {
  id: number;
  name: string;
  unit: string;
  price: number | null;
  /** Which store this belongs to. Needed when a customer starts a weekly
   * pickup: schedules are business-scoped since migration 019, the same way
   * orders have been since 010. */
  business_id: number;
  /** Batch quantity minus what's already reserved. */
  available: number;
}

export interface CustomerOrder {
  id: number;
  product_id: number;
  quantity: number;
  status: string;
  reserved_date: string | null;
  picked_up_date: string | null;
  cancelled_date: string | null;
  unit_price: number | null;
  total_cost: number | null;
  /** What was actually handed over, and how. Both null on an order the
   * farmer completed without recording a payment — five of the nine orders
   * on file predate pricing entirely. */
  amount_paid: number | null;
  payment_method: string | null;
}

/**
 * The day a past order finished — collected, or failing that cancelled.
 *
 * Local, not UTC. `picked_up_date` is a timestamptz, and slicing the ISO
 * string would put a 7pm Wisconsin pickup on the following day, which is
 * neither what happened nor what the row next to it renders.
 */
export function historyDate(order: Pick<CustomerOrder, "picked_up_date" | "cancelled_date">): string | null {
  const iso = order.picked_up_date ?? order.cancelled_date;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface HistoryDay {
  /** Local yyyy-mm-dd, which is what the heading renders and what the
   * ordering sorts on. */
  date: string;
  orders: CustomerOrder[];
  /**
   * What the collected orders that day came to, or null when none of them
   * carried a price. Zero and null are different answers: zero would say
   * the day was free.
   */
  total: number | null;
}

/**
 * Past orders as days, newest first.
 *
 * Sorted on the day the order finished rather than the day it was reserved,
 * which is the order they arrive in — a reservation made in May and
 * collected in July belongs under July.
 */
export function groupByDate(orders: CustomerOrder[]): HistoryDay[] {
  const days = new Map<string, CustomerOrder[]>();
  for (const o of orders) {
    const date = historyDate(o);
    if (!date) continue;
    const bucket = days.get(date);
    if (bucket) bucket.push(o);
    else days.set(date, [o]);
  }

  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, dayOrders]) => {
      const priced = dayOrders.filter((o) => o.picked_up_date && o.total_cost !== null);
      return {
        date,
        orders: dayOrders,
        total: priced.length === 0 ? null : Math.round(priced.reduce((s, o) => s + Number(o.total_cost), 0) * 100) / 100,
      };
    });
}

/**
 * The gap between what a collected order cost and what was paid for it, or
 * null when there's nothing to compare.
 *
 * Deliberately mirrors `owed` in totalsOf: an unpriced order contributes
 * nothing rather than reading as a debt, and a sub-cent difference is a
 * rounding sliver rather than money. Negative means overpaid, which is worth
 * showing rather than clamping — a customer who handed over $20 for a $15
 * pickup should see that on their own history.
 */
export function outstanding(
  order: Pick<CustomerOrder, "total_cost" | "amount_paid" | "picked_up_date">,
): number | null {
  if (!order.picked_up_date) return null;
  if (order.total_cost === null || order.amount_paid === null) return null;
  const gap = Number(order.total_cost) - Number(order.amount_paid);
  return Math.abs(gap) <= 0.005 ? 0 : Math.round(gap * 100) / 100;
}

export async function fetchProfile(userId: string): Promise<CustomerProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, phone, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  return data as CustomerProfile | null;
}

export async function fetchShop(): Promise<ShopProduct[]> {
  const [productsRes, batchesRes] = await Promise.all([
    supabase.from("products").select("id, name, unit, price, business_id").order("name"),
    supabase.from("inventory_batches").select("product_id, quantity, reserved"),
  ]);
  if (productsRes.error) throw new Error(`products: ${productsRes.error.message}`);
  if (batchesRes.error) throw new Error(`inventory_batches: ${batchesRes.error.message}`);

  const batches = (batchesRes.data ?? []) as { product_id: number; quantity: number; reserved: number }[];

  return ((productsRes.data ?? []) as Omit<ShopProduct, "available">[]).map((p) => {
    const mine = batches.filter((b) => b.product_id === p.id);
    const available = mine.reduce((s, b) => s + (Number(b.quantity) - Number(b.reserved)), 0);
    return { ...p, available: Math.round(available * 1000) / 1000 };
  });
}

export async function fetchMyOrders(userId: string): Promise<CustomerOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, product_id, quantity, status, reserved_date, picked_up_date, cancelled_date, unit_price, total_cost, amount_paid, payment_method",
    )
    .eq("customer_id", userId)
    .order("reserved_date", { ascending: false });
  if (error) throw new Error(`orders: ${error.message}`);
  return (data ?? []) as CustomerOrder[];
}

/**
 * Reserving goes through the database, not an insert: availability check,
 * order creation and holding the stock have to be one operation, or two
 * people reserving the last gallon both succeed.
 *
 * reserve_product(product, quantity, customer) predates this app and does
 * more than an insert would — it won't sell stock already promised to an
 * upcoming weekly schedule, and it lets a farmer reserve on someone else's
 * behalf. All three arguments are passed explicitly: the third is what
 * distinguishes it from the duplicate 011 mistakenly added, and passing it
 * keeps the call unambiguous even if another overload appears.
 */
export async function reserve(input: {
  productId: number;
  quantity: number;
  /** A farmer reserving for a customer. Null means "for me". */
  forCustomerId?: string | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc("reserve_product", {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_customer: input.forCustomerId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

/**
 * Cancelling goes through a function rather than an update, because RLS
 * gates rows and not columns: a policy letting customers update their own
 * orders would also let them rewrite unit_price or mark themselves as having
 * collected. See migration 009.
 */
export async function cancelOrder(orderId: number): Promise<void> {
  const { error } = await supabase.rpc("cancel_my_order", { order_id: orderId });
  if (error) throw new Error(error.message);
}

/** The role this database gives a shop customer. Not "customer" — the live
 * rows use 'buyer', and is_farmer() keys off 'farmer'. */
export const BUYER_ROLE = "buyer";

export async function signUpCustomer(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}) {
  const { data, error } = await supabase.auth.signUp({ email: input.email, password: input.password });
  if (error) throw new Error(error.message);

  // No session when email confirmation is on, so nothing can be written as
  // this user yet. Whatever creates profiles server-side will have done so.
  if (!data.session || !data.user) return { needsConfirmation: true };

  // A trigger on auth.users appears to create the profile already — the row
  // for an account signed up through this form came back with role 'buyer',
  // which this code never sends. So fill in the name and phone the form
  // collected rather than inserting a duplicate, and treat a missing row as
  // the case to insert.
  const { data: existing } = await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();

  const fields = {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone || null,
  };

  const { error: profileError } = existing
    ? await supabase.from("profiles").update(fields).eq("id", data.user.id)
    : await supabase.from("profiles").insert({ id: data.user.id, ...fields, role: BUYER_ROLE });

  // Don't fail the signup over this — the account exists and works; the
  // name is cosmetic and can be fixed later.
  if (profileError) return { needsConfirmation: false, profileWarning: profileError.message };
  return { needsConfirmation: false };
}
