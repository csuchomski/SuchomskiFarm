-- 037 — grazing seed for Suchomski Family Farm
--
-- STATUS: run 2026-08-13
--
-- The farm's real grazing setup, as given by the owner. Separate from 036
-- because that migration is the schema and belongs to any farm; this is one
-- farm's data and would be wrong anywhere else.
--
-- Idempotent throughout — every insert is guarded, so re-running adds
-- nothing and changes nothing.
--
-- What is seeded, and where each figure came from:
--
--   * **Five paddocks**, Paddock 1–5 numbered north to south, codes P1–P5.
--     The owner had no established names; the plan map is drawn north-up, so
--     numbering down the page lets a conservationist holding that map follow
--     the app without a key.
--
--   * **1.91 grazable acres each.** The owner gives 9.55 acres for the field,
--     all of it grazable. Divided evenly across five units pending individual
--     measurement — and the provenance is written into each row's notes, not
--     just here, because a number that looks measured and isn't is the kind
--     of thing that survives to a review.
--
--     It corroborates: the block between the 410 ft and 417 ft cross-fences
--     works out at roughly 3.8 acres off the drawing's own dimensions, which
--     is about 1.9 for each of the two units inside it.
--
--   * **Seven water points** on the interior fence. Recorded without geometry
--     — the owner will place them by tapping the aerial once step 4 builds
--     the map, which is self-checking in a way that hand-typed coordinates
--     are not.
--
--   * **One mob**, holding every animal the farm has on file. Head count and
--     average weight derive from those records rather than being stated here.
--
-- Deliberately NOT seeded: a grazing plan. Its goals, objectives, contract
-- identifiers and per-paddock targets are the owner's to write, and inventing
-- a recovery-day target would be this app making an agronomic recommendation.
-- Until a plan exists the board shows no next-eligible date, which is the
-- honest answer rather than a guessed one.

-- ── the five units ─────────────────────────────────────────────────────

insert into herd.paddocks (farm_id, name, code, acres_measured, acres_grazable, unit_type, active, notes)
select '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid, v.name, v.code, 1.91, 1.91, 'permanent', true,
       'Farm total 9.55 acres, all grazable, divided evenly across five units pending individual measurement.'
  from (values
    ('Paddock 1', 'P1'),
    ('Paddock 2', 'P2'),
    ('Paddock 3', 'P3'),
    ('Paddock 4', 'P4'),
    ('Paddock 5', 'P5')
  ) as v(name, code)
 where not exists (
   select 1 from herd.paddocks p
    where p.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid
      and lower(p.name) = lower(v.name)
      and p.deleted_at is null
 );

-- ── the fences and gates the plan map draws ────────────────────────────
--
-- Lengths are the map's own labels. No geometry yet: the drawing gives
-- distances, and a distance is not a position.

insert into herd.infrastructure (farm_id, kind, name, status, nrcs_practice_code, notes)
select '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid, v.kind, v.name, v.status, v.code, v.notes
  from (values
    ('permanent_fence', 'Perimeter fence',      'existing', '382', 'Red dashed on the EQIP plan map.'),
    ('permanent_fence', 'Interior fence 410 ft', 'planned',  '382', 'White dashed on the EQIP plan map; north cross-fence.'),
    ('permanent_fence', 'Interior fence 372 ft', 'planned',  '382', 'White dashed on the EQIP plan map; middle cross-fence.'),
    ('permanent_fence', 'Interior fence 417 ft', 'planned',  '382', 'White dashed on the EQIP plan map; south cross-fence.'),
    ('permanent_fence', 'Interior fence 401 ft', 'planned',  '382', 'White dashed on the EQIP plan map; north-south segment joining the cross-fences.')
  ) as v(kind, name, status, code, notes)
 where not exists (
   select 1 from herd.infrastructure i
    where i.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid
      and i.name = v.name and i.deleted_at is null
 );

-- ── the seven water points ─────────────────────────────────────────────
--
-- paddock_id is left null: each sits on a fence line and waters the units on
-- both sides, so it belongs to no single one. Which units each serves goes
-- into paddock_water_sources once the positions are known.
--
-- Status is 'existing' on the owner's "I have 7 water points" — present
-- tense. Worth confirming, since the interior fences they sit along are
-- themselves still planned. The note says so rather than leaving the
-- assumption invisible.

insert into herd.infrastructure (farm_id, kind, name, status, nrcs_practice_code, notes)
select '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid, 'water_source',
       'Water point ' || n, 'existing', '614',
       'On the interior fence, serving the units on both sides. Location to be placed on the unit map. Status assumed existing — confirm, as the interior fencing is still planned.'
  from generate_series(1, 7) as n
 where not exists (
   select 1 from herd.infrastructure i
    where i.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid
      and i.name = 'Water point ' || n and i.deleted_at is null
 );

-- ── the mob ────────────────────────────────────────────────────────────
--
-- head_count_manual and avg_weight_lb_manual are deliberately null: both
-- derive from the animal records and from herd.weights, which is what the
-- owner asked for. A figure here would override the derivation silently.

insert into herd.grazing_groups (farm_id, name, species, class, active, notes)
select '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid, 'Main mob', 'cattle', 'mixed', true,
       'Head count and average weight derive from the animal records; enter weights on each animal rather than here.'
 where not exists (
   select 1 from herd.grazing_groups g
    where g.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid
      and g.name = 'Main mob' and g.deleted_at is null
 );

-- Every animal the farm keeps. Reference bulls are catalogue rows, not
-- livestock, and are excluded the same way they are everywhere else.
insert into herd.grazing_group_members (farm_id, group_id, animal_id, joined_on)
select a.farm_id, g.id, a.id, current_date
  from herd.animals a
  join herd.grazing_groups g
    on g.farm_id = a.farm_id and g.name = 'Main mob' and g.deleted_at is null
 where a.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'::uuid
   and a.deleted_at is null
   and a.record_type <> 'reference'
   and a.status = 'active'
   and not exists (
     select 1 from herd.grazing_group_members m
      where m.group_id = g.id and m.animal_id = a.id
        and m.left_on is null and m.deleted_at is null
   );
