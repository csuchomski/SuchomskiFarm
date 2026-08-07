-- 016 — One genetics result per animal, and dropdown options the table
-- will actually accept.
--
-- STATUS: RUN, 2026-08-07. Both tables were empty, so both indexes built
-- instantly and no row needed repairing first.
-- Depends on: 013 (herd.attribute_options).
--
-- Verified after running:
--   marker_genotypes_animal_marker_uniq          present
--   animal_genetic_status_animal_condition_uniq  present
--   origin 'born_here'  -> active = false
--   status 'dead'       -> code is now 'died'
--   origin gained embryo_transfer and leased; status gained processed and
--   leased_out
--
-- Every remaining active option in both vocabularies now satisfies the
-- animals check constraint it's offered against, which was the point.
--
-- Two unrelated-looking problems, both found while wiring the genetics UI,
-- both in the same category: the database and the app disagreeing about
-- what a valid row is.
--
-- ── Part 1: uniqueness ────────────────────────────────────────────────
--
-- herd.marker_genotypes has a plain index on (animal_id, marker_code) and
-- herd.animal_genetic_status has none on (animal_id, condition_id). Nothing
-- stops a second row. Re-testing a cow for beta casein would leave two
-- answers on file with no way to tell which is current, and every count
-- built on them ("how many A2A2?") would double-count her.
--
-- app/src/lib/genetics.ts already writes find-then-write so it overwrites
-- rather than appends, and it keeps doing so after this runs — the index is
-- the guard for everything that isn't that function: a bulk import, a second
-- client, a hand-written insert.
--
-- Both tables are empty, so there is nothing to repair first and the indexes
-- build instantly.
--
-- ── Part 2: two options that can never be saved ───────────────────────
--
-- herd.attribute_options offers values herd.animals rejects:
--
--   origin 'born_here'  -> animals_origin_check allows only born_on_farm,
--                          purchased, embryo_transfer, leased
--   status 'dead'       -> animals_status_check allows died, not dead
--
-- Both appear in the animal form's dropdowns today. Picking either produces
-- a 23514 check violation on save, with a Postgres constraint message rather
-- than anything a person would act on. Verified against the live constraints
-- before writing this.
--
-- 'born_here' is a duplicate of 'born_on_farm', so it's deactivated rather
-- than renamed — no animal can be pointing at it, because no animal could
-- ever have been saved with it. 'dead' is corrected to 'died', the value the
-- constraint actually names.
--
-- The two valid options that were never offered are added at the same time,
-- since the vocabulary is being corrected anyway.

begin;

-- ── Part 1 ────────────────────────────────────────────────────────────

-- One genotype per animal per marker. Partial, so clearing a result (a soft
-- delete) frees the slot for a re-test rather than blocking it forever.
create unique index if not exists marker_genotypes_animal_marker_uniq
  on herd.marker_genotypes (animal_id, marker_code)
  where deleted_at is null;

-- One status per animal per condition, for the same reason.
create unique index if not exists animal_genetic_status_animal_condition_uniq
  on herd.animal_genetic_status (animal_id, condition_id)
  where deleted_at is null;

-- ── Part 2 ────────────────────────────────────────────────────────────

-- Unsavable. 'born_on_farm' already covers it.
update herd.attribute_options
   set active = false, updated_at = now()
 where attribute = 'origin' and code = 'born_here';

-- The constraint says 'died'.
update herd.attribute_options
   set code = 'died', label = 'Died', updated_at = now()
 where attribute = 'status' and code = 'dead';

-- Valid values the vocabulary never offered. farm_id is taken from the
-- existing rows for the same attribute so this doesn't hard-code a farm.
insert into herd.attribute_options (farm_id, attribute, code, label, sort_order)
select o.farm_id, v.attribute, v.code, v.label, v.sort_order
  from (values
         ('origin', 'embryo_transfer', 'Embryo transfer', 40),
         ('origin', 'leased',          'Leased',          50),
         ('status', 'processed',       'Processed',       60),
         ('status', 'leased_out',      'Leased out',      70)
       ) as v(attribute, code, label, sort_order)
  join lateral (
        select distinct farm_id
          from herd.attribute_options
         where attribute = v.attribute
       ) o on true
 where not exists (
        select 1 from herd.attribute_options e
         where e.farm_id = o.farm_id and e.attribute = v.attribute and e.code = v.code
       );

commit;

-- Rollback:
--
--   drop index if exists herd.marker_genotypes_animal_marker_uniq;
--   drop index if exists herd.animal_genetic_status_animal_condition_uniq;
--
--   update herd.attribute_options set active = true
--    where attribute = 'origin' and code = 'born_here';
--   update herd.attribute_options set code = 'dead', label = 'Dead'
--    where attribute = 'status' and code = 'died';
--   delete from herd.attribute_options
--    where (attribute, code) in (('origin','embryo_transfer'), ('origin','leased'),
--                                ('status','processed'), ('status','leased_out'));
--
-- Reversing part 2 restores two options that cannot be saved, so it's only
-- worth doing alongside a revert of the app.
