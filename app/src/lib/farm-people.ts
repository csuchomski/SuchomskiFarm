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
 * Who gets in is kept twice — `public.business_members`, which the app and
 * the books read, and `herd.farm_members`, which every herd table checks —
 * so nothing here writes either table directly. Three database functions
 * (072) change both together and check the caller owns the farm; the tables
 * no longer take writes from a signed-in user at all. Before that, taking
 * somebody off here left them able to log moves on the herd side.
 *
 * **The farm and the business are renamed together.** They are two rows —
 * `public.businesses` is what the app shows, `herd.farms` is what the grazing
 * records hang off — and letting them drift means the payment record prints
 * one name while the rail shows another.
 */

/** What `business_members.role` may be. On the herd side the first three
 *  write and a viewer reads; the books and the store are the owner's alone
 *  (071). */
export type FarmRole = "owner" | "helper" | "vet" | "viewer";

export const FARM_ROLES: { value: FarmRole; label: string; can: string }[] = [
  { value: "owner", label: "Owner", can: "everything — the books, the store, and who else gets in" },
  { value: "helper", label: "Helper", can: "log moves, milkings, treatments and the rest of the day's work; not the books or the store" },
  { value: "vet", label: "Vet", can: "the same herd records a helper writes; not the books or the store" },
  { value: "viewer", label: "Viewer", can: "reads the herd and the grazing, changes nothing; not the books or the store" },
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

/** Change what someone may do, on both lists at once. Owners only; a farm
 *  keeps at least one owner. Both are the database's rules, not this file's. */
export async function setPersonRole(
  businessId: number,
  userId: string,
  role: FarmRole,
): Promise<void> {
  const { error } = await supabase.rpc("set_member_role", {
    p_business_id: businessId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

/** Take somebody's access away — the books and the herd both. The rows they
 *  wrote stay theirs. */
export async function removePerson(businessId: number, userId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_member", {
    p_business_id: businessId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
}

export interface Added {
  /** True when they had no login and one was made for them. */
  created: boolean;
  /** The password that login was made with. Shown once and never stored. */
  password: string | null;
}

/**
 * Let somebody in by their email address.
 *
 * Goes through the `add-person` Edge Function rather than the database,
 * because making a login needs the service-role key, and that key does not
 * belong in anything shipped to a browser. The function makes the login if
 * there is none, then lets them in *as you* — so the database's owner check
 * is still the one that decides.
 *
 * Somebody who already has a login keeps their own password; `password` comes
 * back null.
 */
export async function addPerson(input: {
  businessId: number;
  email: string;
  role: FarmRole;
  firstName: string;
  lastName: string;
}): Promise<Added> {
  const { data, error } = await supabase.functions.invoke("add-person", {
    body: {
      businessId: input.businessId,
      email: input.email.trim(),
      role: input.role,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
    },
  });
  if (error) throw new Error(await reasonFrom(error));
  const out = (data ?? {}) as Partial<Added>;
  return { created: out.created === true, password: out.password ?? null };
}

/** The function answers a refusal with `{ error }` and a 4xx; supabase-js
 *  hands that back as a generic "non-2xx status" unless the body is read. */
async function reasonFrom(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown; message?: unknown };
      if (typeof body.error === "string") return body.error;
      if (typeof body.message === "string") return body.message;
    } catch {
      /* not JSON — fall through */
    }
  }
  return error instanceof Error ? error.message : String(error);
}
