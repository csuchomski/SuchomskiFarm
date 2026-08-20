import { supabase, herdSchema } from "./supabase";

/**
 * The farm's name, and who can sign in to it.
 *
 * Neither has ever had a screen. The name was typed once on the way in and
 * could not be changed afterwards; who has access lives in
 * `public.business_members` and was readable only from the SQL editor. A farm
 * that takes on a helper had no way to let them in, and a farm that spelled
 * its own name wrong had to live with it.
 *
 * Nothing here needed new permissions. `businesses` already allows an owner
 * to update, `business_members` already allows an owner to write and any
 * member to read, and `profiles` already lets a farmer read the rest. This is
 * the screen those policies were waiting for.
 *
 * **The farm and the business are renamed together.** They are two rows —
 * `public.businesses` is what the app shows, `herd.farms` is what the grazing
 * records hang off — and letting them drift means the payment record prints
 * one name while the rail shows another.
 */

/** What `business_members.role` may be. `can_write_farm` allows the first
 *  three; a viewer reads and nothing more. */
export type FarmRole = "owner" | "helper" | "vet" | "viewer";

export const FARM_ROLES: { value: FarmRole; label: string; can: string }[] = [
  { value: "owner", label: "Owner", can: "everything, including who else gets in" },
  { value: "helper", label: "Helper", can: "log moves, milkings and the rest of the day's work" },
  { value: "vet", label: "Vet", can: "the same records a helper writes" },
  { value: "viewer", label: "Viewer", can: "read only" },
];

export interface Person {
  userId: string;
  role: FarmRole;
  addedAt: string;
  /** From `profiles`, which may have nothing on file for them yet. */
  name: string | null;
  email: string | null;
}

export async function fetchPeople(businessId: number): Promise<Person[]> {
  const { data, error } = await supabase
    .from("business_members")
    .select("user_id, role, added_at")
    .eq("business_id", businessId)
    .order("added_at");
  if (error) throw new Error(`business_members: ${error.message}`);

  const rows = (data ?? []) as { user_id: string; role: string; added_at: string }[];
  if (rows.length === 0) return [];

  // A separate read rather than a join: `profiles` is a different table with
  // its own policy, and a member whose profile is not readable should still
  // appear in the list rather than taking the list down with them.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, email")
    .in("id", rows.map((r) => r.user_id));

  const byId = new Map(
    ((profiles ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[])
      .map((p) => [p.id, p]),
  );

  return rows.map((r) => {
    const p = byId.get(r.user_id);
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
    return {
      userId: r.user_id,
      role: r.role as FarmRole,
      addedAt: r.added_at,
      name: name === "" ? null : name,
      email: p?.email ?? null,
    };
  });
}

/**
 * Rename the farm.
 *
 * Both rows, in that order. If the second fails the first has still landed,
 * which is a visible half-rename rather than a silent one — the name on the
 * rail changes and the payment record does not, and the next attempt fixes
 * it. Doing it the other way round would leave the farm looking unchanged.
 */
export async function renameFarm(input: {
  businessId: number;
  farmId: string | null;
  name: string;
}): Promise<void> {
  const name = input.name.trim();
  if (name === "") throw new Error("The farm needs a name.");

  const { error } = await supabase
    .from("businesses")
    .update({ name })
    .eq("id", input.businessId);
  if (error) throw new Error(`businesses: ${error.message}`);

  if (input.farmId !== null) {
    const { error: farmError } = await herdSchema()
      .from("farms")
      .update({ name })
      .eq("id", input.farmId);
    if (farmError) {
      throw new Error(
        `The name changed on the app but not on the grazing records: ${farmError.message}`,
      );
    }
  }
}

/** Change what someone may do. Owners only, by policy. */
export async function setPersonRole(
  businessId: number,
  userId: string,
  role: FarmRole,
): Promise<void> {
  const { error } = await supabase
    .from("business_members")
    .update({ role })
    .eq("business_id", businessId)
    .eq("user_id", userId);
  if (error) throw new Error(`business_members: ${error.message}`);
}

/** Take somebody's access away. The rows they wrote stay theirs. */
export async function removePerson(businessId: number, userId: string): Promise<void> {
  const { error } = await supabase
    .from("business_members")
    .delete()
    .eq("business_id", businessId)
    .eq("user_id", userId);
  if (error) throw new Error(`business_members: ${error.message}`);
}
