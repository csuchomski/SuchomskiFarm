-- 001 — Scope the public (store/books) schema to a farm, and lock it down.
--
-- STATUS: PROPOSAL. Not run. Read the warnings before executing.
--
-- Why: herd.* is multi-tenant — every table carries farm_id and every RLS
-- policy checks herd.is_farm_member(farm_id). public.* is not scoped to a
-- farm at all. Linking per-animal costs to ledger transactions (migration
-- 002) across that boundary would let one farm's records reference another's.
--
-- ⚠️ READ FIRST — this is the risky migration of the pair.
--
--   1. Enabling RLS on a table that currently has none immediately blocks
--      ALL access except through the policies below. The existing
--      FarmFinanceTracker / farm-app deployments read these tables. If they
--      authenticate as anon WITHOUT a signed-in user, they will break the
--      moment step 3 runs. Verify how those apps authenticate first.
--
--   2. Run this in a transaction, off-hours, against a backup you've
--      actually restored once. Steps 1-2 are safe and additive; step 3 is
--      the breaking one and can be deferred.
--
--   3. The customer storefront needs read access to products and its own
--      orders. Those policies are NOT written here — customers aren't
--      farm_members, so they need a separate design. Until that exists,
--      enabling RLS on public.products breaks the storefront.

begin;

-- ---------------------------------------------------------------------------
-- Step 1 — give businesses a farm. Additive, safe.
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists farm_id uuid references herd.farms(id);

-- Backfill. Safe only while exactly one farm exists — verify before running:
--   select count(*) from herd.farms;  -- must be 1
update public.businesses
   set farm_id = (select id from herd.farms limit 1)
 where farm_id is null;

alter table public.businesses
  alter column farm_id set not null;

create index if not exists businesses_farm_id_idx on public.businesses (farm_id);

-- ---------------------------------------------------------------------------
-- Step 2 — a helper so policies don't repeat the join. Additive, safe.
-- ---------------------------------------------------------------------------

create or replace function public.is_business_member(bid bigint)
returns boolean
language sql
stable
security definer
set search_path = public, herd
as $$
  select exists (
    select 1
      from public.businesses b
     where b.id = bid
       and herd.is_farm_member(b.farm_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Step 3 — turn on RLS. ⚠️ THIS IS THE BREAKING STEP. Defer if unsure.
-- ---------------------------------------------------------------------------

alter table public.businesses          enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_accounts     enable row level security;
alter table public.ledger_assets       enable row level security;

create policy businesses_select on public.businesses
  for select using (herd.is_farm_member(farm_id));
create policy businesses_write on public.businesses
  for all using (herd.can_write_farm(farm_id))
          with check (herd.can_write_farm(farm_id));

create policy ledger_transactions_select on public.ledger_transactions
  for select using (public.is_business_member(business_id));
create policy ledger_transactions_write on public.ledger_transactions
  for all using (public.is_business_member(business_id))
          with check (public.is_business_member(business_id));

create policy ledger_accounts_select on public.ledger_accounts
  for select using (business_id is null or public.is_business_member(business_id));
create policy ledger_accounts_write on public.ledger_accounts
  for all using (business_id is null or public.is_business_member(business_id))
          with check (business_id is null or public.is_business_member(business_id));

create policy ledger_assets_select on public.ledger_assets
  for select using (public.is_business_member(business_id));
create policy ledger_assets_write on public.ledger_assets
  for all using (public.is_business_member(business_id))
          with check (public.is_business_member(business_id));

commit;

-- ---------------------------------------------------------------------------
-- Still unprotected after this migration, deliberately — each needs a
-- decision about customer access before it can be locked down:
--
--   public.profiles          -- ⚠️ names, emails, phone numbers. Highest
--                            -- priority: readable by anyone holding the
--                            -- anon key if RLS is currently off.
--   public.orders            -- customer_id, payment_method, amount_paid
--   public.schedules         -- customer standing orders
--   public.products          -- storefront needs anonymous read
--   public.inventory_batches -- storefront needs anonymous read for stock
--   public.discards
--
-- Suggested shape for the customer-facing ones: products and
-- inventory_batches get a permissive read-only policy (`using (true)` for
-- select only, no write); orders and profiles get
-- `using (customer_id = auth.uid())` so a customer sees only their own,
-- plus the farm-member policy for staff.
-- ---------------------------------------------------------------------------

-- Rollback for step 3 (steps 1-2 are additive and can stay):
--
--   drop policy ledger_assets_write        on public.ledger_assets;
--   drop policy ledger_assets_select       on public.ledger_assets;
--   drop policy ledger_accounts_write      on public.ledger_accounts;
--   drop policy ledger_accounts_select     on public.ledger_accounts;
--   drop policy ledger_transactions_write  on public.ledger_transactions;
--   drop policy ledger_transactions_select on public.ledger_transactions;
--   drop policy businesses_write           on public.businesses;
--   drop policy businesses_select          on public.businesses;
--   alter table public.ledger_assets       disable row level security;
--   alter table public.ledger_accounts     disable row level security;
--   alter table public.ledger_transactions disable row level security;
--   alter table public.businesses          disable row level security;
