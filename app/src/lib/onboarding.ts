import { supabase } from "./supabase";

/**
 * Starting a farm, and getting an account to start it with.
 *
 * Both are one call each on purpose. Creating a farm is four inserts across
 * two schemas — the business, the membership, the herd farm, its membership —
 * none of which a client may write on its own, and all of which have to land
 * together or the account ends up with a workspace it cannot see or a
 * business with nowhere to put an animal. That is migration 051's function.
 */

/**
 * Make an account.
 *
 * Returns whether a confirmation mail is in the way. With confirmations on,
 * `signUp` hands back no session, so nothing can be written as this person
 * yet and the farm has to wait until they have followed the link.
 */
export async function signUpFarmer(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return { needsConfirmation: !data.session };
}

/**
 * Start a farm for the signed-in account. Returns the new business id.
 *
 * `farmName` is optional and falls back to the business name, because for
 * most people they are the same words and asking twice is a way of making a
 * form look official.
 */
export async function createFarm(businessName: string, farmName?: string): Promise<number> {
  const { data, error } = await supabase.rpc("create_farm", {
    p_business_name: businessName,
    p_farm_name: farmName?.trim() ? farmName.trim() : null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
