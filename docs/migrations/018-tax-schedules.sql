-- 018 — The tax vocabulary: which schedule a business files, and which line
-- of it every category lands on.
--
-- STATUS: RUN, 2026-08-07.
-- Depends on: 003 (transaction_types), 004 (business_types).
--
-- Verified after running:
--   business_types -> farm F, rental E, other C
--   tax_categories -> 7+24 farm, 2+15 rental, 3+22 other
--   both category labels in live use map to a line with no edits:
--     'Other farm income' (farm, income)  -> Schedule F line 8
--     'Rents received'    (rental, income)-> Schedule E line 3
--
-- ── Why ───────────────────────────────────────────────────────────────
--
-- ledger_transactions.category is free text. That is fine for keeping books
-- and useless at filing time: nothing says "Feed" belongs on Schedule F line
-- 16, or that this business files an F at all rather than an E.
--
-- The app this replaced had the answer hard-coded in a BIZ_TYPES constant
-- (see project/uploads/_finance_unpacked.txt) with a flat category list per
-- business type. This puts the same idea in the database and adds the line
-- numbers, so a category can be added without a deploy and the mapping is
-- one fact in one place rather than a constant that drifts from the data.
--
-- ── What ──────────────────────────────────────────────────────────────
--
-- business_types gains the schedule it files. tax_categories is the
-- vocabulary: one row per (business type, direction, category), carrying the
-- IRS line it totals into.
--
-- Categories are matched to transactions by label, because that is what
-- ledger_transactions.category already holds. The three labels in use today
-- — 'Rents received', 'Other farm income', 'Feed' — are all seeded below and
-- keep working untouched. A category that matches nothing still appears in
-- the books; it lands under the schedule's "Other" line and is flagged, so
-- unmapped money is visible rather than silently dropped.
--
-- Line numbers follow the current Schedule F, E and C. They are labels, not
-- arithmetic — this file records where a total goes, it does not compute
-- anyone's tax.

begin;

-- ── which schedule each business type files ───────────────────────────

alter table public.business_types
  add column if not exists schedule_code text not null default '',
  add column if not exists schedule_label text not null default '';

update public.business_types set
  schedule_code = 'F',
  schedule_label = 'Schedule F — Profit or Loss From Farming'
 where code = 'farm';

update public.business_types set
  schedule_code = 'E',
  schedule_label = 'Schedule E — Supplemental Income and Loss'
 where code = 'rental';

update public.business_types set
  schedule_code = 'C',
  schedule_label = 'Schedule C — Profit or Loss From Business'
 where code = 'other';

-- ── the category vocabulary ───────────────────────────────────────────

