# Handoff — running the outstanding migrations with database access

Written at the end of a session that had no network route to Supabase. The
environment has since been given one. This is what the next session needs to
know.

## First, verify the connection

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.supabase.com/v1/projects
echo "token: ${SUPABASE_ACCESS_TOKEN:+set}"
```

`401` means success — the request reached Supabase and was rejected for
lacking auth, which is the proxy getting out of the way. `403` with
`x-deny-reason: host_not_allowed` means the environment's allowlist still
doesn't cover the host, and nothing below will work.

Project ref: `qpthtykkqxpujudyieyr`

SQL runs through the Management API:

```
POST https://api.supabase.com/v1/projects/qpthtykkqxpujudyieyr/database/query
Authorization: Bearer $SUPABASE_ACCESS_TOKEN
{"query": "…"}
```

The token is account-wide and runs as **superuser**. That makes it right for
DDL and wrong for verification: RLS and column privileges don't apply to it,
so any permission check run through it passes regardless of whether the
policy works. Verify from the app, signed in as a real user.

## The plan

`docs/migrations/runbook/` holds the eight outstanding migrations as three
ordered batches. Its README has the full detail; the short version:

1. **Batch A** (008, 013, 004, 005, 006) — additive. New tables, nullable
   columns, backfills. Nothing changes who can see what. Safe to run.

2. **Checkpoint.** Run this and show the owner the output before going on:

   ```sql
   select f.name as farm, f.business_id, b.name as business, b.type
     from herd.farms f
     left join public.businesses b on b.id = f.business_id;
   ```

   Every farm must show a business. 005 backfills `business_id` by matching
   names and assumes the farm is called `Suchomski Family Farm`. If it's
   named anything else the backfill matches zero rows *without error*, and
   007 then makes that farm invisible to everyone including its owner.
   Also confirm every business has at least one member, for the same reason.

3. **Batch B (007) — the owner runs this**, not the agent. It changes what
   every RLS policy in the `herd` schema means, in two statements, and it's
   the one that can lock them out. It should be run from the dashboard with
   the app open in another tab so the herd can be checked immediately after.
   There is no rehearsal backup: `pg_dump` needs raw 5432, which an
   HTTP proxy won't tunnel. The rollback in the file is the live function
   bodies dumped verbatim from `pg_proc`, so it's real, but it's a recovery
   and not a rehearsal.

4. **Batch C** (010, 002).

## Also outstanding

**Inventory drift.** Order 12 reserved 2 gallons before migration 011 made
`reserve_product` decrement inventory, so `batches.reserved` is short by
that much. Now diagnosable directly instead of by asking for query output:

```sql
select b.id, b.product_id, b.quantity, b.reserved,
       coalesce(o.claimed, 0) as claimed_by_open_orders
  from public.inventory_batches b
  left join (
    select oi.batch_id, sum(oi.quantity) as claimed
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.picked_up_date is null and o.cancelled_date is null
     group by oi.batch_id
  ) o on o.batch_id = b.id
 where b.reserved is distinct from coalesce(o.claimed, 0);
```

Confirm the shape of `order_items` first — this query assumes a `batch_id`
on it, which hasn't been verified against the live schema.

**Not built, flagged but never authorized:** breed composition editing,
animal photos via Supabase Storage, archive/soft-delete UI, inline pedigree
editing on the chart.

## Ground rules established in earlier sessions

- The **service_role key must never appear in frontend code** — it bypasses
  RLS entirely. The anon key is public by design and is the only one that
  belongs in the client.
- **Check for an existing function before writing one.** Migration 011
  created a `reserve_product` overload because `CREATE OR REPLACE FUNCTION`
  only replaces on an exact signature match. PostgREST then resolved calls
  to the wrong one: orders were created, inventory untouched, no error.
- **Don't verify permissions from the SQL editor or the Management API.**
  Both run as superuser. A column-privilege or RLS check there is
  meaningless.
- The app works before and after every migration here, falling back where a
  table doesn't exist yet and saying on screen which mode it's in. Nothing
  has to be run on a schedule.
