# Migrations

None of these have been run. They're written to be read before executing —
each carries its own verification queries and rollback.

## Order

| # | What | Risk | Notes |
|---|---|---|---|
| **009** | Customer access + privilege-escalation fix | Low | **Run first.** Closes a live hole; unblocks the storefront. |
| 008 | Product types | Low | Small, isolated, immediately visible on the dashboard. |
| 004 | Business types and modules | Low | Additive. Seeded to match existing `type` values. |
| 005 | `herd.farms.business_id` | Low | Additive. Backfilled by name. |
| 006 | `business_members` | Low | Additive. Carries farm membership across. |
| **007** | Membership answers via business | **High** | Changes what 41 tables mean in two statements. Rehearse on a restored backup. |
| 010 | Scope the store to a business | Medium | Retires the global farmer flag. Needs 006 and 009. |
| 002 | Link books to per-animal costs | Low | Additive. Makes "Attributed to" possible. |
| ~~001~~ | ~~`businesses.farm_id`~~ | — | **Superseded.** Pointed the link the wrong way; see `../business-as-tenant.md`. |
| ~~003~~ | ~~Transaction types~~ | — | **Already run.** |

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

1. Dump the current function bodies and keep the output. **That** is the
   authoritative rollback; the one written into 007 is reconstructed from
   observed behaviour, not copied.
   ```sql
   select proname, prosrc from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'herd'
      and proname in ('is_farm_member', 'can_write_farm');
   ```
2. Restore a backup elsewhere and run it there. An actual restore you queried
   afterwards, not a backup that exists.
3. Run 005's and 006's check queries — a farm with no `business_id`, or a
   business with no members, becomes invisible to everyone the moment 007
   lands.

## What the app does meanwhile

It works before and after all of these. Where a table doesn't exist yet it
falls back — built-in transaction types, name-matching for milk, farm-based
membership — and says on screen which mode it's in rather than leaving it
invisible. Nothing here has to be run on a schedule.
