# Runbook — running the eight outstanding migrations

Three pastes into the Supabase SQL editor, with a checkpoint between each.
The files in this folder are the individual migrations concatenated in
dependency order; every migration carries its own `begin`/`commit`, so a
failure rolls back only that one and leaves the earlier ones committed.

The SQL editor runs as superuser. That is fine for the DDL and wrong for
the verification — RLS and column privileges do not apply to superuser, so
a permission check run here passes regardless. Verify from the app, signed
in as yourself.

---

## Batch A — additive (008, 013, 004, 005, 006)

`batch-A-additive.sql`

Nothing here changes who can see what. New tables, new nullable columns,
backfills. Safe to run in one go.

### Checkpoint — do not skip, 007 depends on it

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
   restore you then queried, not a backup that merely exists.
2. Pass the Batch A checkpoint above.
3. Look at the roles in `business_members`. After this, they govern the
   whole `herd` schema, and only `owner`, `helper`, and `vet` can write.

After running it, verify **from the app, signed in as yourself** — not
here. Open the Animals page. If the herd is empty, the link or the
membership is wrong; the rollback is at the bottom of the file, and it's
the live function bodies dumped verbatim from `pg_proc`, so it restores
exactly what was there.

---

## Batch C — scoping (010, 002)

`batch-C-scoping.sql`

010 retires the global farmer flag in favour of business membership; it
needs 006 (Batch A) and 009 (already run). 002 adds the books↔herd link.

Verify from the app: the store should still list products and still let a
buyer reserve.

---

## If something goes wrong

Each migration's rollback is in the comments at the end of its own section.
They undo one migration, not the batch — work backwards through them in
reverse order.

## What the app does meanwhile

It works before and after all of these, and says on screen which mode it's
in. Nothing here has to be run on a schedule, and nothing is more urgent
than doing it carefully.
