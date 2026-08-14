-- 046 — the fence between Paddock 4 and Paddock 5
--
-- STATUS: run 2026-08-14. All five checks pass:
--   1. the five still sum to 9.568 — the perimeter, exactly
--   2. P1 2.021/535, P2 1.932/420, P3 1.972/425 untouched;
--      P4 2.227/507, P5 1.416/416
--   3. no boundary mentions the deleted vertex
--   4. every wire back where it was, to the foot —
--      P4 0→0.149681, 0.149681→0.337427, 0.337427→0.383147, 0.383147→0.469071
--      P5 0.026649→0.104517, 0.026649→0.267606, 0.267606→0.419173
--   5. no strip inverted or ran past the end
--
--   Rehearsed in a rolled-back transaction first, which caught an ambiguous
--   `rev` — `grazing_events` and `paddocks` both have one, and `update ... from`
--   will not guess.
--
-- The owner marked the line on a screenshot of the map: the P4/P5 boundary
-- was drawn in the wrong place, and it should run from the junction where
-- P3, P5 and P4 meet down to P4's north-east corner.
--
-- ── What was actually wrong ───────────────────────────────────────────
--
-- 040 cut the five units out of the perimeter using straight lines, and the
-- line dividing P3/P5 from P4 was a single horizontal at latitude
-- 42.87722457. West of P5 that is right — it is the fence. East of P3 it is
-- not: the real southern boundary there runs about ten feet lower.
--
-- The gap between the two became part of Paddock 4, as a ribbon 10 ft tall
-- and 370 ft long tucked underneath P5 — 1,090 sq ft, a fortieth of an acre,
-- shaped like nothing anyone would fence.
--
-- It is not merely cosmetic. Paddock 4 is swept west to east, and the ribbon
-- was its **eastern hundred feet**: a sweep that ran 607 ft on paper ended in
-- 100 ft of ten-foot ribbon. That is the same defect that showed up when the
-- strip arithmetic was fixed — Paddock 4's last sixteenth measured 1,505%
-- smaller than an even share of the unit, worse than any other ground on the
-- farm by a factor of thirty. The ribbon *was* that taper. With it gone the
-- worst error on P4 falls to 48%, in line with P1 and P5.
--
-- ── What changes ──────────────────────────────────────────────────────
--
-- Paddock 4 closes along the line the owner drew, from its real north-east
-- corner to the junction. Paddock 5's south side stops being a drawn straight
-- line and follows the ground instead.
--
--   | unit | acres          | sweep            |
--   |------|----------------|------------------|
--   | P4   | 2.261 → 2.227  | 607 ft → 507 ft  |
--   | P5   | 1.381 → 1.416  | 405 ft → 416 ft  |
--
-- P1, P2 and P3 are untouched, and the five still sum to **9.568** — exactly
-- the perimeter, nothing created and nothing lost. That is the same check
-- that made 040 and 044 trustworthy, and it is the one that matters: this
-- moves a fence between two units, it does not redraw the farm.
--
-- One vertex is deleted rather than moved: (-88.41269599, 42.87722457), where
-- the old horizontal met P5's east fence. It was never surveyed — it was
-- constructed by the cut. Checked before removing it, it sits **0.00 inches**
-- off the straight line between P5's north-east corner and the perimeter
-- vertex below it, which is what a constructed intersection looks like and
-- what a real corner does not.

update herd.paddocks set
  acres_measured  = 2.227,
  acres_grazable  = 2.227,
  sweep_length_ft = 507,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41415662, 42.87671229], [-88.413731, 42.87662757], [-88.41317476, 42.8765312], [-88.41306449, 42.87688276], [-88.41307961, 42.87719421], [-88.41335974, 42.87722457], [-88.41494669, 42.87722457], [-88.41495831, 42.87686518], [-88.41415662, 42.87671229]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 4' and farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 1.416,
  acres_grazable  = 1.416,
  sweep_length_ft = 416,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41307961, 42.87719421], [-88.41269056, 42.87719684], [-88.41291314, 42.87833348], [-88.41335974, 42.87833348], [-88.41335974, 42.87722457]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 5' and farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10' and deleted_at is null;

