-- 029 — One gestation override per breed, per farm.
--
-- STATUS: RUN, 2026-08-08. Verified as the farmer in a rolled-back
-- transaction, so RLS applied:
--   upserting the same (farm, breed) twice left one row holding the later
--     value, which is what the key is for
--   the resolution it enables, across the live herd:
--     Abigail 283 via Belted Galloway, Martha 283 via Belted Galloway,
--     Patience 282 via Jersey (override), Vera 282 via Jersey (override)
-- Depends on: nothing.
--
-- ── Why this is all it is ─────────────────────────────────────────────
--
-- Gestation per breed already exists. herd.breeds carries
-- `default_gestation_days NOT NULL` and all seventeen seeded rows have a
-- figure — Brown Swiss 290, Charolais 287, Hereford 285, Angus and Belted
-- Galloway 283, Milking Shorthorn 282, Jersey and Holstein 279. And
-- herd.gestation_overrides exists so a farm can disagree with a default
-- without editing the breed for everyone.
--
-- What was missing is that nothing read any of it: due dates came from
-- settings.gestation_days_beef / _dairy, which is a whole-species average.
-- That is an app change, not a schema one.
--
-- The one thing the schema needs is a key. gestation_overrides has no
-- uniqueness on (farm_id, breed_id), so "set Jersey to 281" has no row to
-- update — the app would have to select, then insert or update, and two
-- people saving at once would leave two overrides for one breed with no
-- rule for which wins.
--
-- Partial on deleted_at because every table in this schema soft-deletes; a
-- plain unique index would refuse to re-add a breed override somebody had
-- removed.

begin;

-- Nothing to clean up first: the table is empty, and this is checked rather
-- than assumed because a duplicate would make the index creation fail
-- halfway through a migration that otherwise looks trivial.
do $$
declare v_dupes integer;
begin
  select count(*) into v_dupes from (
    select farm_id, breed_id from herd.gestation_overrides
     where deleted_at is null group by farm_id, breed_id having count(*) > 1
  ) d;
  if v_dupes > 0 then
    raise exception 'Resolve % duplicate (farm, breed) override(s) before adding the key', v_dupes;
  end if;
end $$;

create unique index if not exists gestation_overrides_farm_breed_uniq
  on herd.gestation_overrides (farm_id, breed_id)
  where deleted_at is null;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select indexdef from pg_indexes
--    where schemaname = 'herd' and indexname = 'gestation_overrides_farm_breed_uniq';
--
-- And with RLS applied, since the app upserts as the farmer:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--   insert into herd.gestation_overrides (breed_id, gestation_days, farm_id)
--   values ('<jersey>', 281, '<farm>')
--   on conflict (farm_id, breed_id) where deleted_at is null
--   do update set gestation_days = excluded.gestation_days;   -- twice; one row
--
-- Rollback:
--   drop index if exists herd.gestation_overrides_farm_breed_uniq;
