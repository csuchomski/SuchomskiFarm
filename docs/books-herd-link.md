# Connecting the books to per-animal costs

**Status: proposal. Nothing here has been run.** This is a schema change to a
live database with real data — read it, decide, and run it yourself.

## The problem

The mockup's Books screen has an **Attributed to** column: a vet bill lands on
one ear tag, a feed invoice splits across the herd. That's the feature that
makes cost-per-head real rather than estimated.

Today there is no link between the two systems:

| | `public.ledger_transactions` | `herd.cost_entries` / `revenue_entries` |
|---|---|---|
| Key | `id bigint` | `id uuid` |
| Money | `amount numeric` (dollars) | `amount_cents bigint` (cents) |
| Scoped by | `business_id bigint` | `farm_id uuid` |
| Per animal? | no | yes (`animal_id uuid`) |

The obvious candidate doesn't work: `cost_entries.source_ref_id` is a `uuid`,
so it **cannot** point at a `bigint` ledger transaction id.

## What already exists (don't rebuild it)

`herd.cost_allocations` already models "one bill split many ways" —
`total_amount_cents`, `basis`, `scope_type`, `scope_ref`, `period_start/end`,
and `cost_entries.allocation_id` pointing back at it. That is exactly the
"split evenly across 41 head vs. weight by production" decision the mockup
asks about. The splitting mechanism is built; only the link to the books is
missing.

## Recommended: one link column on the per-animal tables

Put the link where the per-animal money already lives. Every cost/revenue row
records which ledger transaction it came from, whether or not an allocation
produced it.

```sql
alter table herd.cost_entries
  add column ledger_transaction_id bigint
    references public.ledger_transactions(id) on delete set null;

alter table herd.revenue_entries
  add column ledger_transaction_id bigint
    references public.ledger_transactions(id) on delete set null;

create index on herd.cost_entries (ledger_transaction_id);
create index on herd.revenue_entries (ledger_transaction_id);
```

Cardinality: one transaction → many cost entries (that *is* the split). A
single-animal vet bill is just the one-row case, so it needs no special
handling and no throwaway allocation record.

The checkable invariant: for any attributed transaction, the per-animal rows
should sum to the transaction total.

```sql
-- Should return no rows. Anything here is a split that doesn't reconcile.
select t.id, t.note,
       round(t.amount * 100)          as txn_cents,
       sum(c.amount_cents)            as attributed_cents
from public.ledger_transactions t
join herd.cost_entries c on c.ledger_transaction_id = t.id
where c.deleted_at is null
group by t.id, t.note, t.amount
having sum(c.amount_cents) <> round(t.amount * 100);
```

### Alternative considered: link the allocation instead

Putting `ledger_transaction_id` on `cost_allocations` only is tidier for
splits but forces every single-animal cost through a one-animal allocation,
which is heavyweight for "Excede, $178, Hazel." Putting it on *both* allows
an entry and its allocation to disagree about which transaction they came
from, with no cheap constraint to prevent it. Hence: one column, on the
per-animal tables.

## The SQL

Both migrations are in [`migrations/`](./migrations/), unrun:

- `001-farm-scope-public-schema.sql` — adds `businesses.farm_id` and RLS on
  the ledger tables. **Read its warnings**: enabling RLS on tables that have
  none today will break any app currently reading them anonymously.
- `002-link-books-to-herd.sql` — the link columns themselves. Purely
  additive.

## Three things to decide before running it

**1. Tenancy hole — being fixed first.** `public.businesses` has no `farm_id`.
The herd schema is multi-tenant (every table carries `farm_id`, every RLS
policy checks `is_farm_member(farm_id)`); the ledger side is not scoped to a
farm at all. Linking them lets a per-animal cost row on farm A reference a
transaction belonging to a business that no farm owns. With one farm today
this is invisible; it becomes a real leak the moment there are two. Migration
001 closes it.

While writing that: **the wider finding is that `public` may have no RLS at
all.** Reads of `products`, `orders`, `ledger_transactions` and `profiles` all
returned rows through the anon key, which wouldn't happen if RLS were on
without policies. If that's right, `public.profiles` — names, emails, phone
numbers — is readable by anyone who opens devtools on the deployed site, since
the anon key ships in the bundle by design. Migration 001 covers the ledger
tables; `profiles` and `orders` need a customer-access decision before they
can be locked down, and that's the higher-priority half.

**2. Rounding — decided.** Largest remainder: everyone gets their floored
share, then leftover cents go out one at a time, largest fractional remainder
first, ties broken by the caller's (stable) ordering. So $612 across 41 head
is 28 animals at 1493¢ and 13 at 1492¢ — exactly $612.00, no cent invented or
lost, and the same input always splits the same way.

Implemented in [`app/src/lib/allocate.ts`](../app/src/lib/allocate.ts) with
tests covering the reconciliation invariant across every herd size 1–60 and a
range of amounts, plus refunds, zero-weight herds, and empty input. `npm test`
in `app/`.

**3. Write access.** The RLS policies shared so far cover only the `herd`
schema. Whether the app can write `public.ledger_transactions` at all is
still unknown — the inventory-batch insert on Store · Products is the live
test of that.

## Rollback

```sql
alter table herd.cost_entries    drop column ledger_transaction_id;
alter table herd.revenue_entries drop column ledger_transaction_id;
```

Additive change, no data rewritten, so rollback is clean as long as nothing
has been written into the new columns yet.
