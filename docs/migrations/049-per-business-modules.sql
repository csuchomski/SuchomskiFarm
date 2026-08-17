-- 049 — modules belong to a business, not to a kind of business
--
-- STATUS: run 2026-08-17
--
-- `business_type_modules(type_code, module_code)` says every business of type
-- `farm` gets books, herd and store. That is a statement about a *category*,
-- and there is no way to say anything about one business — so two farms
-- cannot have different modules, and a farm that wants the grazing records
-- without the shop cannot have that either.
--
-- This adds the row that was missing: which modules *this* business has.
--
-- Nothing changes today. Every existing business is seeded from the type map
-- it was already getting, so the same modules resolve for the same people;
-- the difference is that they are now written down per business and can be
-- changed one at a time.
--
-- **No client writes.** There is deliberately no insert or update policy.
-- What a business is entitled to is not a thing its own members get to
-- decide — it follows from what they signed up for, and the day that is a
-- subscription it will be written by the thing that takes the money, from a
-- trusted context. A member can read their entitlement and nothing more.
--
-- The type map is left in place. It is still the right source for "what
-- should a new business of this kind start with", and 050 leans on it.

create table if not exists public.business_modules (
  business_id integer not null references public.businesses(id) on delete cascade,
  module_code text    not null references public.modules(code),
  granted_at  timestamptz not null default now(),
  primary key (business_id, module_code)
);

alter table public.business_modules enable row level security;

drop policy if exists business_modules_select on public.business_modules;
create policy business_modules_select on public.business_modules
  for select using (public.is_business_member(business_id));

revoke all on public.business_modules from anon, authenticated;
grant select on public.business_modules to authenticated;

comment on table public.business_modules is
  'Which modules a business has. Written from a trusted context only — members may read their entitlement, never grant it.';

-- Seed from the type map, so every business keeps exactly what it had.
insert into public.business_modules (business_id, module_code)
select b.id, m.module_code
  from public.businesses b
  join public.business_type_modules m on m.type_code = b.type
on conflict do nothing;

-- Does this business have this module? Security definer so it can be used
-- from a policy on another table without that table's reader needing to see
-- the entitlement row — 050 reads it from the products policy, where the
-- reader is a customer who is a member of nothing.
-- `bigint` rather than `integer`, to match `is_business_member` and because a
-- literal in a policy or a select resolves to bigint often enough that an
-- integer signature simply fails to be found. Integer arguments widen to it.
create or replace function public.business_has_module(p_business_id bigint, p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.business_modules
     where business_id = p_business_id and module_code = p_code
  );
$$;

revoke all on function public.business_has_module(bigint, text) from public;
grant execute on function public.business_has_module(bigint, text) to authenticated, anon;
