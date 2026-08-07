-- 002 — Link per-animal costs and revenue to the ledger transactions they
--       came from. This is what makes the "Attributed to" column real.
--
-- STATUS: RUN, 2026-08-07. Verified: ledger_transaction_id present on both
-- herd.cost_entries and herd.revenue_entries.
--
-- Depends on: 001 — which is stale. 001 was superseded, and the cross-tenant
-- hole it existed to close is handled instead by the business-as-tenant work
-- in 005/007/010. This was run without it on that basis.
--
-- Nothing writes these columns yet: this unblocks "Attributed to" rather
-- than delivering it.
--
-- Purely additive: two nullable columns and their indexes. Nothing is
-- rewritten, so rollback is clean until the columns are populated.

begin;

alter table herd.cost_entries
  add column if not exists ledger_transaction_id bigint
    references public.ledger_transactions(id) on delete set null;

alter table herd.revenue_entries
  add column if not exists ledger_transaction_id bigint
    references public.ledger_transactions(id) on delete set null;

create index if not exists cost_entries_ledger_txn_idx
  on herd.cost_entries (ledger_transaction_id)
  where ledger_transaction_id is not null;

create index if not exists revenue_entries_ledger_txn_idx
  on herd.revenue_entries (ledger_transaction_id)
  where ledger_transaction_id is not null;

commit;

-- ---------------------------------------------------------------------------
-- Cardinality: one ledger transaction -> many cost entries. That IS the
-- split. A vet bill on a single cow is just the one-row case, so it needs no
-- special handling and no throwaway allocation record.
--
-- herd.cost_allocations already models how a bill is divided
-- (total_amount_cents, basis, scope_type, scope_ref). It keeps that job;
-- this migration only records where the money came from.
--
-- Cents are allocated by the largest-remainder rule so a split always sums
-- to the transaction exactly — see app/src/lib/allocate.ts and its tests.
-- ---------------------------------------------------------------------------

-- Reconciliation check. Should return no rows; anything here is a split
-- that doesn't add up to its transaction.
--
--   select t.id,
--          t.note,
--          round(t.amount * 100)::bigint as txn_cents,
--          sum(c.amount_cents)           as attributed_cents,
--          round(t.amount * 100)::bigint - sum(c.amount_cents) as drift_cents
--     from public.ledger_transactions t
--     join herd.cost_entries c on c.ledger_transaction_id = t.id
--    where c.deleted_at is null
--    group by t.id, t.note, t.amount
--   having sum(c.amount_cents) <> round(t.amount * 100)::bigint;

-- Rollback:
--
--   drop index if exists herd.revenue_entries_ledger_txn_idx;
--   drop index if exists herd.cost_entries_ledger_txn_idx;
--   alter table herd.revenue_entries drop column if exists ledger_transaction_id;
--   alter table herd.cost_entries    drop column if exists ledger_transaction_id;
