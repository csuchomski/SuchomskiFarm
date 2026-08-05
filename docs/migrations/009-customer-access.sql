-- 009 — Let customers actually use the storefront.
--
-- STATUS: PROPOSAL. Not run.
--
-- The existing policies let a customer *read* products, batches and their own
-- orders, but there is no INSERT on orders and no INSERT on profiles. So a
-- customer can browse and can't buy, and can't finish signing up. The
-- storefront is unbuildable without this.
--
-- (public.schedules already has the full set — select/insert/update/delete
-- scoped to "own or farmer". This brings orders and profiles up to match.)

begin;

-- ---------------------------------------------------------------------------
-- profiles — let a new account create its own row.
--
-- ⚠️ The `role = 'customer'` check is load-bearing, not tidiness. is_farmer()
-- reads this table. Without it, a customer could insert their own profile
-- with role = 'farmer' and hand themselves full access to every product,
-- batch and order on the farm. Self-service signup + self-assigned role is a
-- privilege escalation.
-- ---------------------------------------------------------------------------

create policy "insert own profile as customer" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id and role = 'customer');

-- The existing "update own profile" policy has a USING clause but no
-- WITH CHECK, which means a customer can already promote themselves:
--
--   update profiles set role = 'farmer' where id = auth.uid();
--
-- USING decides which rows you may update; WITH CHECK decides what they may
-- become. Without the second, the new row is unchecked. Same escalation,
-- through a door that is already open — worth closing whether or not the
-- rest of this migration runs.
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id and role = (select p.role from public.profiles p where p.id = auth.uid()));

-- ---------------------------------------------------------------------------
-- orders — reserving, and cancelling.
-- ---------------------------------------------------------------------------

create policy "insert own orders or farmer" on public.orders
  for insert to authenticated
  with check (auth.uid() = customer_id or is_farmer());

-- Deliberately NOT a general update policy for customers. RLS gates rows, not
-- columns, so "customers may update their own orders" would also let them
-- rewrite unit_price, total_cost, amount_paid, or mark themselves picked up.
-- Cancelling is the only thing a customer needs, so it gets a function that
-- can only do that.
create policy "farmer updates orders" on public.orders
  for update to authenticated
  using (is_farmer())
  with check (is_farmer());

create or replace function public.cancel_my_order(order_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set status = 'cancelled',
         cancelled_date = now()
   where id = order_id
     and customer_id = auth.uid()
     and picked_up_date is null
     and cancelled_date is null;

  if not found then
    raise exception 'Order not found, not yours, or already collected';
  end if;
end;
$$;

revoke all on function public.cancel_my_order(bigint) from public;
grant execute on function public.cancel_my_order(bigint) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Separately: is_farmer() is a third tenancy model.
--
-- herd.*   -> herd.is_farm_member(farm_id)
-- store.*  -> is_farmer()
-- books.*  -> business_id
--
-- Migration 007 redefines the first to answer via business membership. It
-- does NOT touch is_farmer(), so after 007 the store tables still use the old
-- model and "farmer" stays global rather than per-business — anyone who is a
-- farmer sees every business's products and orders.
--
-- Deliberately not fixed here, because the right definition depends on what
-- is_farmer() currently does, which hasn't been dumped:
--
--   select prosrc from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'is_farmer';
--
-- Once that's known it likely becomes "is a member of the business owning
-- this row", which needs products/inventory_batches/orders to carry a
-- business_id they currently don't have. That's its own migration.
-- ---------------------------------------------------------------------------

-- Rollback:
--
--   drop function if exists public.cancel_my_order(bigint);
--   drop policy if exists "farmer updates orders"        on public.orders;
--   drop policy if exists "insert own orders or farmer"  on public.orders;
--   drop policy if exists "insert own profile as customer" on public.profiles;
--   drop policy if exists "update own profile"           on public.profiles;
--   create policy "update own profile" on public.profiles
--     for update using (auth.uid() = id);