-- ── The grazing already on file ───────────────────────────────────────
--
-- 044 could leave the events alone: it moved the perimeter by under 2.4 ft
-- and every unit kept its length, so a fraction still meant what it meant.
-- This one does not have that luxury. `swept_from` and `swept_to` are
-- fractions of a unit's sweep, and both sweeps change length here — P4 by a
-- sixth, P5 by a fortieth — so the same fraction would silently point at
-- different ground.
--
-- Each fraction is therefore rescaled to keep the wire where it actually
-- was. The transform is exact, because distance along the sweep axis is
-- linear in the fraction:
--
--     position  = min_old + f_old × span_old
--     f_new     = (position − min_new) ÷ span_new
--
-- For P4 the western origin does not move — the ribbon came off the far end —
-- so it is a pure rescale by span_old/span_new. For P5 the southern origin
-- moves 11.1 ft south, because the ribbon is what it gains, so there is a
-- shift as well as a scale.
--
-- Seven rows, all logged in the two days since the module went live. Every
-- one keeps its distance along the sweep to the foot; only the number
-- describing it changes.

update herd.grazing_events e set
  swept_from = least(1, e.swept_from * 1.1974474871),
  swept_to   = least(1, e.swept_to   * 1.1974474871),
  -- Qualified: `paddocks` has a `rev` too, and an unqualified one is ambiguous.
  updated_at = now(), rev = e.rev + 1
from herd.paddocks p
where p.id = e.paddock_id and p.name = 'Paddock 4'
  and e.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'
  and e.deleted_at is null and e.swept_from is not null;

update herd.grazing_events e set
  swept_from = least(1, 0.0266486434 + e.swept_from * 0.9733513566),
  swept_to   = least(1, 0.0266486434 + e.swept_to   * 0.9733513566),
  updated_at = now(), rev = e.rev + 1
from herd.paddocks p
where p.id = e.paddock_id and p.name = 'Paddock 5'
  and e.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'
  and e.deleted_at is null and e.swept_from is not null;

-- ── Verification ──────────────────────────────────────────────────────
--
-- Run these after, and record the answers under STATUS.
--
--   -- 1. the farm is still the farm
--   select round(sum(acres_measured), 3) from herd.paddocks
--    where farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10' and deleted_at is null;
--   -- expect 9.568
--
--   -- 2. only the two units moved
--   select name, acres_measured, sweep_length_ft from herd.paddocks
--    where farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10' and deleted_at is null
--    order by rotation_order;
--   -- expect 2.021/535, 1.932/420, 1.972/425, 2.227/507, 1.416/416
--
--   -- 3. the deleted vertex is gone and no ribbon survives
--   select name from herd.paddocks
--    where farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10' and deleted_at is null
--      and boundary::text like '%-88.41269599%';
--   -- expect no rows
--
--   -- 4. every wire still where it was, to the foot
--   select p.name, e.swept_from, e.swept_to
--     from herd.grazing_events e join herd.paddocks p on p.id = e.paddock_id
--    where e.farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10' and e.deleted_at is null
--      and p.name in ('Paddock 4', 'Paddock 5') order by p.name, e.entered_at;
--   -- P4 expect 0, 0.149681 | 0.149681, 0.337427 | 0.337427, 0.383147 | 0.383147, 0.469071
--   -- P5 expect 0.026649, 0.104517 | 0.026649, 0.267606 | 0.267606, 0.419173
--
--   -- 5. no strip inverted or ran off the end
--   select count(*) from herd.grazing_events
--    where farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10' and deleted_at is null
--      and swept_from is not null and (swept_to <= swept_from or swept_to > 1);
--   -- expect 0
--
-- There is no clean rollback for the event rescale — the inverse transform
-- restores the fractions, but the boundaries have to go back with it or the
-- record means something different again. Both halves or neither:
--
--   update herd.grazing_events e set
--     swept_from = e.swept_from / 1.1974474871, swept_to = e.swept_to / 1.1974474871
--   from herd.paddocks p where p.id = e.paddock_id and p.name = 'Paddock 4' ...;
--   update herd.grazing_events e set
--     swept_from = (e.swept_from - 0.0266486434) / 0.9733513566, ...
--   from herd.paddocks p where p.id = e.paddock_id and p.name = 'Paddock 5' ...;
--   -- then re-run 044's Paddock 4 and Paddock 5 updates.
