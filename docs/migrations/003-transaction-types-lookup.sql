-- 003 — Make transaction types data instead of code.
--
-- STATUS: PROPOSAL. Not run. Independent of 001 and 002 — safe in any order.
--
-- Why: `ledger_transactions.type` is free text, so the app has to guess
-- whether a row is income or an expense, and guessing wrong produces a Net
-- figure that looks authoritative and isn't.
--
-- A CHECK constraint would fix that but needs a migration every time a new
-- type is wanted. This keeps types addable on the fly: a new type is a new
-- row, no migration and no code change, because the app reads `direction`
-- from the table rather than pattern-matching the name.
--
-- `direction` is itself constrained, and deliberately: money comes in, goes
-- out, or moves sideways. That set is genuinely closed even though the type
-- vocabulary on top of it isn't.

begin;

create table if not exists public.transaction_types (
  code        text primary key,
  label       text        not null,
  direction   text        not null check (direction in ('income', 'expense', 'neutral')),
  active      boolean     not null default true,
  sort_order  integer     not null default 100,
  created_at  timestamptz not null default now()
);

comment on column public.transaction_types.direction is
  'How this type moves the books. neutral = neither income nor expense '
  '(an account transfer), so it is excluded from Net rather than counted.';

insert into public.transaction_types (code, label, direction, sort_order) values
  ('income',   'Income',   'income',   10),
  ('expense',  'Expense',  'expense',  20),
  ('transfer', 'Transfer', 'neutral',  30)
on conflict (code) do nothing;

-- Every existing row is 'income' (verified: select type, count(*) ... -> income | 3),
-- so this FK validates without normalising anything first. Re-check before
-- running if time has passed; a stray value would abort the ALTER harmlessly,
-- but you'd want to know why.
alter table public.ledger_transactions
  add constraint ledger_transactions_type_fkey
  foreign key (type) references public.transaction_types(code);

-- Reference data, not farm data: shared vocabulary across every business.
-- Readable by anyone signed in, editable by anyone signed in — matching the
-- "add types on the fly" requirement. Tighten to owners if bookkeepers
-- shouldn't be inventing categories.
alter table public.transaction_types enable row level security;

create policy transaction_types_select on public.transaction_types
  for select to authenticated using (true);

create policy transaction_types_write on public.transaction_types
  for all to authenticated using (true) with check (true);

commit;

-- ---------------------------------------------------------------------------
-- Retiring a type: set active = false rather than deleting it. The FK will
-- refuse a delete while transactions still reference it, which is the
-- correct behaviour — history shouldn't change because a type fell out of
-- use. Inactive types stay out of the picker but keep rendering on old rows.
--
--   update public.transaction_types set active = false where code = 'transfer';
-- ---------------------------------------------------------------------------

-- Rollback:
--
--   alter table public.ledger_transactions
--     drop constraint ledger_transactions_type_fkey;
--   drop table public.transaction_types;