create table if not exists public.tax_categories (
  id            bigint generated always as identity primary key,
  business_type text    not null references public.business_types(code),
  direction     text    not null check (direction in ('income', 'expense')),
  label         text    not null,
  -- The IRS line this category totals into: '16', '21a', '24b'. Text, not a
  -- number, because several lines are lettered.
  schedule_line text    not null default '',
  sort_order    integer not null default 100,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- One row per category per direction per business type. Partial on active so
-- retiring a label doesn't block re-adding it.
create unique index if not exists tax_categories_type_direction_label_uniq
  on public.tax_categories (business_type, direction, lower(label))
  where active;

alter table public.tax_categories enable row level security;

-- Same shape as transaction_types and the other lookup tables: readable by
-- anyone signed in, writable by a farmer. The vocabulary is not per-business
-- data, so there is nothing to scope by business here.
drop policy if exists "tax_categories readable" on public.tax_categories;
create policy "tax_categories readable"
  on public.tax_categories for select
  using (auth.uid() is not null);

drop policy if exists "tax_categories writable by farmer" on public.tax_categories;
create policy "tax_categories writable by farmer"
  on public.tax_categories for all
  using (public.is_farmer())
  with check (public.is_farmer());

grant select, insert, update on public.tax_categories to authenticated, anon;

-- ── seed ──────────────────────────────────────────────────────────────

insert into public.tax_categories (business_type, direction, label, schedule_line, sort_order)
values
  -- Schedule F, Part I — farm income
  ('farm', 'income', 'Sales of purchased livestock',        '1a', 10),
  ('farm', 'income', 'Sales of raised livestock & produce', '2',  20),
  ('farm', 'income', 'Cooperative distributions',           '3a', 30),
  ('farm', 'income', 'Agricultural program payments',       '4a', 40),
  ('farm', 'income', 'Crop insurance proceeds',             '6a', 50),
  ('farm', 'income', 'Custom hire income',                  '7',  60),
  ('farm', 'income', 'Other farm income',                   '8',  70),

  -- Schedule F, Part II — farm expenses
  ('farm', 'expense', 'Car & truck',                   '10',  10),
  ('farm', 'expense', 'Chemicals',                     '11',  20),
  ('farm', 'expense', 'Conservation expenses',         '12',  30),
  ('farm', 'expense', 'Custom hire',                   '13',  40),
  ('farm', 'expense', 'Depreciation & section 179',    '14',  50),
  ('farm', 'expense', 'Employee benefit programs',     '15',  60),
  ('farm', 'expense', 'Feed',                          '16',  70),
  ('farm', 'expense', 'Fertilizers & lime',            '17',  80),
  ('farm', 'expense', 'Freight & trucking',            '18',  90),
  ('farm', 'expense', 'Gasoline, fuel & oil',          '19', 100),
  ('farm', 'expense', 'Insurance',                     '20', 110),
  ('farm', 'expense', 'Mortgage interest',             '21a', 120),
  ('farm', 'expense', 'Other interest',                '21b', 130),
  ('farm', 'expense', 'Labor hired',                   '22', 140),
  ('farm', 'expense', 'Pension & profit-sharing',      '23', 150),
  ('farm', 'expense', 'Rent/lease — machinery',        '24a', 160),
  ('farm', 'expense', 'Rent/lease — land & animals',   '24b', 170),
  ('farm', 'expense', 'Repairs & maintenance',         '25', 180),
  ('farm', 'expense', 'Seeds & plants',                '26', 190),
  ('farm', 'expense', 'Storage & warehousing',         '27', 200),
  ('farm', 'expense', 'Supplies',                      '28', 210),
  ('farm', 'expense', 'Taxes',                         '29', 220),
  ('farm', 'expense', 'Utilities',                     '30', 230),
  ('farm', 'expense', 'Veterinary, breeding & medicine', '31', 240),
  ('farm', 'expense', 'Other expenses',                '32', 250),

  -- Schedule E — rental income and expenses
  ('rental', 'income', 'Rents received',     '3', 10),
  ('rental', 'income', 'Royalties received', '4', 20),

  ('rental', 'expense', 'Advertising',              '5',  10),
  ('rental', 'expense', 'Auto & travel',            '6',  20),
  ('rental', 'expense', 'Cleaning & maintenance',   '7',  30),
  ('rental', 'expense', 'Commissions',              '8',  40),
  ('rental', 'expense', 'Insurance',                '9',  50),
  ('rental', 'expense', 'Legal & professional fees','10', 60),
  ('rental', 'expense', 'Management fees',          '11', 70),
  ('rental', 'expense', 'Mortgage interest',        '12', 80),
  ('rental', 'expense', 'Other interest',           '13', 90),
  ('rental', 'expense', 'Repairs',                  '14', 100),
  ('rental', 'expense', 'Supplies',                 '15', 110),
  ('rental', 'expense', 'Taxes',                    '16', 120),
  ('rental', 'expense', 'Utilities',                '17', 130),
  ('rental', 'expense', 'Depreciation',             '18', 140),
  ('rental', 'expense', 'Other expenses',           '19', 150),

  -- Schedule C — other business
  ('other', 'income', 'Gross receipts or sales', '1', 10),
  ('other', 'income', 'Commissions & fees',      '1', 20),
  ('other', 'income', 'Other income',            '6', 30),

  ('other', 'expense', 'Advertising',                '8',   10),
  ('other', 'expense', 'Car & truck',                '9',   20),
  ('other', 'expense', 'Commissions & fees',         '10',  30),
  ('other', 'expense', 'Contract labor',             '11',  40),
  ('other', 'expense', 'Depreciation & section 179', '13',  50),
  ('other', 'expense', 'Employee benefit programs',  '14',  60),
  ('other', 'expense', 'Insurance',                  '15',  70),
  ('other', 'expense', 'Mortgage interest',          '16a', 80),
  ('other', 'expense', 'Other interest',             '16b', 90),
  ('other', 'expense', 'Legal & professional',       '17', 100),
  ('other', 'expense', 'Office expense',             '18', 110),
  ('other', 'expense', 'Pension & profit-sharing',   '19', 120),
  ('other', 'expense', 'Rent/lease — equipment',     '20a', 130),
  ('other', 'expense', 'Rent/lease — property',      '20b', 140),
  ('other', 'expense', 'Repairs & maintenance',      '21', 150),
  ('other', 'expense', 'Supplies',                   '22', 160),
  ('other', 'expense', 'Taxes & licenses',           '23', 170),
  ('other', 'expense', 'Travel',                     '24a', 180),
  ('other', 'expense', 'Deductible meals',           '24b', 190),
  ('other', 'expense', 'Utilities',                  '25', 200),
  ('other', 'expense', 'Wages',                      '26', 210),
  ('other', 'expense', 'Other expenses',             '27a', 220)
on conflict do nothing;

commit;

-- Verify after running:
--
--   select code, schedule_code from public.business_types order by code;
--   -- farm F, other C, rental E
--
--   select business_type, direction, count(*)
--     from public.tax_categories group by 1,2 order by 1,2;
--
--   -- every category already in use maps to a line
--   select distinct t.category, tc.schedule_line
--     from public.ledger_transactions t
--     join public.businesses b on b.id = t.business_id
--     left join public.tax_categories tc
--       on tc.business_type = b.type and tc.direction = t.type
--      and lower(tc.label) = lower(t.category)
--    order by 1;
--
-- Rollback:
--   drop table if exists public.tax_categories;
--   alter table public.business_types
--     drop column if exists schedule_code,
--     drop column if exists schedule_label;
