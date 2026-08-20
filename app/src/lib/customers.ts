import { supabase } from "./supabase";
import type { Customer } from "./orders";

/**
 * Editing and removing a customer, from the farm side.
 *
 * Reading them lives in orders.ts alongside the orders they belong to; this
 * is the writing, which is where the constraints are.
 *
 * Two of those constraints are set by the schema and not by preference:
 *
 * - `role` is not editable. `authenticated` holds column-level UPDATE on
 *   exactly email, first_name, last_name, phone and archived_at — role is
 *   withheld deliberately, because it's the column is_farmer() reads. See
 *   docs/migrations/024-customer-admin.sql.
 * - a customer with orders can't be deleted. orders.customer_id references
 *   profiles with no ON DELETE, so the row is load-bearing for the books.
 *   delete_customer() refuses before the FK has to.
 */

export interface CustomerPatch {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

/** The columns a farmer may actually write. Listed rather than spread, so a
 * field added to the form can't quietly become an update the grant refuses. */
const EDITABLE = ["first_name", "last_name", "email", "phone"] as const;

/**
 * A name *or* an email, not both and not the email specifically.
 *
 * Someone who buys eggs at the gate may have neither an account nor an
 * address to give you, and profiles.email is NOT NULL so it takes '' rather
 * than null. What can't happen is having neither, because then nothing on a
 * pickup list identifies them — the same rule add_customer() enforces, so
 * the form and the database agree.
 */
export function validateCustomer(patch: CustomerPatch): string | null {
  const email = patch.email.trim();
  const named = patch.first_name.trim() !== "" || patch.last_name.trim() !== "";
  if (!named && email === "") return "Give them a name or an email.";

  // Deliberately loose, and only applied when there is something to check.
  // The address here is for contact; it isn't what they sign in with, so it
  // has no login to match.
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "That doesn't look like an email address.";
  }
  return null;
}

export async function updateCustomer(id: string, patch: CustomerPatch): Promise<Customer> {
  const row: Record<string, string | null> = {
    first_name: patch.first_name.trim(),
    last_name: patch.last_name.trim(),
    email: patch.email.trim(),
    // The column is nullable and a blank string would render as an empty
    // contact line rather than as "no phone number".
    phone: patch.phone.trim() === "" ? null : patch.phone.trim(),
  };
  for (const key of Object.keys(row)) {
    if (!(EDITABLE as readonly string[]).includes(key)) delete row[key];
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(row)
    .eq("id", id)
    .select("id, first_name, last_name, email, phone, role, archived_at, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data as Customer;
}

/** Archive or restore. Keeps every order and standing order — it's the
 * operation that actually applies to a customer who has bought anything. */
export async function setArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Delete the profile outright. Only possible for someone who has never
 * ordered; the function refuses otherwise and says to archive instead.
 *
 * Their login survives this — profiles.id references auth.users, not the
 * other way round, and removing an account needs the service_role key.
 */
export async function deleteCustomer(id: string, businessId: number): Promise<void> {
  const { error } = await supabase.rpc("delete_customer", { p_id: id, p_business_id: businessId });
  if (error) throw new Error(error.message);
}

/**
 * `Boolean(...)`, not `!== null`.
 *
 * A row that arrives without the column at all — PostgREST against a schema
 * cache from before migration 024 — has `archived_at` undefined, and
 * `undefined !== null` is true. That would mark every customer archived and
 * empty the list, with no error anywhere. This treats missing as active,
 * which is the safe direction: showing someone who should be hidden is a
 * nuisance, hiding everyone is a broken page.
 */
export const isArchived = (c: Customer): boolean => Boolean(c.archived_at);

/**
 * `!== false`, so a row that predates migration 026 — or arrives from a
 * schema cache that does — reads as having a login, which is what every
 * customer was before walk-ins existed. The opposite default would label the
 * whole list "added at the farm".
 */
export const hasLogin = (c: Customer): boolean => c.has_login !== false;

/**
 * Create a customer with no login: someone who buys at the gate.
 *
 * There is no way to create the auth.users row an ordinary signup gets —
 * auth.signUp would replace the farmer's own session, and the admin API needs
 * the service_role key, which must never be in the frontend. Migration 026
 * dropped the foreign key that required one, and this function is the only
 * thing that writes has_login false.
 */
export async function addCustomer(businessId: number, patch: CustomerPatch): Promise<string> {
  const { data, error } = await supabase.rpc("add_customer", {
    p_business_id: businessId,
    p_first_name: patch.first_name.trim(),
    p_last_name: patch.last_name.trim(),
    p_email: patch.email.trim(),
    p_phone: patch.phone.trim() === "" ? null : patch.phone.trim(),
  });
  if (error) throw new Error(error.message);
  return data as string;
}
