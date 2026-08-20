import { supabase } from "./supabase";

/**
 * How a pickup was paid for, on one farm.
 *
 * This is a lookup table rather than a constant because the database is the
 * one enforcing it: complete_pickup and complete_scheduled_pickup both refuse
 * a method they don't recognise. Keeping a hard-coded list in the app that
 * drifted from the table would mean a dropdown offering something the server
 * then rejects — which is exactly what happened with "Check" before migration
 * 022, only in the other direction.
 *
 * **The list belongs to a business** (migration 057). It was one global three
 * — Cash, Venmo, Check — which is fine while there is one farm and wrong the
 * moment there are two: a farm that takes Zelle and a farm that takes nothing
 * but cash at the gate are both making a decision about their own business,
 * and one shared row cannot hold two answers. Every read here is scoped, and
 * `orders.payment_method` now carries a composite foreign key, so an order
 * cannot even record a method its own business does not offer.
 */

export interface PaymentMethodOption {
  code: string;
  label: string;
  active: boolean;
  sort_order: number;
  business_id: number;
}

/**
 * What the two database functions accepted before 022. Used only when
 * public.payment_methods isn't there — offering Check against the old
 * hard-coded check would produce 'Invalid payment method' at the moment of
 * collection, with the customer standing in the yard.
 */
export const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { code: "Cash", label: "Cash", active: true, sort_order: 10, business_id: 0 },
  { code: "Venmo", label: "Venmo", active: true, sort_order: 20, business_id: 0 },
];

const missingTable = (message: string) => /does not exist|schema cache|not find the table/i.test(message);

const COLUMNS = "code, label, active, sort_order, business_id";

/**
 * What one business takes.
 *
 * An empty result is now a real answer — a farm that has switched every
 * method off takes none, and the pickup form should offer none rather than
 * falling back to Cash and Venmo. That fallback is only for a database with
 * no `payment_methods` table at all, where the two functions still carry the
 * pre-022 pair as a literal. Offering a method the server will reject is the
 * failure this whole table exists to prevent.
 */
export async function fetchPaymentMethods(businessId: number): Promise<PaymentMethodOption[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("sort_order");

  if (error) {
    if (missingTable(error.message)) return FALLBACK_PAYMENT_METHODS;
    throw new Error(`payment_methods: ${error.message}`);
  }

  // Retired methods stay in the table so old orders keep their label, but
  // they aren't on offer for a new pickup — same rule the functions apply.
  return ((data ?? []) as PaymentMethodOption[]).filter((m) => m.active);
}

/**
 * Every method every shop takes, for the storefront.
 *
 * The shop spans businesses — one customer's basket can hold two farms' milk
 * — so which methods to offer depends on whose product is being collected,
 * and that isn't known until they press collect. Reading is open by policy
 * for exactly this: what a farm accepts is the sign on its own gate.
 */
export async function fetchShopPaymentMethods(): Promise<PaymentMethodOption[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select(COLUMNS)
    .order("sort_order");

  if (error) {
    if (missingTable(error.message)) return FALLBACK_PAYMENT_METHODS;
    throw new Error(`payment_methods: ${error.message}`);
  }
  return ((data ?? []) as PaymentMethodOption[]).filter((m) => m.active);
}

/** The ones a given shop takes. `business_id` 0 is the fallback list, which
 *  belongs to no business and has to answer for all of them. */
export const methodsFor = (methods: PaymentMethodOption[], businessId: number | null) =>
  methods.filter((m) => m.business_id === 0 || m.business_id === businessId);

export const methodCodes = (methods: PaymentMethodOption[]): string[] => methods.map((m) => m.code);

// ─── editing them ──────────────────────────────────────────────────────

/** Retired ones included — this is the page that retires them. */
export async function fetchAllPaymentMethods(businessId: number): Promise<PaymentMethodOption[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("sort_order");
  if (error) throw new Error(`payment_methods: ${error.message}`);
  return (data ?? []) as PaymentMethodOption[];
}

/**
 * The code is the label, tidied.
 *
 * `code` is what lands in `orders.payment_method` and what the two pickup
 * functions compare against; `label` is what a customer reads. Asking a
 * farmer for both would be asking them to care about the difference. So the
 * label is typed and the code is derived once, at creation, and never
 * changes afterwards — renaming "Venmo" to "Venmo (Meghan)" must not orphan
 * the orders that already say Venmo.
 */
export const codeFor = (label: string): string =>
  label.trim().replace(/\s+/g, " ").replace(/[^A-Za-z0-9 ]/g, "").trim().replace(/ /g, "-");

export function validateMethod(label: string, existing: PaymentMethodOption[]): string | null {
  const clean = label.trim();
  if (clean === "") return "Give the method a name.";
  if (clean.length > 40) return "That name is too long for a dropdown.";
  const code = codeFor(clean);
  if (code === "") return "Give the method a name with a letter or a number in it.";
  if (existing.some((m) => m.code.toLowerCase() === code.toLowerCase())) {
    return `${clean} is already on the list.`;
  }
  return null;
}

/** Add one to the end of this business's list. */
export async function addPaymentMethod(businessId: number, label: string): Promise<void> {
  const clean = label.trim();
  const existing = await fetchAllPaymentMethods(businessId);
  const problem = validateMethod(clean, existing);
  if (problem) throw new Error(problem);

  const last = existing.reduce((n, m) => Math.max(n, m.sort_order), 0);
  const { error } = await supabase.from("payment_methods").insert({
    business_id: businessId,
    code: codeFor(clean),
    label: clean,
    active: true,
    sort_order: last + 10,
  });
  if (error) throw new Error(`payment_methods: ${error.message}`);
}

export async function renamePaymentMethod(
  businessId: number,
  code: string,
  label: string,
): Promise<void> {
  const clean = label.trim();
  if (clean === "") throw new Error("Give the method a name.");
  const { error } = await supabase
    .from("payment_methods")
    .update({ label: clean })
    .eq("business_id", businessId)
    .eq("code", code);
  if (error) throw new Error(`payment_methods: ${error.message}`);
}

/**
 * Retire a method, or put it back.
 *
 * Never a delete. Every order that was paid this way still points at the row
 * — the foreign key would refuse anyway — and "how was this paid" has to keep
 * answering for the books long after the farm stops taking it.
 */
export async function setMethodActive(
  businessId: number,
  code: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("payment_methods")
    .update({ active })
    .eq("business_id", businessId)
    .eq("code", code);
  if (error) throw new Error(`payment_methods: ${error.message}`);
}
