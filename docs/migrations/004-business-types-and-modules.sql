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
