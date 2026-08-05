-- ====================================================================
-- 008-product-types.sql
-- ====================================================================

-- 008 — Give products a type, so "milk today" stops meaning "product whose
--       name contains the word milk".
--
-- STATUS: PROPOSAL. Not run. Additive and independent.
--
-- The dashboard currently identifies milk with a regex on the product name.
-- That works at four products and breaks quietly at forty — a "Milk soap"
-- would be counted as milk production, and a product called "Raw Jersey"
-- wouldn't be counted at all. Neither failure announces itself.
--
-- Types are a lookup table rather than a CHECK, matching the decision made
-- for transaction and business types: a new type is a row.

begin;

create table if not exists public.product_types (
  code       text primary key,
  label      text    not null,
  active     boolean not null default true,
  sort_order integer not null default 100
);

insert into public.product_types (code, label, sort_order) values
  ('milk',    'Milk',           10),
  ('eggs',    'Eggs',           20),
  ('meat',    'Meat',           30),
  ('produce', 'Produce',        40),
  ('honey',   'Honey',          50),
  ('other',   'Other',          90)
on conflict (code) do nothing;

alter table public.products
  add column if not exists type_code text references public.product_types(code);

-- Best-effort backfill by name. Deliberately conservative: anything it can't
-- confidently place is left null rather than guessed into 'other', so the
-- gaps are visible and can be set by hand.
update public.products set type_code = 'milk'    where type_code is null and name ~* '\ymilk\y';
update public.products set type_code = 'eggs'    where type_code is null and name ~* '\yeggs?\y';
update public.products set type_code = 'honey'   where type_code is null and name ~* '\yhoney\y';
update public.products set type_code = 'meat'    where type_code is null and name ~* '\y(beef|pork|lamb|chicken|steak|roast|ground)\y';
update public.products set type_code = 'produce' where type_code is null and name ~* '\y(corn|tomato|squash|bean|pepper|potato|lettuce)\y';

alter table public.product_types enable row level security;

create policy product_types_select on public.product_types
  for select to authenticated using (true);

commit;

-- Check what the backfill missed and set those by hand — there are only a
-- handful of products, so this is a one-minute job:
--
--   select id, name, unit, type_code from public.products order by type_code nulls first;
--
--   update public.products set type_code = 'milk' where id = <id>;
--
-- Left nullable on purpose. A product with no type is a visible gap; a
-- NOT NULL default of 'other' would silently mislabel everything the
-- backfill couldn't place.

-- Rollback:
--   alter table public.products drop column type_code;
--   drop table public.product_types;


-- ====================================================================
-- 013-animal-attribute-options.sql
-- ====================================================================

-- 013 — Move animal attribute vocabularies into the database.
--
-- STATUS: PROPOSAL. Not run. Additive and independent.
--
-- sex, class, purpose, origin, status and friends are free text on
-- herd.animals with no lookup behind them, so the app was hardcoding option
-- lists. A new class then needs a deploy, and nothing stops two spellings of
-- the same thing coexisting.
--
-- The herd schema already does this per concept — breeds, cull_reason_codes,
-- genetic_conditions, trait_definitions all carry code/label/active/farm_id.
-- This follows that shape but keys by attribute instead of adding eight
-- near-identical tables, so a new attribute (tag_color, record_type,
-- whatever comes next) is rows rather than a migration.

begin;

