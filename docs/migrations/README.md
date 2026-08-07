# Migrations

They're written to be read before executing — each carries its own
verification queries and rollback.

Run status below is what the database actually reports, not what was
intended. 004–007 were run at some point without this file being updated,
which is worth knowing before trusting any "not run" here: check the
database, don't take the table's word for it.

## Order

| # | What | Risk | Notes |
|---|---|---|---|
| 008 | Product types | Low | Small, isolated, immediately visible on the dashboard. |
| 002 | Link books to per-animal costs | Low | Additive. Makes "Attributed to" possible. |
| ~~001~~ | ~~`businesses.farm_id`~~ | — | **Superseded.** Pointed the link the wrong way; see `../business-as-tenant.md`. |
| ~~003~~ | ~~Transaction types~~ | — | **Already run.** |
| ~~004~~ | ~~Business types and modules~~ | — | **Already run.** `business_type_modules` is populated for all three types. |
| ~~005~~ | ~~`herd.farms.business_id`~~ | — | **Already run.** The farm is linked to business 5. |
| ~~006~~ | ~~`business_members`~~ | — | **Already run — its policies are broken; see 014.** |
| ~~007~~ | ~~Membership answers via business~~ | — | **Already run.** |
| ~~009~~ | ~~Customer access~~ | — | **Already run.** |
| ~~011~~ | ~~Reserve against inventory~~ | — | **Already run — superseded by 012.** |
| ~~010~~ | ~~Scope the store to a business~~ | — | **Already run, 2026-08-06.** See "a policy change can break writes" below. |
| ~~012~~ | ~~Drop the duplicate `reserve_product`~~ | — | **Already run, 2026-08-06 — was a no-op.** The duplicate was already absent. |
| ~~014~~ | ~~Fix `business_members` policy recursion~~ | — | **Already run, 2026-08-06.** Unblocked the business switcher. |
| ~~015~~ | ~~Lactation constraints~~ | — | **Already run, 2026-08-06.** Check constraint validated; rejections verified. |
| ~~016~~ | ~~Genetics uniqueness + unsavable options~~ | — | **Already run, 2026-08-07.** One result per animal per marker/condition. Also retired two dropdown options (`origin 'born_here'`, `status 'dead'`) that the `animals` check constraints always rejected. |
| ~~019~~ | ~~Standing weekly orders~~ | — | **Already run, 2026-08-07.** Scopes `schedules` to a business, adds `cancelled_at`, narrows the stock hold from 7 days to 3, and fixes `complete_scheduled_pickup` leaving its order unscoped — the same bug as 017. Also relaxes `check_schedule_capacity`, which refused any subscription the current day's stock couldn't cover. |
| ~~017~~ | ~~`reserve_product` sets `business_id`~~ | — | **Already run, 2026-08-07.** Every order the function created got `business_id` null, and `is_business_member(null)` is false — so any order placed after 010 was invisible to the farmer. Another instance of "a policy change can break writes" below. |

## A policy change can break writes, not just reads

010 replaced `is_farmer()` with `is_business_member(business_id)` on
products, inventory_batches and orders. The read side was verified easily —
same row counts before and after, for an owner and for a buyer.

The write side changed silently. `with check (is_business_member(business_id))`
rejects any insert that leaves `business_id` null, because
`is_business_member(null)` is false. Adding a batch failed with:

```
new row violates row-level security policy for table "inventory_batches"
```

Reading a table after a policy change tells you nothing about writing to it.
Rehearse an insert too, and remember that a backfilled column only covers
rows that already exist — new ones need the application to start sending it.

## A policy on a table must not query that table

006 tested membership with a plain `exists` against `business_members` from
inside a policy *on* `business_members`, reasoning that a helper function
would recurse. It's the other way round: the self-referential `exists` is
the recursion, because evaluating the policy reads the table and reading the
table evaluates the policy. Postgres raises `42P17` and every select fails.

A `security definer` function is what breaks the cycle — its body runs with
RLS bypassed, so it never re-enters the policy. 014 does that.

Two things that make this hard to spot:

- A `for all` policy covers `select` too, so fixing only the select policy
  leaves the recursion in place.
- The error text contains the word "relation", which client code checking
  for a missing table can easily mistake for one. That's precisely what
  happened — see `missingRelation` in `app/src/lib/workspace.tsx`.

## Check for an existing function before writing one

011 added `reserve_product(bigint, numeric)` without checking. The name was
already taken by `reserve_product(bigint, numeric, uuid)`, which does the
same job and also respects stock held for weekly schedules.

`CREATE OR REPLACE FUNCTION` only replaces when the *entire* signature
matches, so a different argument count silently creates an overload instead
of erroring. PostgREST then had two candidates and resolved `rpc()` calls to
the wrong one — reserving created an order, left inventory untouched, and
reported no error. 012 removes the duplicate.

Before adding any function:

```sql
select p.oid::regprocedure as signature
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = '<name>';
```

## Why 009 first

`is_farmer()` is:

```sql
select exists (select 1 from profiles where id = auth.uid() and role = 'farmer')
```

and `profiles`' update policy is `USING (auth.uid() = id)` with **no
`WITH CHECK`**. `USING` decides which rows may be updated; `WITH CHECK`
decides what they may become. Without the second, any signed-in account can
run:

```sql
update profiles set role = 'farmer' where id = auth.uid();
```

and inherit the `ALL` policies on `products` and `inventory_batches` plus read
access to every order. This is true of the database as it stands, not
something the app changes. 009 adds the missing `WITH CHECK`.

## Before 007

It's the only migration here that can lock you out of your own data — two
`create or replace function` statements that change the meaning of every RLS
policy in the `herd` schema at once.

The live function bodies **have** now been dumped, and doing so caught two
errors in the first draft of 007, both of which are worth knowing about
because they generalise:

- The parameter is named `f`. `CREATE OR REPLACE FUNCTION` refuses to change
  a parameter name, so a rewrite using anything else fails outright — loud,
  harmless.
- `can_write_farm` allows `('owner', 'helper', 'vet')`, not the
  `('owner', 'admin', 'manager')` that looks plausible. That one is quiet:
  it would have removed write access from every helper and vet while
  appearing to succeed.

Still worth doing before you run it:

1. Restore a backup elsewhere and run it there. An actual restore you queried
   afterwards, not a backup that exists.
2. Run 005's and 006's check queries — a farm with no `business_id`, or a
   business with no members, becomes invisible to everyone the moment 007
   lands.
3. Look at the roles in `business_members`. After 007 they govern the entire
   `herd` schema, and only `owner`/`helper`/`vet` can write.

## What the app does meanwhile

It works before and after all of these. Where a table doesn't exist yet it
falls back — built-in transaction types, name-matching for milk, farm-based
membership — and says on screen which mode it's in rather than leaving it
invisible. Nothing here has to be run on a schedule.
