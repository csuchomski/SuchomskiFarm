import { supabase } from "./supabase";

/**
 * Orders: reserving stock, handing it over, and taking the money.
 *
 * Almost nothing here writes to `orders` directly. The database already has
 * the whole workflow as security-definer functions — reserve_product,
 * complete_pickup, cancel_order — and each does several things atomically
 * that an update can't: reserve_product won't sell stock already promised to
 * a weekly schedule, and complete_pickup releases the unpicked remainder,
 * consumes batches oldest-first, prices the order, and splits the proceeds
 * across the animals that supplied it. Reimplementing any of that in the
 * client would drift from the function the customer store already calls.
 *
 * What this file owns is the reading, and the checks worth making before a
 * call that would otherwise fail deep inside plpgsql with a message written
 * for a developer.
 */

/** The only two the database accepts — complete_pickup raises on anything
 * else. Kept in lockstep with that check deliberately. */
export const PAYMENT_METHODS = ["Cash", "Venmo"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type OrderStatus = "reserved" | "completed" | "cancelled";

export interface RealOrder {
  id: number;
  customer_id: string;
  product_id: number;
  quantity: number;
  status: string;
  reserved_date: string | null;
  picked_up_date: string | null;
  cancelled_date: string | null;
  unit_price: number | null;
  total_cost: number | null;
  amount_paid: number | null;
  payment_method: string | null;
  business_id: number | null;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  role: string;
}

const ORDER_COLUMNS =
  "id, customer_id, product_id, quantity, status, reserved_date, picked_up_date, cancelled_date, unit_price, total_cost, amount_paid, payment_method, business_id";

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchOrders(businessId: number): Promise<RealOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("business_id", businessId)
    .order("id", { ascending: false });
  if (error) throw new Error(`orders: ${error.message}`);
  return (data ?? []) as RealOrder[];
}

/**
 * Everyone with a profile, not only buyers.
 *
 * The farmer places orders for themselves — four of the nine on file are
 * their own — so filtering to role 'buyer' would hide the customer you
 * reserve for most often.
 */
export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email, phone, role")
    .order("first_name");
  if (error) throw new Error(`profiles: ${error.message}`);
  return (data ?? []) as Customer[];
}

// ─── naming ────────────────────────────────────────────────────────────

/**
 * Every profile on this farm has a name or an email; several have a blank
 * first_name, so the email is the fallback that actually identifies someone
 * rather than "Customer 3f7f42e9".
 */
export function customerName(c: Customer | undefined): string {
  if (!c) return "Unknown customer";
  const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  if (full) return full;
  return c.email || "Unnamed customer";
}

/** Short label for a dense row: a first name where there is one. */
export function customerShort(c: Customer | undefined): string {
  if (!c) return "Unknown";
  if (c.first_name?.trim()) return c.first_name.trim();
  return c.email ? c.email.split("@")[0] : "Unnamed";
}

// ─── derived ───────────────────────────────────────────────────────────

export const isOpen = (o: RealOrder): boolean => o.status === "reserved";

/** How long an order has been waiting to be collected. Null when it isn't
 * open, or has no reserved date to count from. */
