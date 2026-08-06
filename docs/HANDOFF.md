# Handoff — running the outstanding migrations with database access

Written at the end of a session that had no network route to Supabase. The
environment has since been given one. This is what the next session needs to
know.

> **Picked up 2026-08-06.** The route works and the token authenticates.
> Findings from that session are folded in below; the sections it settled are
> marked. Short version: Batch A turned out to be already applied and its
> checkpoints pass, 007 is next and is the owner's to run, and the inventory
> drift was larger and differently shaped than this note assumed — fixed in
> migration 014.
>
> One practical note for whoever is next: the Management API sits behind
> Cloudflare, which rejects a bare Python `urllib` request with `403 error
> code: 1010` while accepting the identical request from `curl`. That's a
> client-signature block, not an auth or allowlist problem, and it looks
> alarmingly like the `host_not_allowed` failure described below. Use `curl`.

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
   **✅ Already applied** — found in place on 2026-08-06. Every object it
   creates exists; `is_business_member` (from 010, a later batch) does not,
   so no later batch has run ahead of it.

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

   **✅ Both pass.** The farm is in fact named `Suchomski Family Farm` and
   links to business 5; all three businesses have one member each. The
   membership carries across with the same role — user
   `c3bec7a2-9b0d-4ec6-8994-accd67660e1f` is `owner` in both
   `herd.farm_members` and `public.business_members`, and `owner` is in
   007's write list. Full output is recorded at the top of
   `docs/migrations/runbook/batch-B-membership.sql`.

3. **Batch B (007) — the owner runs this**, not the agent. Confirmed again
   on 2026-08-06: asked, and the answer was still the dashboard. It changes what
   every RLS policy in the `herd` schema means, in two statements, and it's
   the one that can lock them out. It should be run from the dashboard with
   the app open in another tab so the herd can be checked immediately after.
   There is no rehearsal backup: `pg_dump` needs raw 5432, which an
   HTTP proxy won't tunnel. The rollback in the file is the live function
   bodies dumped verbatim from `pg_proc`, so it's real, but it's a recovery
   and not a rehearsal.

4. **Batch C** (010, 002).

## Also outstanding

**Inventory drift. ✅ Diagnosed and fixed 2026-08-06 — migration 014.**

The note above was wrong in three ways, all of which came from guessing at a
schema instead of reading it. Recorded because the shape of the mistake is
more useful than the fix:

- **There is no `order_items` table.** An order carries a single
  `product_id` and `quantity`. Batches are allocated inside
  `reserve_product` and never recorded per line, so there is no
  `batch_id` anywhere to join on and no way to attribute a reservation to a
  batch after the fact. The query above cannot run at all.
- **The drift was 5 gallons, not 2.** Orders 12 (2 gal) *and* 14 (3 gal)
  both predate the fix; only order 15 reserved correctly.
- **It is only visible per product**, not per batch — which is why the
  per-batch query would have found nothing even had it parsed.

Consequence while it was live: `quantity - reserved` reported 6 gallons of
milk available when 1 was, so the store would have sold five gallons twice.

The check that does work:

```sql
select p.id, p.name,
       coalesce(b.reserved_total, 0) as batches_reserved,
       coalesce(o.open_qty, 0)       as open_order_qty
  from public.products p
  left join (select product_id, sum(reserved) reserved_total
               from public.inventory_batches group by product_id) b
         on b.product_id = p.id
  left join (select product_id, sum(quantity) open_qty
               from public.orders
              where picked_up_date is null and cancelled_date is null
              group by product_id) o
         on o.product_id = p.id
 where coalesce(b.reserved_total, 0) <> coalesce(o.open_qty, 0);
```

No rows is correct. It returns none as of 2026-08-06.

**Worth knowing:** nothing in the schema enforces this invariant — it is
reconciled, not guaranteed. `reserve_product` is the only thing that keeps
`reserved` in step with `orders`, and any path that writes one without the
other reopens the gap silently. A constraint can't express it (it spans two
tables), so it wants either a trigger or this query run periodically.

**Untyped product.** Product 5 (`Cheese`) has a null `type_code`. 008's
backfill leaves what it can't place confidently as null rather than guessing,
which is why it's visible rather than wrong. `other` is the right code —
`milk` would fold cheese into milk production totals, the exact failure 008
exists to prevent. One statement, in the runbook README, left for the owner
because it's a naming judgement and not a correctness fix.

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
- **A rollback copied by hand is not verbatim.** 007's rollback block was
  labelled "dumped from `pg_proc`, verbatim" and had lost the
  `set search_path` clause both functions carry. On a `SECURITY DEFINER`
  function that clause is a security control, so running it would have
  restored the functions quietly weakened — and it would have looked like a
  clean recovery. Re-dumped and corrected 2026-08-06. When a file claims to
  quote the database, diff it against the database.
- **Don't guess a schema you can now read.** Every error in the inventory
  section below came from describing tables from memory rather than
  querying them. The route exists now; use it.
- The app works before and after every migration here, falling back where a
  table doesn't exist yet and saying on screen which mode it's in. Nothing
  has to be run on a schedule.
