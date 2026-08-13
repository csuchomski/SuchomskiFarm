-- 040 — the farm's real boundaries, from the KML
--
-- STATUS: run 2026-08-13
--
-- Until now every paddock carried the same 1.91 acres — 9.55 divided by five,
-- because that was all anyone knew. The KML settles it. The drawn perimeter
-- measures 9.532 acres against the 9.55 on file, a 0.2% difference from an
-- independent source, and the four interior fences divide it into five
-- regions that sum to the whole with nothing left over.
--
-- The real units run 1.375 to 2.255 acres — a 64% spread. That matters more
-- than it looks: a strip's acreage is a fraction of its unit's acreage, so a
-- flat 1.91 has been quietly overstating the small unit and understating the
-- large one on every strip figure the app has produced.
--
-- The numbering follows the serpentine the farm actually walks, confirmed by
-- the farmer against the ground: north band, then the two middle bands west
-- of the vertical fence, then the south band, then the east lobe. Each unit's
-- sweep ends where the next one begins, and the fifth delivers the mob back
-- to the east end of the first, so the loop closes with no dead legs. The
-- headings seeded in 039 already match; nothing about them changes here.
--
-- Coordinates are WGS84 as exported. Areas were computed on a local
-- equirectangular projection about 42.8778 N, which over 600 ft is accurate
-- to well under a tenth of an acre.

-- ── acreage, geometry and sweep length, per unit ───────────────────────
--
-- sweep_length_ft is the extent along each unit's own heading — east-west for
-- the four swept that way, north-south for the east lobe. It is a bounding
-- extent, so on the two irregular units it is the widest line across rather
-- than a constant. That is the right precision for its only job, which is to
-- tell someone at the gate roughly how far in the wire sits.

update herd.paddocks set
  acres_measured  = 2.003,
  acres_grazable  = 2.003,   -- all of it grazable
  sweep_length_ft = 533,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41291848, 42.87833348], [-88.41300389, 42.87875941], [-88.4133151, 42.87882266], [-88.41412207, 42.8788266], [-88.41463991, 42.87873066], [-88.41489732, 42.87873426], [-88.41490975, 42.87833348], [-88.41291848, 42.87833348]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 1' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 1.93,
  acres_grazable  = 1.93,   -- all of it grazable
  sweep_length_ft = 419,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41335974, 42.87778163], [-88.41335974, 42.87833348], [-88.41490975, 42.87833348], [-88.41492686, 42.87778163], [-88.41335974, 42.87778163]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 2' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 1.97,
  acres_grazable  = 1.97,   -- all of it grazable
  sweep_length_ft = 424,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41335974, 42.87778163], [-88.41492686, 42.87778163], [-88.41494413, 42.87722457], [-88.41335974, 42.87722457]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 3' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 2.255,
  acres_grazable  = 2.255,   -- all of it grazable
  sweep_length_ft = 606,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41415662, 42.87671229], [-88.413731, 42.87662757], [-88.41317631, 42.87653264], [-88.41306449, 42.87688276], [-88.41308139, 42.87719553], [-88.41269056, 42.87719684], [-88.41269612, 42.87722457], [-88.41494413, 42.87722457], [-88.41495524, 42.87686621], [-88.41415662, 42.87671229]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 4' and deleted_at is null;

update herd.paddocks set
  acres_measured  = 1.375,
  acres_grazable  = 1.375,   -- all of it grazable
  sweep_length_ft = 405,
  boundary        = '{"type": "Polygon", "coordinates": [[[-88.41335974, 42.87722457], [-88.41269612, 42.87722457], [-88.41291848, 42.87833348], [-88.41335974, 42.87833348], [-88.41335974, 42.87722457]]]}'::jsonb,
  updated_at = now(), rev = rev + 1
where name = 'Paddock 5' and deleted_at is null;

