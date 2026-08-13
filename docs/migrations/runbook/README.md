# Runbook — running the outstanding migrations

**State as of 2026-08-06, checked against the live database.**

| Batch | Migrations | Status |
|---|---|---|
| A | 008, 013, 004, 005, 006 | **Applied.** Both checkpoints below pass. |
| B | 007 | **Not run.** Next. Yours to run — see below. |
| C | 010, 002 | **Not run.** After B. |

Batch A was already in place when the database was first reachable — every
table, column and lookup row it creates exists, and `is_business_member`
(created by 010, in Batch C) does not, so nothing from a later batch has
leaked in ahead of it. The two checkpoint queries were run and both pass;
their output is recorded in `batch-B-membership.sql`.

One gap Batch A left open, harmless and worth closing by hand: product 5
(`Cheese`) has no `type_code`. 008's backfill leaves anything it cannot place
confidently as null rather than guessing, which is why it is visible. `other`
is the right code — typing it `milk` would fold cheese into milk production
totals, the exact failure 008 was written to prevent.

```sql
update public.products set type_code = 'other' where id = 5;
```

---

Three pastes into the Supabase SQL editor, with a checkpoint between each.
The files in this folder are the individual migrations concatenated in
dependency order; every migration carries its own `begin`/`commit`, so a
failure rolls back only that one and leaves the earlier ones committed.

The SQL editor runs as superuser. That is fine for the DDL and wrong for
the verification — RLS and column privileges do not apply to superuser, so
a permission check run here passes regardless. Verify from the app, signed
in as yourself.

---

## Batch A — additive (008, 013, 004, 005, 006) — applied

`batch-A-additive.sql`

Nothing here changes who can see what. New tables, new nullable columns,
backfills. Safe to run in one go. Every migration in it is idempotent
(`if not exists`, `on conflict do nothing`), so re-running it is a no-op
rather than a hazard.

### Checkpoint — do not skip, 007 depends on it

Both of these were run on 2026-08-06 and passed. Run them again anyway
immediately before Batch B — they are cheap, and they are checking the one
thing that decides whether 007 locks you out.

```sql
select f.name as farm, f.business_id, b.name as business, b.type
  from herd.farms f
  left join public.businesses b on b.id = f.business_id;
```

**Every farm must show a business.** 005 backfills by matching names, and
the farm is only assumed to be called `Suchomski Family Farm` — if the row
in `herd.farms` is named anything else, the match finds nothing, the column
stays null, and 007 makes that farm invisible to everyone including you.
If `business_id` is null, set it by hand before going further:

```sql
update herd.farms set business_id = <business id> where id = '<farm id>';
```

Then confirm the business has members, for the same reason:

```sql
select b.name, count(m.user_id) as members
  from public.businesses b
  left join public.business_members m on m.business_id = b.id
 group by b.name;
```

A business with zero members is a business nobody can read after 007.

---

## Batch B — membership (007) — **high risk, run alone**

`batch-B-membership.sql`

Two `create or replace function` statements that change what every RLS
policy in the `herd` schema means, at once. This is the one that can lock
you out of your own data.

Before running it:

1. Restore a backup somewhere else and run this batch there — an actual
   restore you then queried, not a backup that merely exists. **Still not
   done.** `pg_dump` needs raw 5432 and the agent only has an HTTP route, so
   this one has to come from you or from the dashboard's own backups.
2. Pass the Batch A checkpoint above. ✅ passed 2026-08-06.
3. Look at the roles in `business_members`. After this, they govern the
   whole `herd` schema, and only `owner`, `helper`, and `vet` can write.
   ✅ checked — one member, `owner`, the same user as in `farm_members`.

Points 2 and 3 are the ones that decide whether you get locked out, and both
now check out against live data. What remains unmet is the rehearsal, so the
risk left is "this specific SQL misbehaves", not "the data doesn't support
it".

After running it, verify **from the app, signed in as yourself** — not
here, and not through the Management API. Both run as superuser and bypass
RLS entirely, so they will report success whether or not the policy works.
Open the Animals page and expect 4 animals. If the herd is empty, the link
or the membership is wrong; the rollback is at the bottom of the file, and
it's the live function bodies dumped verbatim from `pg_proc` (re-dumped
2026-08-06, including the `set search_path` clause an earlier copy of it had
dropped), so it restores exactly what was there.

---

## Batch C — scoping (010, 002)

`batch-C-scoping.sql`

010 retires the global farmer flag in favour of business membership; it
needs 006 (Batch A) and 009 (already run). 002 adds the books↔herd link.

Checked 2026-08-06: all five policies 010 renames via `alter policy` exist
under exactly the names it uses — `farmer manages products`, `farmer manages
batches`, `read own orders or farmer reads all`, `farmer updates orders`,
`insert own orders or farmer`. A name that didn't match would abort the
transaction rather than half-apply, but it's better to know first.

Verify from the app: the store should still list products and still let a
buyer reserve. Then, per 010's own note, the check that actually proves the
point — a second account with `role = 'farmer'` that is *not* a member of
business 5 should see nothing.

---

## If something goes wrong

Each migration's rollback is in the comments at the end of its own section.
They undo one migration, not the batch — work backwards through them in
reverse order.

## What the app does meanwhile

It works before and after all of these, and says on screen which mode it's
in. Nothing here has to be run on a schedule, and nothing is more urgent
than doing it carefully.
