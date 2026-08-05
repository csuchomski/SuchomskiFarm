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
