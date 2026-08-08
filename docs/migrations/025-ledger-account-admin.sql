-- 025 — Renaming and removing a ledger account without stranding money.
--
-- STATUS: RUN, 2026-08-08. Verified in a rolled-back transaction as the
-- farmer, so RLS applied throughout:
--   plain insert added an account; plain update changed its opening balance
--   renaming 'Venmo' moved both its transactions — which live in business 4
--     while the account row's business_id is null, the case the scope note
--     below exists for
--   renaming onto an existing name -> refused, and says why it's unique
--   deleting an account with 1 entry and no target -> refused, names the count
--   deleting with a target that doesn't exist -> refused
--   deleting with a real target -> entries moved, then the row went
--   deleting an empty account -> straight through
--   a buyer renaming anything -> refused; a buyer sees 0 accounts at all
-- Depends on: nothing. Two functions; no schema change.
--
-- ── Why functions, when the policy already allows everything ──────────
--
-- `authenticated` holds SELECT/INSERT/UPDATE/DELETE on public.ledger_accounts
-- with every column granted, and the table's one policy is a farmer check on
-- both USING and WITH CHECK. Adding an account and editing its opening
-- balance need nothing from this file — a plain insert and a plain update
-- already work.
--
-- Renaming and deleting are different, because of one column type:
--
--   ledger_transactions.account   text, not a foreign key
--
-- The only thing tying an entry to an account is the name matching. So a
-- rename is *two* writes — the account row and every transaction carrying the
-- old name — and doing them as two round trips means a failure between them
-- leaves the money filed under a name no account has. The balance page would
-- show the renamed account at its opening balance with no entries, and the
-- old name back as "unlisted". Both halves belong in one transaction, which
-- is what a function gives.
--
-- Deleting has the same shape: an account with entries against it can only be
-- removed safely by moving those entries somewhere first.
--
-- ── Scope of a rename ─────────────────────────────────────────────────
--
-- `ledger_accounts_name_key` is UNIQUE (name) — globally, not per business.
-- So a name identifies exactly one account everywhere, and a rename updates
-- every transaction carrying it regardless of which business the transaction
-- belongs to. That is not a preference; it follows from the constraint.
--
-- It also shows up in the live data: the "Venmo" account row has business_id
-- null while the two transactions naming "Venmo" belong to business 4.
-- Scoping the update by the account's own business_id would have missed both.

begin;

create or replace function public.rename_ledger_account(p_id bigint, p_name text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_old text; v_new text; v_moved integer;
begin
  if not is_farmer() then
    raise exception 'Only a farmer can change an account';
  end if;

  v_new := btrim(p_name);
  if v_new = '' then raise exception 'An account needs a name'; end if;

  select name into v_old from ledger_accounts where id = p_id;
  if v_old is null then raise exception 'No such account'; end if;
  if v_old = v_new then return; end if;

  if exists (select 1 from ledger_accounts where name = v_new and id <> p_id) then
    raise exception 'There is already an account called %. Account names are unique across every business.', v_new;
  end if;

  update ledger_accounts set name = v_new where id = p_id;

  -- The half that would otherwise be forgotten. Not scoped by business:
  -- the name is globally unique, so every row carrying it is this account.
  update ledger_transactions set account = v_new where account = v_old;
  get diagnostics v_moved = row_count;

  raise notice 'Renamed % to %, and moved % transaction(s)', v_old, v_new, v_moved;
end $function$;

comment on function public.rename_ledger_account(bigint, text) is
  'Rename an account and every transaction naming it, in one transaction. '
  'ledger_transactions.account is text, so the two halves have to move '
  'together or the money is stranded under the old name.';

create or replace function public.delete_ledger_account(p_id bigint, p_reassign_to text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_name text; v_entries integer; v_target text;
begin
  if not is_farmer() then
    raise exception 'Only a farmer can remove an account';
  end if;

  select name into v_name from ledger_accounts where id = p_id;
  if v_name is null then raise exception 'No such account'; end if;

  select count(*) into v_entries from ledger_transactions where account = v_name;

  if v_entries > 0 then
    if p_reassign_to is null then
      -- Deleting anyway would leave the entries pointing at a name with no
      -- account row: the money keeps counting towards Net and the category
      -- totals, but its opening balance vanishes and the balance page files
      -- it under "unlisted". Quietly changing a reported balance is not
      -- something a delete button should do.
      raise exception '% has % entr%. Move them to another account first.',
        v_name, v_entries, case when v_entries = 1 then 'y' else 'ies' end;
    end if;

    v_target := btrim(p_reassign_to);
    if v_target = v_name then raise exception 'That is the account being deleted'; end if;
    if not exists (select 1 from ledger_accounts where name = v_target) then
      raise exception 'No account called % to move them to', v_target;
    end if;

    update ledger_transactions set account = v_target where account = v_name;
  end if;

  delete from ledger_accounts where id = p_id;
end $function$;

comment on function public.delete_ledger_account(bigint, text) is
  'Remove an account. Refuses while transactions name it unless given '
  'another account to move them to first.';

grant execute on function public.rename_ledger_account(bigint, text) to authenticated;
grant execute on function public.delete_ledger_account(bigint, text) to authenticated;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('rename_ledger_account','delete_ledger_account');
--     -- exactly two rows, no overloads
--
-- And with RLS applied, since that is the caller that matters — inside a
-- transaction you roll back:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--   select public.rename_ledger_account(1, 'Venmo (personal)');
--   select account, count(*) from ledger_transactions group by 1;   -- none left on 'Venmo'
--   select public.delete_ledger_account(3);                          -- refused, names the count
--   select public.delete_ledger_account(3, 'Venmo (personal)');      -- allowed, entries moved
--
-- Rollback:
--   drop function if exists public.rename_ledger_account(bigint, text);
--   drop function if exists public.delete_ledger_account(bigint, text);
