-- 024 — Archiving and removing a customer.
--
-- STATUS: RUN, 2026-08-08. Verified in a rolled-back transaction with the
-- session assuming each identity in turn, so RLS and column grants both
-- applied:
--   farmer, delete a customer with orders -> refused, naming the alternative
--   farmer, delete self                   -> refused
--   farmer, edit name/email/phone         -> applied
--   farmer, archive                       -> applied, both orders kept
--   farmer, change role                   -> permission denied (by design)
--   buyer,  delete anyone                 -> refused, not a farmer
--   buyer,  edit the farmer's profile     -> 0 rows, policy filtered
-- Depends on: 009 (customer access, profiles policies).
--
-- ── Why ───────────────────────────────────────────────────────────────
--
-- Books → Customers can now be clicked into and edited. Editing already
-- works: 009 left a "farmer updates any profile" policy in place, so the
-- form needs no new grant. Removing someone does need one, and the shape of
-- it is decided by two foreign keys that already exist:
--
--   orders.customer_id    → profiles(id)          -- no ON DELETE
--   schedules.customer_id → profiles(id) ON DELETE CASCADE
--
-- So deleting a profile with any order history fails on the first FK, and
-- deleting one with standing orders silently takes those with it. Neither is
-- something a button should do by accident.
--
-- All three profiles on this farm have orders, so on today's data "delete"
-- would always fail. Archiving is the real operation; delete is for the
-- signup that never bought anything.
--
-- ── What deleting does not do ─────────────────────────────────────────
--
-- profiles.id references auth.users ON DELETE CASCADE — that direction, not
-- this one. Deleting the profile leaves the login intact, and the trigger
-- that creates a profile row would give them a fresh one the next time they
-- sign in. Removing the account itself needs the service_role key, which
-- must never be in the frontend. The page says so rather than implying a
-- customer has been erased.

begin;

alter table public.profiles
  add column if not exists archived_at timestamptz;

comment on column public.profiles.archived_at is
  'Set when a farmer archives a customer. Keeps every order and standing '
  'order intact — this is the one that gets used, because a customer with '
  'history cannot be deleted. Null means active.';

-- ── The grant this needs, and the one it deliberately doesn't ─────────
--
-- profiles is granted at the *column* level, not the table level:
-- `authenticated` holds UPDATE on exactly email, first_name, last_name and
-- phone. A column added later inherits nothing, so without this line the
-- policy passes and the write still fails with
-- "permission denied for table profiles" — which is what happened the first
-- time this migration was rehearsed. A superuser would never have seen it.
grant update (archived_at) on public.profiles to authenticated;

-- `role` is left out on purpose. It is the column is_farmer() reads, so
-- UPDATE on it is the difference between a customer and someone with ALL
-- policies on products, inventory and every order — see "Why 009 first" in
-- the README. The customer page shows the role and does not offer to change
-- it; granting UPDATE here to make a dropdown work would undo the one thing
-- 009 was for.

create or replace function public.delete_customer(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_orders integer; v_email text;
begin
  if not is_farmer() then
    raise exception 'Only a farmer can remove a customer';
  end if;
  if p_id = auth.uid() then
    raise exception 'You cannot delete your own account from here';
  end if;

  select email into v_email from profiles where id = p_id;
  if v_email is null then raise exception 'No such customer'; end if;

  -- The FK would refuse this anyway; catching it here means a sentence
  -- instead of a constraint name, and names the alternative.
  select count(*) into v_orders from orders where customer_id = p_id;
  if v_orders > 0 then
    raise exception '% has % order(s) on file — archive them instead, so the books keep their history',
      v_email, v_orders;
  end if;

  -- Standing orders cascade. That is correct here and only here: with no
  -- orders behind them they have never been fulfilled, so nothing is lost.
  delete from profiles where id = p_id;
end $function$;

comment on function public.delete_customer(uuid) is
  'Remove a customer profile that has no order history. Refuses otherwise — '
  'archive instead. Does not remove the auth.users login.';

grant execute on function public.delete_customer(uuid) to authenticated;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select count(*) from public.profiles where archived_at is not null;  -- 0
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'delete_customer';       -- one row
--
-- And with RLS applied, since a superuser proves nothing here:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--   select public.delete_customer('<a customer with orders>');  -- refused, by name
--   update public.profiles set archived_at = now() where id = '<a customer>';  -- allowed
--
--   set local request.jwt.claims = '{"sub":"<a buyer>","role":"authenticated"}';
--   select public.delete_customer('<anyone>');                  -- refused: not a farmer
--
-- Rollback:
--   drop function if exists public.delete_customer(uuid);
--   alter table public.profiles drop column if exists archived_at;