create table if not exists herd.attribute_options (
  id          uuid        primary key default gen_random_uuid(),
  attribute   text        not null,
  code        text        not null,
  label       text        not null,
  sort_order  integer     not null default 100,
  active      boolean     not null default true,
  farm_id     uuid        not null references herd.farms(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz,
  rev         integer     not null default 1,
  unique (farm_id, attribute, code)
);

comment on column herd.attribute_options.attribute is
  'Which column on herd.animals this vocabulary belongs to: sex, class, '
  'purpose, origin, status, horn_status, polled_genotype, record_type.';
comment on column herd.attribute_options.code is
  'The value stored on the animal row. label is what a person reads.';

create index if not exists attribute_options_lookup_idx
  on herd.attribute_options (farm_id, attribute, active);

-- ---------------------------------------------------------------------------
-- Seed from what the herd already uses, so nothing in the data becomes
-- unselectable. Labels are derived from the code — 'born_here' reads as
-- 'Born here' — and can be edited afterwards.
-- ---------------------------------------------------------------------------

insert into herd.attribute_options (attribute, code, label, farm_id)
select attr, code, initcap(replace(code, '_', ' ')), farm_id
from (
  select 'sex'             as attr, sex             as code, farm_id from herd.animals
  union select 'class',            class,            farm_id from herd.animals
  union select 'purpose',          purpose,          farm_id from herd.animals
  union select 'origin',           origin,           farm_id from herd.animals
  union select 'status',           status,           farm_id from herd.animals
  union select 'horn_status',      horn_status,      farm_id from herd.animals
  union select 'polled_genotype',  polled_genotype,  farm_id from herd.animals
  union select 'record_type',      record_type,      farm_id from herd.animals
) v
where coalesce(trim(code), '') <> ''
on conflict (farm_id, attribute, code) do nothing;

-- Add the values a farm is likely to need that aren't in the data yet. Only
-- inserted for farms that already have options, so this can't create rows for
-- a farm that doesn't exist.
insert into herd.attribute_options (attribute, code, label, sort_order, farm_id)
select v.attr, v.code, v.label, v.sort_order, f.id
from herd.farms f
cross join (values
  ('sex',     'female',    'Female',    10),
  ('sex',     'male',      'Male',      20),
  ('class',   'calf',      'Calf',      10),
  ('class',   'heifer',    'Heifer',    20),
  ('class',   'cow',       'Cow',       30),
  ('class',   'bull',      'Bull',      40),
  ('class',   'steer',     'Steer',     50),
  ('purpose', 'dairy',     'Dairy',     10),
  ('purpose', 'beef',      'Beef',      20),
  ('purpose', 'dual',      'Dual purpose', 30),
  ('origin',  'born_here', 'Born here', 10),
  ('origin',  'purchased', 'Purchased', 20),
  ('status',  'active',    'Active',    10),
  ('status',  'sold',      'Sold',      20),
  ('status',  'culled',    'Culled',    30),
  ('status',  'dead',      'Dead',      40)
) as v(attr, code, label, sort_order)
on conflict (farm_id, attribute, code) do nothing;

-- ---------------------------------------------------------------------------
-- RLS, matching every other table in this schema.
-- ---------------------------------------------------------------------------

alter table herd.attribute_options enable row level security;

create policy attribute_options_select on herd.attribute_options
  for select using (herd.is_farm_member(farm_id));

create policy attribute_options_insert on herd.attribute_options
  for insert with check (herd.can_write_farm(farm_id));

create policy attribute_options_update on herd.attribute_options
  for update using (herd.can_write_farm(farm_id))
          with check (herd.can_write_farm(farm_id));

commit;

-- ---------------------------------------------------------------------------
-- Deliberately NOT adding foreign keys from herd.animals to this table.
--
-- A FK would need one per column and would reject any existing row whose
-- value isn't seeded — and more to the point, it would make retiring an
-- option impossible while any historical animal still carries it. Retiring
-- is `active = false`: the option leaves the picker, and old records keep
-- rendering. Tighten to real FKs later if the vocabularies prove stable.
--
-- Check what got seeded:
--
--   select attribute, code, label, sort_order
--     from herd.attribute_options
--    where deleted_at is null
--    order by attribute, sort_order, code;
-- ---------------------------------------------------------------------------

-- Rollback:
--   drop table herd.attribute_options;


-- ====================================================================
-- 004-business-types-and-modules.sql
-- ====================================================================

-- 004 — Business types, and which modules each type gets.
--
-- STATUS: PROPOSAL. Not run. Additive and independent — safe to run alone.
-- See docs/business-as-tenant.md.
--
-- Types and modules are data, not code: a new business type is rows, no
-- migration and no deploy, the same decision made for transaction types.

begin;

create table if not exists public.business_types (
  code       text primary key,
  label      text    not null,
  active     boolean not null default true,
  sort_order integer not null default 100
);

create table if not exists public.modules (
  code       text primary key,
  label      text    not null,
  sort_order integer not null default 100
);

create table if not exists public.business_type_modules (
  type_code   text not null references public.business_types(code) on delete cascade,
  module_code text not null references public.modules(code)        on delete cascade,
  primary key (type_code, module_code)
);

-- Seeded to match the values already in public.businesses.type —
-- 'farm', 'rental', 'other' — so the foreign key below validates without
-- rewriting any existing row. Verify before running:
--   select distinct type from public.businesses;
insert into public.business_types (code, label, sort_order) values
  ('farm',   'Farm',           10),
  ('rental', 'Rental property', 20),
  ('other',  'Other',           90)
on conflict (code) do nothing;

insert into public.modules (code, label, sort_order) values
  ('books',      'Books',      10),
  ('herd',       'Herd',       20),
  ('store',      'Store',      30),
  ('properties', 'Properties', 40),
  ('leases',     'Leases',     50)
on conflict (code) do nothing;

-- Books is common to every type — it's the thing every business has.
insert into public.business_type_modules (type_code, module_code) values
  ('farm',   'books'),
  ('farm',   'herd'),
  ('farm',   'store'),
  ('rental', 'books'),
  ('rental', 'properties'),
  ('rental', 'leases'),
  ('other',  'books')
on conflict do nothing;

alter table public.businesses
  add constraint businesses_type_fkey
  foreign key (type) references public.business_types(code);

alter table public.business_types       enable row level security;
alter table public.modules              enable row level security;
alter table public.business_type_modules enable row level security;

-- Shared vocabulary, not tenant data: readable by anyone signed in.
create policy business_types_select on public.business_types
  for select to authenticated using (true);
create policy modules_select on public.modules
  for select to authenticated using (true);
create policy business_type_modules_select on public.business_type_modules
  for select to authenticated using (true);

commit;

-- ---------------------------------------------------------------------------
-- Adding a type later is two inserts, no migration:
--
--   insert into public.business_types (code, label) values ('brokerage', 'Brokerage');
--   insert into public.business_type_modules values ('brokerage', 'books');
--
-- Retiring one: set active = false. The FK will refuse a delete while
-- businesses still reference it, which is correct — history shouldn't change
-- because a type fell out of use.
-- ---------------------------------------------------------------------------

-- Rollback:
--   alter table public.businesses drop constraint businesses_type_fkey;
--   drop table public.business_type_modules;
--   drop table public.modules;
--   drop table public.business_types;


-- ====================================================================
-- 005-link-farms-to-businesses.sql
-- ====================================================================

-- 005 — Link each farm to the business it belongs to.
--
-- STATUS: PROPOSAL. Not run. Additive and reversible.
-- Depends on nothing; 007 depends on this.
--
-- The link goes farm -> business, not the other way round: the business is
-- the workspace, and the farm is what a business of type 'farm' has.
-- (Migration 001 pointed it the wrong way and is superseded.)

begin;

alter table herd.farms
  add column if not exists business_id bigint unique references public.businesses(id);

-- Backfill by name. There is exactly one farm and exactly one business of
-- type 'farm', both called 'Suchomski Family Farm', so this matches one row.
-- Verify before running:
--
--   select id, name from herd.farms;
--   select id, name, type from public.businesses where type = 'farm';
--
-- If either returns more than one row, match them explicitly by id instead
-- of trusting the name.
update herd.farms f
   set business_id = b.id
  from public.businesses b
 where b.type = 'farm'
   and lower(trim(b.name)) = lower(trim(f.name))
   and f.business_id is null;

commit;

-- Left nullable deliberately: a farm with no business yet is a recoverable
-- state, whereas a NOT NULL that fails mid-migration is not. Tighten once
-- 007 is in and verified:
--
--   alter table herd.farms alter column business_id set not null;

-- Check the backfill did what you expect before running 007 — that migration
-- makes access depend on this link, so a farm with a null business_id
-- becomes invisible to everyone:
--
--   select f.name as farm, b.name as business, b.type
--     from herd.farms f
--     left join public.businesses b on b.id = f.business_id;

-- Rollback:
--   alter table herd.farms drop column business_id;


-- ====================================================================
-- 006-business-members.sql
-- ====================================================================

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
