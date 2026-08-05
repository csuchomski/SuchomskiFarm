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
    supabase.from("products").select("id, name, unit, price").order("name"),
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
    .select("id, product_id, quantity, status, reserved_date, picked_up_date, cancelled_date, unit_price, total_cost")
    .eq("customer_id", userId)
    .order("reserved_date", { ascending: false });
  if (error) throw new Error(`orders: ${error.message}`);
  return (data ?? []) as CustomerOrder[];
}

export async function reserve(input: {
  userId: string;
  productId: number;
  quantity: number;
  unitPrice: number | null;
}): Promise<CustomerOrder> {
  const { data, error } = await supabase
    .from("orders")
    .insert({
      customer_id: input.userId,
      product_id: input.productId,
      quantity: input.quantity,
      status: "reserved",
      reserved_date: new Date().toISOString(),
      unit_price: input.unitPrice,
      total_cost: input.unitPrice === null ? null : Math.round(input.unitPrice * input.quantity * 100) / 100,
    })
    .select("id, product_id, quantity, status, reserved_date, picked_up_date, cancelled_date, unit_price, total_cost")
    .single();

  if (error) throw new Error(error.message);
  return data as CustomerOrder;
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

export async function signUpCustomer(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}) {
  const { data, error } = await supabase.auth.signUp({ email: input.email, password: input.password });
  if (error) throw new Error(error.message);

  // No session when email confirmation is on — the profile row has to wait
  // until they confirm and sign in, or the insert fails RLS.
  if (!data.session || !data.user) return { needsConfirmation: true };

  const { error: profileError } = await supabase.from("profiles").insert({
    id: data.user.id,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone || null,
    role: "customer",
  });
  if (profileError) throw new Error(`profiles: ${profileError.message}`);
  return { needsConfirmation: false };
}