export function daysWaiting(o: RealOrder, todayIso: string): number | null {
  if (!isOpen(o) || !o.reserved_date) return null;
  const reserved = o.reserved_date.slice(0, 10);
  const days = Math.floor((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${reserved}T00:00:00Z`)) / 86_400_000);
  return days >= 0 ? days : 0;
}

/**
 * What an open order is worth, from the product's current price — an open
 * order has no total_cost yet, because complete_pickup is what prices it.
 * Null when the product has no price, rather than counting it as zero.
 */
export function expectedValue(o: RealOrder, price: number | null | undefined): number | null {
  if (price === null || price === undefined) return null;
  return Math.round(Number(price) * Number(o.quantity) * 100) / 100;
}

export interface OrderTotals {
  open: number;
  openQuantity: number;
  collected: number;
  takings: number;
  /** Collected orders where amount_paid is short of total_cost. */
  owed: number;
}

/**
 * Money is counted from `amount_paid`, not `total_cost`. Five of the nine
 * orders on file have neither — they predate pricing — and treating a null
 * as zero is right for takings but would be wrong for "owed", so the two
 * are counted separately and an unpriced order contributes to neither.
 */
export function totalsOf(orders: RealOrder[]): OrderTotals {
  let open = 0;
  let openQuantity = 0;
  let collected = 0;
  let takings = 0;
  let owed = 0;

  for (const o of orders) {
    if (isOpen(o)) {
      open += 1;
      openQuantity += Number(o.quantity);
      continue;
    }
    if (o.status !== "completed") continue;
    collected += 1;
    takings += Number(o.amount_paid ?? 0);
    if (o.total_cost !== null && o.amount_paid !== null) {
      const short = Number(o.total_cost) - Number(o.amount_paid);
      if (short > 0.005) owed += short;
    }
  }

  return {
    open,
    openQuantity: Math.round(openQuantity * 1000) / 1000,
    collected,
    takings: Math.round(takings * 100) / 100,
    owed: Math.round(owed * 100) / 100,
  };
}

export interface CustomerSummary {
  customerId: string;
  orders: number;
  openOrders: number;
  spent: number;
  lastOrder: string | null;
}

/** One row per customer who has ever ordered, biggest spender first. */
export function byCustomer(orders: RealOrder[]): CustomerSummary[] {
  const by = new Map<string, CustomerSummary>();

  for (const o of orders) {
    const row = by.get(o.customer_id) ?? {
      customerId: o.customer_id,
      orders: 0,
      openOrders: 0,
      spent: 0,
      lastOrder: null,
    };
    row.orders += 1;
    if (isOpen(o)) row.openOrders += 1;
    if (o.status === "completed") row.spent += Number(o.amount_paid ?? 0);

    const date = (o.picked_up_date ?? o.reserved_date)?.slice(0, 10) ?? null;
    if (date && (row.lastOrder === null || date > row.lastOrder)) row.lastOrder = date;

    by.set(o.customer_id, row);
  }

  return [...by.values()]
    .map((r) => ({ ...r, spent: Math.round(r.spent * 100) / 100 }))
    .sort((a, b) => b.spent - a.spent || b.orders - a.orders || a.customerId.localeCompare(b.customerId));
}

// ─── validation ────────────────────────────────────────────────────────

/**
 * Checked here so a mistake is a sentence rather than a plpgsql exception.
 * These mirror complete_pickup's own guards: it rounds the final quantity to
 * three places and raises 'Invalid final quantity' outside 0..ordered, and
 * 'Invalid payment method' on anything but Cash or Venmo.
 */
export function validatePickup(input: {
  order: Pick<RealOrder, "quantity" | "status">;
  finalQuantity: string;
  paymentMethod: string;
  amountPaid: string;
}): string | null {
  if (input.order.status !== "reserved") return "That order isn't open any more.";

  const ordered = Number(input.order.quantity);
  const raw = input.finalQuantity.trim();
  if (raw === "") return "How much did they actually take?";
  const final = Number(raw);
  if (!Number.isFinite(final)) return "The quantity collected has to be a number.";
  if (final < 0) return "The quantity collected can't be negative.";
  if (final > ordered) {
    // The function raises here rather than reserving more stock, so catch it
    // with the number in it.
    return `They reserved ${ordered} — collecting more than that needs a new order.`;
  }

  if (input.paymentMethod !== "" && !PAYMENT_METHODS.includes(input.paymentMethod as PaymentMethod)) {
    return `Payment has to be ${PAYMENT_METHODS.join(" or ")}.`;
  }

  const paidRaw = input.amountPaid.trim();
  if (paidRaw !== "") {
    const paid = Number(paidRaw);
    if (!Number.isFinite(paid)) return "The amount paid has to be a number.";
    if (paid < 0) return "The amount paid can't be negative.";
  }

  return null;
}

export function validateReserve(input: { productId: string; quantity: string; customerId: string; available: number }): string | null {
  if (!input.customerId) return "Who is this order for?";
  if (!input.productId) return "Pick a product.";

  const raw = input.quantity.trim();
  if (raw === "") return "How much are they reserving?";
  const qty = Number(raw);
  if (!Number.isFinite(qty)) return "The quantity has to be a number.";
  if (qty <= 0) return "Reserve at least some of it.";
  if (qty > input.available) {
    return `Only ${input.available} available — reserving more would oversell it.`;
  }
  return null;
}

// ─── writes ────────────────────────────────────────────────────────────

/**
 * Hands the order over. A short pickup is normal and supported: pass the
 * quantity actually collected and the function releases the difference back
 * to stock rather than consuming it.
 *
 * Passing null for the payment fields records a collection with no payment,
 * which is a real case here — four of the completed orders on file were
 * collected by the farmer and never priced.
 */
export async function completePickup(input: {
  orderId: number;
  finalQuantity: number;
  paymentMethod: PaymentMethod | null;
  amountPaid: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc("complete_pickup", {
    p_order_id: input.orderId,
    p_final_quantity: input.finalQuantity,
    p_payment_method: input.paymentMethod,
    p_amount_paid: input.amountPaid,
  });
  if (error) throw new Error(error.message);
}

/**
 * The farmer's cancel, not the customer's. cancel_my_order is the one the
 * shop calls; this one also accepts a farmer cancelling somebody else's
 * order, which is the whole reason it exists separately.
 */
export async function cancelOrder(orderId: number): Promise<void> {
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) throw new Error(error.message);
}

/** Reserve on a customer's behalf. Returns the new order's id. */
export async function reserveFor(input: {
  productId: number;
  quantity: number;
  customerId: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc("reserve_product", {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_customer: input.customerId,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
