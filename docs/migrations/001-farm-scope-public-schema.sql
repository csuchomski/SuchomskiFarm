-- 001 — Scope the public (store/books) schema to a farm.
--
-- STATUS: PROPOSAL. Not run.
--
-- Why: herd.* is multi-tenant — every table carries farm_id and every RLS
-- policy checks herd.is_farm_member(farm_id). public.* has RLS enabled and
-- policies on every table, but public.businesses has no farm_id, so the
-- ledger side has no farm to scope to. Migration 002 links per-animal costs
-- across that boundary; this gives the boundary something to check.
--
-- ⚠️ BEFORE RUNNING: this migration is only necessary if the existing
-- policies on the ledger tables don't already scope access adequately. Dump
-- them first:
--
--   select tablename, policyname, cmd, qual, with_check
--     from pg_policies where schemaname = 'public' order by tablename;
--
-- If ledger_transactions' policy is farm-equivalent already, skip this
-- migration. If it's `using (auth.role() = 'authenticated')` or similar,
-- every signed-in user sees every farm's books and this closes that.
--
-- An earlier draft of this file also enabled RLS on these tables. That was
-- based on a wrong inference — RLS is already on, verified against
-- pg_class.relrowsecurity. Those statements have been removed; adding
-- farm_id is what's actually missing.

begin;

-- ---------------------------------------------------------------------------
-- Step 1 — give businesses a farm. Additive, safe.
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists farm_id uuid references herd.farms(id);

-- Backfill. Safe only while exactly one farm exists — verify first:
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

commit;

-- ---------------------------------------------------------------------------
-- Step 3 — tighten the existing policies. NOT WRITTEN.
--
-- Deliberately left out until the current policy definitions are known:
-- replacing a policy you haven't read is how you lock yourself out of your
-- own books, or quietly widen access while believing you narrowed it.
--
-- Once dumped, the shape to aim for on the ledger tables is:
--
--   alter policy <existing_name> on public.ledger_transactions
--     using (public.is_business_member(business_id));
--
-- ALTER POLICY rather than DROP + CREATE, so there's no window where the
-- table sits unprotected.
-- ---------------------------------------------------------------------------

-- Rollback (steps 1-2):
--
--   drop function if exists public.is_business_member(bigint);
--   drop index if exists public.businesses_farm_id_idx;
--   alter table public.businesses drop column if exists farm_id;
