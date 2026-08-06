-- 015 — Let the database enforce what a lactation can be.
--
-- STATUS: PROPOSAL. Not run. Additive; safe while herd.lactations is empty.
-- Depends on: nothing beyond the existing herd schema.
--
-- The app (app/src/lib/lactations.ts, validateFreshening) refuses to record
-- a duplicate parity for a cow, or a second lactation while one is still
-- open. The table permits both. Application-only invariants hold exactly
-- as long as every writer goes through that one function — a second client,
-- a bulk import or a hand-written insert silently breaks them, and the
-- damage is only visible much later as a cow with two lactation 3s.
--
-- Both indexes are cheap to add now, while the table has no rows. Adding
-- them after a bad row exists means finding and repairing it first.

begin;

-- One row per cow per parity. Partial so a soft-deleted lactation doesn't
-- reserve its number forever.
create unique index if not exists lactations_animal_parity_uniq
  on herd.lactations (animal_id, lactation_number)
  where deleted_at is null;

-- At most one open lactation per cow. A cow is milking on one lactation or
-- none; two open rows means one of them was never dried off, which quietly
-- corrupts days-in-milk and every count built on it.
create unique index if not exists lactations_one_open_per_animal
  on herd.lactations (animal_id)
  where deleted_at is null and dry_off_date is null;

-- Dry-off cannot precede freshening. Written as NOT VALID so the migration
-- can't fail on pre-existing data; validate separately once the existing
-- rows are known good.
alter table herd.lactations
  add constraint lactations_dry_after_fresh
  check (dry_off_date is null or dry_off_date >= fresh_date) not valid;

commit;

-- Validate the check against existing rows once you've confirmed none
-- violate it. Takes a brief lock; safe on a table this size:
--
--   select id, animal_id, fresh_date, dry_off_date
--     from herd.lactations
--    where dry_off_date is not null and dry_off_date < fresh_date;
--   -- expect zero rows, then:
--   alter table herd.lactations validate constraint lactations_dry_after_fresh;

-- Verify the indexes reject what they should — each of these must error:
--
--   insert into herd.lactations (farm_id, animal_id, lactation_number, fresh_date)
--   values (<farm>, <animal>, 1, '2026-01-01');           -- run twice: second fails
--
--   -- with an open lactation already present for that animal:
--   insert into herd.lactations (farm_id, animal_id, lactation_number, fresh_date)
--   values (<farm>, <animal>, 2, '2026-06-01');           -- fails, none dried off

-- Rollback:
--   alter table herd.lactations drop constraint if exists lactations_dry_after_fresh;
--   drop index if exists herd.lactations_one_open_per_animal;
--   drop index if exists herd.lactations_animal_parity_uniq;
