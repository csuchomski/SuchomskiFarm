-- 044 — the redrawn perimeter, and the units re-cut from it
--
-- STATUS: run 2026-08-13
--
-- The owner redrew the farm boundary in Google Earth. Only the perimeter
-- moved: all four interior fence paths are byte-identical to the file 040
-- loaded. Eight of twelve vertices shifted, none by more than 2.4 ft, and the
-- enclosed area goes from 9.532 to 9.568 acres — about 1,560 sq ft, a third
-- of a percent. A redraw tidying the boundary rather than a change of fact.
--
-- Small, and still not applied on its own. Reloading the perimeter re-cuts
-- all five units, and the app is changing at the same time to compute a
-- strip's acres from the drawn polygon rather than from a fraction of the
-- unit's total. Both move the same numbers, so they go in together and the
-- figures shift under the farm once rather than twice in a week.
--
-- The five re-cut units sum to 9.568 — exactly the perimeter, nothing left
-- over — which is the same check that made the first load trustworthy.
--
-- Grazing events already on file are untouched. They store `swept_from` and
-- `swept_to` as fractions of a unit's sweep, and those fractions still mean
-- what they meant: the same proportion of the same unit. What changes is the
-- acreage they resolve to, by well under a percent from the boundary and by
-- rather more from the arithmetic fix — which is the point of the fix.

update herd.paddocks set
  acres_measured  = 2.021,
  acres_grazable  = 2.021,
  sweep_length_ft = 535,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41291314, 42.87833348], [-88.41299683, 42.87876087], [-88.41331173, 42.87882226], [-88.41412428, 42.87883078], [-88.41463922, 42.87873318], [-88.41489766, 42.87874084], [-88.41491083, 42.87833348], [-88.41291314, 42.87833348]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 1' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 1.932,
  acres_grazable  = 1.932,
  sweep_length_ft = 420,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41335974, 42.87778163], [-88.41335974, 42.87833348], [-88.41491083, 42.87833348], [-88.41492868, 42.87778163], [-88.41335974, 42.87778163]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 2' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 1.972,
  acres_grazable  = 1.972,
  sweep_length_ft = 425,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41335974, 42.87778163], [-88.41492868, 42.87778163], [-88.41494669, 42.87722457], [-88.41335974, 42.87722457]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 3' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 2.261,
  acres_grazable  = 2.261,
  sweep_length_ft = 607,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41415662, 42.87671229], [-88.413731, 42.87662757], [-88.41317476, 42.8765312], [-88.41306449, 42.87688276], [-88.41307961, 42.87719421], [-88.41269056, 42.87719684], [-88.41269599, 42.87722457], [-88.41494669, 42.87722457], [-88.41495831, 42.87686518], [-88.41415662, 42.87671229]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 4' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 1.381,
  acres_grazable  = 1.381,
  sweep_length_ft = 405,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41269599, 42.87722457], [-88.41291314, 42.87833348], [-88.41335974, 42.87833348], [-88.41335974, 42.87722457]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 5' and deleted_at is null;

-- The perimeter fence itself, redrawn.
update herd.infrastructure set
  geometry = '{"type": "LineString", "coordinates": [[-88.41415661611339, 42.87671228695303], [-88.41373100023101, 42.87662756783331], [-88.41317476329905, 42.87653120431429], [-88.41306449314374, 42.87688276322167], [-88.4130796058033, 42.87719421074982], [-88.41269055798223, 42.8771968409059], [-88.41299683267957, 42.87876086983165], [-88.41331172623335, 42.87882225600689], [-88.4141242802737, 42.87883078164459], [-88.41463921817487, 42.87873318343745], [-88.41489765718502, 42.87874083885301], [-88.41495831448356, 42.87686517881129], [-88.41415661611339, 42.87671228695303]]}'::jsonb,
  notes = 'Drawn length 2621 ft enclosing 9.568 acres, from the farm KML redrawn 2026-08-13.',
  updated_at = now(), rev = rev + 1
where name = 'Perimeter fence' and kind = 'permanent_fence' and deleted_at is null;
