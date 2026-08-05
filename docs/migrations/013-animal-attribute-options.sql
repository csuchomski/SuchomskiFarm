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
