-- 006 — Membership on the business, mirroring herd.farm_members.
--
-- STATUS: PROPOSAL. Not run. Additive.
-- Depends on: 005 (herd.farms.business_id), used to backfill.

begin;

create table if not exists public.business_members (
  business_id bigint      not null references public.businesses(id) on delete cascade,
  user_id     uuid        not null references auth.users(id)        on delete cascade,
  role        text        not null default 'member',
  added_at    timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index if not exists business_members_user_idx on public.business_members (user_id);

-- Carry existing farm membership across, so nobody has to be re-invited.
insert into public.business_members (business_id, user_id, role, added_at)
select f.business_id, m.user_id, m.role, m.added_at
  from herd.farm_members m
  join herd.farms f on f.id = m.farm_id
 where f.business_id is not null
on conflict (business_id, user_id) do nothing;

-- The two non-farm businesses have no farm to inherit members from, so
-- their owner has to be named explicitly or they'll be unreachable once
-- 007 lands. Adds the farm's owner to every business that has no members:
insert into public.business_members (business_id, user_id, role)
select b.id, owner.user_id, 'owner'
  from public.businesses b
 cross join (
    select m.user_id
      from herd.farm_members m
     where m.role = 'owner'
     order by m.added_at
     limit 1
 ) owner
 where not exists (select 1 from public.business_members bm where bm.business_id = b.id)
on conflict (business_id, user_id) do nothing;

alter table public.business_members enable row level security;

-- A member can see the rosters of businesses they belong to. Self-referential
-- policies can recurse, so membership is tested with a plain exists on the
-- same table rather than through a helper that re-queries it.
create policy business_members_select on public.business_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.business_members mine
       where mine.business_id = business_members.business_id
         and mine.user_id = auth.uid()
    )
  );

create policy business_members_owner_write on public.business_members
  for all to authenticated
  using (
    exists (
      select 1 from public.business_members mine
       where mine.business_id = business_members.business_id
         and mine.user_id = auth.uid()
         and mine.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.business_members mine
       where mine.business_id = business_members.business_id
         and mine.user_id = auth.uid()
         and mine.role = 'owner'
    )
  );

commit;

-- Confirm every business has at least one member before running 007 —
-- afterwards, a business with no members is invisible to everyone:
--
--   select b.id, b.name, b.type, count(m.user_id) as members
--     from public.businesses b
--     left join public.business_members m on m.business_id = b.id
--    group by b.id, b.name, b.type
--    order by members;

-- Rollback:
--   drop table public.business_members;
