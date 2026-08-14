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
| ~~008~~ | ~~Product types~~ | — | **Already run** — discovered 2026-08-07, not by this file. `product_types` holds all six seeded rows, `products.type_code` exists with its foreign key, and the backfill has typed 3 of 4 products (the fourth was left null by the conservative backfill, as designed). This table said "not run" for weeks; see the warning above. |
| ~~002~~ | ~~Link books to per-animal costs~~ | — | **Already run, 2026-08-07.** Two nullable columns and their indexes on `herd.cost_entries` and `herd.revenue_entries`. Its stated dependency on 001 is moot: 001 was superseded, and the cross-tenant hole it guarded is closed by the business-as-tenant work in 005/007/010. |
| ~~020~~ | ~~Scope discards to a business~~ | — | **Already run, 2026-08-07.** The one store table 010 missed. Also fixes `discard_inventory` inserting rows with no `business_id` — the third instance of that bug, after 017 and 019. |
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
| ~~021~~ | ~~`herd.record_production` scopes its batches~~ | — | **Already run, 2026-08-07.** The fourth instance of the unscoped-insert bug — and the first found by a query rather than by reading a function body. See below. |
| ~~046~~ | ~~The P4/P5 fence~~ | — | **Already run, 2026-08-14.** The owner marked the line on a screenshot. 040 cut the units apart with straight lines, and the one dividing P3/P5 from P4 was a single horizontal; east of P3 the real boundary runs ten feet lower, and the gap had become a 10 ft × 370 ft ribbon of Paddock 4 tucked under Paddock 5. Not cosmetic: P4 is swept west to east, so the ribbon was its **eastern hundred feet**, and it was the whole of the 1,505% taper found when the strip arithmetic was fixed. P4 2.261→2.227 ac (607→507 ft), P5 1.381→1.416 (405→416); the five still sum to 9.568, the perimeter exactly. Also **rescales the seven grazing events on those two units**, because both sweeps change length and a fraction would otherwise point at different ground — exact, since distance along the sweep is linear in the fraction. Rehearsed rolled-back first, which caught an ambiguous `rev` in `update ... from`. |
| ~~045~~ | ~~The height they graze down to~~ | — | **Already run, 2026-08-14.** `grazing_plans.target_residual_height_in`, and `save_grazing_plan` at sixteen arguments with the fifteen dropped. The point is not the column but what it displaces: a *utilization percentage* nobody sets or measures, replaced by the graze-down a grazier actually decides — in at eight inches, off at four. Utilization becomes the **outcome** of the two heights, fed back where the typed figure used to go, so every calculation downstream is correct without changing, and there is no second path for the two to disagree on or to discount twice. Verified as `authenticated` in a rolled-back transaction; one check had to be rewritten rather than believed, because reading the column back inside the statement that wrote it returns the pre-statement snapshot. |
| ~~044~~ | ~~The redrawn perimeter~~ | — | **Already run, 2026-08-13.** The 08-13b KML's perimeter, and the five units re-cut from it: 2.021, 1.932, 1.972, 2.261, 1.381 acres, summing to 9.568 — the perimeter exactly. Only the perimeter changed; all four interior fence paths are byte-identical to 040's, and no vertex moved more than 2.4 ft. Held back until it could go in with the acreage fix, because reloading boundaries re-prices ground already grazed and doing it twice in a week would move the farm's numbers under it for no reason. |
| ~~043~~ | ~~Weights, rotation order, sward height~~ | — | **Already run, 2026-08-13.** `herd.record_weight()` upserting on (animal, date) so a correction on the day replaces rather than duplicates; `paddocks.rotation_order` with a partial unique index, seeded 1–5; `grazing_plans.lb_dm_per_acre_inch`, the farm's 300. Replaces `save_grazing_plan` at a **15-argument** signature and drops the 14 — `CREATE OR REPLACE` only replaces on an exact match, so the old one would have survived alongside it. `weight_type` defaults to `adhoc`: the check constraint allows birth/weaning/yearling/sale/processing_live/adhoc, and `scale` is not among them. |
| ~~036–042~~ | ~~The grazing module~~ | — | **All run.** Documented in `../GRAZING.md` rather than here, since each one is a step of one design. 040 loaded the farm's boundaries, 041 the private photo bucket, 042 the plan-write RPCs. |
| ~~035~~ | ~~Economic herd depreciation~~ | — | **Already run, 2026-08-10.** `herd.animal_valuations` — the raised-breeding-stock inventory value, marked and rolled, as dated rows rather than a field that gets overwritten — plus `herd.mark_herd_values()` and `herd.record_valuation()`. The management computation, `(replacement − cull) ÷ productive lifetime`, deliberately knowing nothing about MACRS, conventions or §1245 recapture: tax depreciation exists only where there is basis, and a heifer raised on a cash-basis Schedule F has none. Value declines with *time since she entered production*, not lactations counted — a cow one day fresh has not lost a year — and is floored at cull value, which is what makes it a value rather than a straight line to zero. Dairy females only; every assumption is a dairy figure and marking a beef cow with them would invent a number. `record_valuation` is a function rather than a PostgREST upsert because the unique index is partial and PostgREST emits no WHERE clause for Postgres to infer it with. |
| ~~034~~ | ~~Attach a service to a calving~~ | — | **Already run, 2026-08-10.** `herd.attach_service_to_calving()`. A calving recorded before its service was logged keeps a null `breeding_event_id` and the calf gets no sire — Patience's calving was entered at 12:21 and her two Overalls services at 14:19 and 14:26, and nothing reached back. Sets the link, puts that service's sire on the calving's live calves, and gives them the breeds they should have inherited. Re-pointing is allowed; a calf's sire is moved only where it is null or still the *old* service's sire, because one set by hand is not the function's to overwrite. |
| ~~033~~ | ~~A sire's purpose follows his breeds~~ | — | **Already run, 2026-08-10.** `herd.purpose_from_breeds()`, called by `set_breed_composition` for males only, plus a backfill. `breeds.species_type` and `animals.purpose` already used the same three words; the Purpose select added to the sire form the day before meant maintaining one fact twice, and the species-mismatch warning shipped with it existed only because two copies could disagree. Females are untouched by design: a cow's purpose is how the farm runs her, not a summary of her breeds. The backfill moved Sunnybrook Patriot and Valor from 'dairy' to 'beef'. |
| ~~032~~ | ~~A calving before a lactation already on file~~ | — | **Already run, 2026-08-10.** Reported as `lactations_dry_after_fresh` when recording Vera's 2024 birth against Patience, whose only lactation freshened in 2026. `record_calving` assumed the calving was the most recent thing that had happened to her — true for one recorded the day it happens, false for every historical one, which is exactly what the untied-calf prompt sends people to do. Three bugs from one assumption: drying her off before she freshened, numbering the older lactation *after* the newer one, and inserting a second open lactation. Now it closes only a lactation that started on or before the calving, numbers by the calendar and shifts later rows only on a real collision, and closes the new row at the next freshening when one exists — labelled as derived, because it is an upper bound and not a dry-off anyone recorded. |
| ~~031~~ | ~~A calving can adopt a calf already on file~~ | — | **Already run, 2026-08-10.** Each element of `record_calving`'s `p_calves` may carry an `animal_id`; when present the calving attaches that animal instead of creating one. It fills in dam, sire and origin, and **refuses** rather than overwrites where an existing value disagrees — a birth date that isn't the calving date, a contradicting sex, another dam or sire, an animal already in a calving. Existing breed composition is left alone. Signature unchanged, so no overload. Written because Abigail was on file as Martha's daughter with no calving anywhere in the database, and recording one would have made a second Abigail. |
| ~~030~~ | ~~A calf inherits its parents' breeds~~ | — | **Already run, 2026-08-09.** `herd.set_breed_composition()` — a whole-set replacement whose shares must total 100 — and a replacement `record_calving` that takes the breeding behind the calving by name, checks it is one of *hers* and predates the calving, and gives each live calf half its dam's composition and half its sire's. Only when **both** parents have one: half of a known composition and half of nothing is not 50%, it's an unknown. The AI cost stays on the cow; the reasoning is in the migration's header. |
| ~~029~~ | ~~One gestation override per breed~~ | — | **Already run, 2026-08-08.** A partial unique index on `herd.gestation_overrides (farm_id, breed_id)` so the app can upsert a farm's figure instead of select-then-insert-or-update. That is the whole migration: `breeds.default_gestation_days` was already seeded for all seventeen breeds and nothing read it. |
| ~~028~~ | ~~Pregnancy checks and calvings~~ | — | **Already run, 2026-08-08.** `herd.record_pregnancy_check()` and `herd.record_calving()`. Again no new tables. A calving writes itself, a row per calf, an `animals` row per *live* calf with dam and sire filled in, and — for a dairy dam — the lactation it freshens, closing the previous one because `lactations_one_open_per_animal` allows only one open at a time. |
| ~~027~~ | ~~Record a breeding~~ | — | **Already run, 2026-08-08.** `herd.record_breeding()` and `herd.void_breeding()`. No new tables: `breeding_events` already modelled method/sire/semen_lot/cost_entry_id and had never been written to. The function exists because an AI service is four writes that have to land together — the event, a −1 on the straw ledger, a cost entry against the cow, and the link between them. |
| ~~026~~ | ~~Customers without logins~~ | — | **Already run, 2026-08-08.** Fixes the `insert own profile as customer` policy, which demanded `role = 'customer'` while the CHECK allows only `'buyer'`/`'farmer'` — unreachable since it was written. Drops `profiles_id_fkey` so a customer can exist without an `auth.users` row, adds `has_login`, and keeps the FK's cascade as a trigger on `auth.users`. `add_customer()` is the only thing that writes `has_login false`. |
| ~~025~~ | ~~Ledger account admin~~ | — | **Already run, 2026-08-08.** `rename_ledger_account()` and `delete_ledger_account()`. Adding an account and editing its opening balance need neither — the grants and policy already allow them. Renaming does, because `ledger_transactions.account` is text: the account row and every transaction naming it have to move in one transaction or the money is stranded under the old name. |
| ~~024~~ | ~~Customer admin~~ | — | **Already run, 2026-08-08.** `profiles.archived_at` plus `delete_customer()`, which refuses anyone with orders and names archiving instead. The interesting part is the **column-level grant**: `profiles` is granted per column, so a new column inherits nothing and the write failed with "permission denied for table profiles" while the policy passed. See below. |
| ~~023~~ | ~~Schedule capacity~~ | — | **Already run, 2026-08-08.** `schedule_capacity(product_id)` returns seven rows — one per weekday — of forecast quantity free, so the shop can cap its new weekly-pickup dropdown without exposing production history or other customers' standing orders. Aggregates only; the hard limit is still `check_schedule_capacity`. |
| ~~022~~ | ~~Payment methods~~ | — | **Already run, 2026-08-07.** `payment_methods` lookup seeded Cash/Venmo/Check, an FK from `orders.payment_method`, and both pickup functions validate against the table instead of a hard-coded `in ('Cash','Venmo')`. A fourth method is now one insert, no migration. Also stops a *customer* collecting more than their standing order is for. |

