-- 010 — Scope the store to a business, retiring the global "farmer" flag.
--
-- STATUS: PROPOSAL. Not run. Run LAST — after 004-007, and after 009.
--
-- is_farmer() is:
--
--   select exists (select 1 from profiles where id = auth.uid() and role = 'farmer')
--
-- One global boolean. It answers "is this person a farmer", not "may this
-- person touch this row", so every farmer can see and edit every business's
-- products, batches and orders. With one farm that's invisible. With the
-- realtor and the rental business in the same database it is not.
--
-- Migration 007 moves the herd schema onto business membership but can't fix
-- this, because these policies pass no row to check against.
--
-- Depends on 006 (business_members) and 009 (which closes the escalation
-- that makes the current model dangerous rather than merely wrong).

begin;

-- ---------------------------------------------------------------------------
-- Step 1 — give store rows a business. Additive.
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists business_id bigint references public.businesses(id);

alter table public.inventory_batches
  add column if not exists business_id bigint references public.businesses(id);

alter table public.orders
  add column if not exists business_id bigint references public.businesses(id);

-- Everything in the store today belongs to the farm. Verify the id first:
--   select id, name, type from public.businesses where type = 'farm';
update public.products          set business_id = (select id from public.businesses where type = 'farm' limit 1) where business_id is null;
update public.inventory_batches set business_id = (select id from public.businesses where type = 'farm' limit 1) where business_id is null;
update public.orders            set business_id = (select id from public.businesses where type = 'farm' limit 1) where business_id is null;

create index if not exists products_business_idx          on public.products (business_id);
create index if not exists inventory_batches_business_idx on public.inventory_batches (business_id);
create index if not exists orders_business_idx            on public.orders (business_id);

-- ---------------------------------------------------------------------------
-- Step 2 — the helper the policies will use.
-- ---------------------------------------------------------------------------

create or replace function public.is_business_member(bid bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
     where m.business_id = bid and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Step 3 — replace the global policies. ⚠️ Behaviour changes here.
--
-- ALTER POLICY rather than DROP + CREATE, so there is no window in which the
-- table sits without a policy.
-- ---------------------------------------------------------------------------

alter policy "farmer manages products" on public.products
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

alter policy "farmer manages batches" on public.inventory_batches
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

alter policy "read own orders or farmer reads all" on public.orders
  using (auth.uid() = customer_id or public.is_business_member(business_id));

alter policy "farmer updates orders" on public.orders
  using (public.is_business_member(business_id))
  with check (public.is_business_member(business_id));

alter policy "insert own orders or farmer" on public.orders
  with check (auth.uid() = customer_id or public.is_business_member(business_id));

-- Customers still need to browse. These stay open to any signed-in user:
--   "anyone signed in reads products"
--   "anyone signed in reads batches"
-- Tighten them only when the storefront becomes per-business — a customer
-- has no business_members row, so scoping these by membership would empty
-- the shop.

commit;

-- Verify signed in as yourself, not service_role (which bypasses RLS):
--   select count(*) from public.products;   -- expect the same count as before
--   select count(*) from public.orders;     -- expect the same count as before
--
-- Then, if you have a second account that is a 'farmer' but not a member of
-- the farm business, confirm it now sees zero. That is the whole point of
-- this migration, and the only way to know it worked.

-- ---------------------------------------------------------------------------
-- is_farmer() is deliberately left in place and unchanged. Nothing in these
-- policies calls it any more, but the standalone farm-app may. Drop it only
-- once that app is retired:
--
--   select p.proname, d.refobjid::regclass
--     from pg_proc p
--     join pg_depend d on d.objid = p.oid
--    where p.proname = 'is_farmer';
-- ---------------------------------------------------------------------------

-- Rollback:
--
--   alter policy "farmer manages products" on public.products
--     using (is_farmer()) with check (is_farmer());
--   alter policy "farmer manages batches" on public.inventory_batches
--     using (is_farmer()) with check (is_farmer());
--   alter policy "read own orders or farmer reads all" on public.orders
--     using (auth.uid() = customer_id or is_farmer());
--   alter policy "farmer updates orders" on public.orders
--     using (is_farmer()) with check (is_farmer());
--   alter policy "insert own orders or farmer" on public.orders
--     with check (auth.uid() = customer_id or is_farmer());
--
--   alter table public.orders            drop column business_id;
--   alter table public.inventory_batches drop column business_id;
--   alter table public.products          drop column business_id;
--   drop function if exists public.is_business_member(bigint);
