import { supabase } from "./supabase";
import type { RealLedgerAccount } from "./books-data";

/**
 * Adding, editing and removing a ledger account.
 *
 * Adding and changing an opening balance are plain writes — `authenticated`
 * has every privilege on public.ledger_accounts and the table's one policy
 * is a farmer check. Renaming and deleting are not, and the reason is a
 * column type:
 *
 *   ledger_transactions.account   text, not a foreign key
 *
 * The name is the only thing tying an entry to an account, so a rename has
 * to move the transactions with it and a delete has to move them somewhere
 * first. Both go through functions added by migration 025 so the halves
 * can't come apart — see the file for what a half-applied rename looks like.
 */

export interface AccountDraft {
  name: string;
  openingBalance: string;
}

export function validateAccount(input: {
  draft: AccountDraft;
  /** Every account name already in use, across every business — the unique
   * constraint is global, not per business. */
  takenNames: string[];
  /** The name being edited, which is allowed to stay as it is. */
  currentName?: string;
}): string | null {
  const name = input.draft.name.trim();
  if (name === "") return "An account needs a name.";

  const clash = input.takenNames.some(
    (n) => n.trim().toLowerCase() === name.toLowerCase() && n.trim() !== (input.currentName ?? "").trim(),
  );
  if (clash) return `There's already an account called ${name}. Names are unique across every business.`;

  const raw = input.draft.openingBalance.trim();
  if (raw !== "") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return "The opening balance has to be a number.";
  }
  return null;
}

const balanceOf = (raw: string): number => {
  const value = Number(raw.trim());
  return raw.trim() === "" || !Number.isFinite(value) ? 0 : Math.round(value * 100) / 100;
};

export async function createAccount(input: {
  draft: AccountDraft;
  businessId: number | null;
}): Promise<RealLedgerAccount> {
  const { data, error } = await supabase
    .from("ledger_accounts")
    .insert({
      name: input.draft.name.trim(),
      opening_balance: balanceOf(input.draft.openingBalance),
      business_id: input.businessId,
    })
    .select("id, name, opening_balance, business_id")
    .single();
  if (error) throw new Error(error.message);
  return data as RealLedgerAccount;
}

/**
 * Save an edit. The name and the opening balance take different routes on
 * purpose: the balance is one row, the name is this row plus every
 * transaction carrying it.
 *
 * The rename goes first. If it fails, nothing has changed; the other way
 * round would leave a new opening balance under the old name.
 */
export async function saveAccount(input: {
  id: number;
  currentName: string;
  draft: AccountDraft;
}): Promise<void> {
  const name = input.draft.name.trim();
  if (name !== input.currentName.trim()) {
    const { error } = await supabase.rpc("rename_ledger_account", { p_id: input.id, p_name: name });
    if (error) throw new Error(error.message);
  }

  const { error } = await supabase
    .from("ledger_accounts")
    .update({ opening_balance: balanceOf(input.draft.openingBalance) })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
}

/**
 * Remove an account. `reassignTo` is the name of the account its entries
 * should move to, and is required when it has any — the function refuses
 * otherwise rather than quietly changing a reported balance.
 */
export async function deleteAccount(id: number, reassignTo: string | null = null): Promise<void> {
  const { error } = await supabase.rpc("delete_ledger_account", {
    p_id: id,
    p_reassign_to: reassignTo,
  });
  if (error) throw new Error(error.message);
}