## Run the scoping audit after any policy change

`audit-business-scoping.sql` lists every security-definer function that
inserts into a business-scoped table without naming `business_id`. It should
return no rows.

Four functions were found doing exactly that, one at a time, each because
somebody happened to read its body: `reserve_product` (017),
`complete_scheduled_pickup` (019), `discard_inventory` (020) and
`herd.record_production` (021). The fourth was found by this query on its
first run, which is the argument for having written it.

The failure mode is why it matters: `is_business_member(null)` is false, so
an unscoped row is invisible to the person who created it. No error, no
warning — `record_production` would have been recording inventory nobody
could see, sell or reserve against.

It matches an insert's column list textually, so it will not catch an
`insert … select *`, dynamic SQL, or a column list broken by a comment.
A clean result means "none of the known shape", not a proof.

## A policy can contradict a constraint, and nothing will tell you

`profiles` carried a policy requiring `role = 'customer'` for an insert, and
a CHECK constraint allowing only `'buyer'` or `'farmer'`. Any insert
satisfying one failed the other, so the policy was unreachable from the day
it was written — and nothing reported it, because a policy is not validated
against the constraints on the table it guards.

It went unnoticed for as long as it did because the path it guards is a
fallback: `on_auth_user_created` creates the profile through a security
definer function, before any policy is consulted. 026 sets it to `'buyer'`,
which is what the column defaults to and what every live row carries.

Worth checking whenever a policy names a column value: does a constraint
allow that value at all?

## A new column inherits no privileges

`public.profiles` is granted at the column level: `authenticated` holds
UPDATE on exactly `email`, `first_name`, `last_name` and `phone`. 024 added
`archived_at`, and the first rehearsal failed with

```
permission denied for table profiles
```

even though the RLS policy passed — `ALTER TABLE ... ADD COLUMN` grants
nothing. The fix is one line (`grant update (archived_at) ... to
authenticated`), but the failure is invisible from the SQL editor, which runs
as superuser. Add a column to a column-granted table and you must grant it.

The same check is why `role` is *not* granted: it's what `is_farmer()` reads,
so UPDATE on it is the difference between a customer and someone holding
every policy on products, inventory and orders. The customer page shows the
role and doesn't offer to change it.

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