-- ── the fences, as drawn ───────────────────────────────────────────────
--
-- 037 seeded four interior fences with lengths paced off the EQIP plan map
-- and no geometry. The KML replaces the estimates with the drawn lines, and
-- renames them by position — the placeholder names were lengths, which is a
-- poor name for a thing whose length is a column.
--
-- Two of the four are drawn in the KML as a pair of paths each, because the
-- run to the east perimeter was added afterwards. They are one fence on the
-- ground, so they are one row here.
--
-- Status is left alone. The seed marked the interior fences 'planned'
-- because that is how the EQIP map drew them, and a line existing in a KML
-- is not evidence that a fence exists in a field.

update herd.infrastructure set
  name = 'North interior fence',
  geometry = '{"type": "LineString", "coordinates": [[-88.41491222582417, 42.87833347549089], [-88.41335973701894, 42.87833698670671], [-88.41291959469925, 42.87833683169362]]}'::jsonb,
  notes = trim(both from coalesce(notes,'') || ' Drawn length 533 ft, from the farm KML.'),
  updated_at = now(), rev = rev + 1
where name = 'Interior fence 372 ft' and kind = 'permanent_fence' and deleted_at is null;

update herd.infrastructure set
  name = 'East interior fence',
  geometry = '{"type": "LineString", "coordinates": [[-88.41335973701894, 42.87833698670671], [-88.41335435366699, 42.87722456820611]]}'::jsonb,
  notes = trim(both from coalesce(notes,'') || ' Drawn length 406 ft, from the farm KML.'),
  updated_at = now(), rev = rev + 1
where name = 'Interior fence 401 ft' and kind = 'permanent_fence' and deleted_at is null;

update herd.infrastructure set
  name = 'South interior fence',
  geometry = '{"type": "LineString", "coordinates": [[-88.41494048993077, 42.87721959822932], [-88.41335435366699, 42.87722456820611], [-88.41308246334731, 42.87719613690506]]}'::jsonb,
  notes = trim(both from coalesce(notes,'') || ' Drawn length 498 ft, from the farm KML.'),
  updated_at = now(), rev = rev + 1
where name = 'Interior fence 410 ft' and kind = 'permanent_fence' and deleted_at is null;

update herd.infrastructure set
  name = 'Middle interior fence',
  geometry = '{"type": "LineString", "coordinates": [[-88.41491749833345, 42.87778162512814], [-88.41335912145296, 42.87778118081621]]}'::jsonb,
  notes = trim(both from coalesce(notes,'') || ' Drawn length 417 ft, from the farm KML.'),
  updated_at = now(), rev = rev + 1
where name = 'Interior fence 417 ft' and kind = 'permanent_fence' and deleted_at is null;

update herd.infrastructure set
  geometry = '{"type": "LineString", "coordinates": [[-88.41415661611339, 42.87671228695303], [-88.41373100023101, 42.87662756783331], [-88.41317630694518, 42.87653263511906], [-88.41306449314374, 42.87688276322167], [-88.41308139459608, 42.87719553123256], [-88.41269055798223, 42.8771968409059], [-88.41300388551464, 42.87875940971139], [-88.4133151042539, 42.87882266474044], [-88.41412207320528, 42.87882659680924], [-88.41463991098591, 42.87873065610868], [-88.41489732299772, 42.8787342624153], [-88.41495524099521, 42.87686621095465], [-88.41415661611339, 42.87671228695303]]}'::jsonb,
  notes = trim(both from coalesce(notes,'') || ' Drawn length 2615 ft enclosing 9.532 acres, from the farm KML.'),
  updated_at = now(), rev = rev + 1
where name = 'Perimeter fence' and kind = 'permanent_fence' and deleted_at is null;

-- The seven water points keep their rows and stay without geometry: the KML
-- carries no Point placemarks yet. They are known to sit along the interior
-- fence line, which is why they were seeded at all, but "along a fence" is
-- not a location and guessing one would put a tank on the map that nobody
-- has ever stood next to.
