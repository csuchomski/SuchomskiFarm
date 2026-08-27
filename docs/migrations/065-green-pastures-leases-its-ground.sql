-- 065 — three places for the large demo farm
--
-- STATUS: run 2026-08-27
--
-- 064 added the level above the pasture and 063 seeded the two demo farms
-- before it existed, so the farm the level was built for does not use it.
-- A demo of scaling that does not show the thing that scales is not a demo.
--
-- Greg Judy's operation is the shape this models: a home farm and a string
-- of leases across the county, each with its own pastures on it. So Green
-- Pastures' six pastures are grouped under three places — one owned, two
-- leased, with real end dates on the leases so the band on the Ground page
-- has something to say.
--
-- **Grassway Organics is deliberately left alone.** It is the mid-sized
-- example, three pastures on one block, and it is the shape most farms are.
-- Leaving it without properties is what keeps a demo of the page as most
-- farms see it: no place segment on the Move page, no band on the Ground
-- page, nothing extra to read past. Both states are worth being able to
-- show, and there is no point in having two demo farms that demonstrate the
-- same thing.
--
-- Fixtures, so this is plain SQL rather than a call to `save_property` —
-- there is no authenticated user in a migration for `auth.uid()` to find.
-- It refuses to run twice, the same way 063 does.

begin;

do $seed$
declare
  v_farm uuid;
  v_home uuid;
  v_voll uuid;
  v_mill uuid;
begin
  select id into v_farm from herd.farms where name = 'Green Pastures Farm';
  if v_farm is null then
    raise exception 'Green Pastures Farm is not on file. Run 063 first.';
  end if;

  if exists (select 1 from herd.properties where farm_id = v_farm and deleted_at is null) then
    raise exception 'Green Pastures Farm already has properties. Nothing to do.';
  end if;

  insert into herd.properties (farm_id, name, code, acres, tenure, lease_ends, notes)
  values (v_farm, 'Green Pastures Home', 'GPH', 640, 'owned', null,
          'The home place. Handling facilities and the winter bale yard are here.')
  returning id into v_home;

  insert into herd.properties (farm_id, name, code, acres, tenure, lease_ends, notes)
  values (v_farm, 'The Vollmer Lease', 'VOL', 520, 'leased', '2029-03-01',
          'Five-year lease. Landlord keeps the hay off the river end.')
  returning id into v_voll;

  insert into herd.properties (farm_id, name, code, acres, tenure, lease_ends, notes)
  values (v_farm, 'The Miller Place', 'MIL', 419, 'leased', '2027-11-30',
          'Year-to-year. Water is off one well; watch it in August.')
  returning id into v_mill;

  -- Two pastures apiece, so neither level of the locator collapses on this
  -- farm and the demo shows the bar at its full depth.
  update herd.pastures set property_id = v_home, updated_at = now(), rev = rev + 1
   where farm_id = v_farm and name in ('North Pasture', 'South Pasture');

  update herd.pastures set property_id = v_voll, updated_at = now(), rev = rev + 1
   where farm_id = v_farm and name in ('Ridge Pasture', 'Timber Pasture');

  update herd.pastures set property_id = v_mill, updated_at = now(), rev = rev + 1
   where farm_id = v_farm and name in ('Creek Pasture', 'River Pasture');

  if exists (
    select 1 from herd.pastures
     where farm_id = v_farm and deleted_at is null and property_id is null
  ) then
    raise exception 'A Green Pastures pasture was left without a place. The seed names have drifted.';
  end if;
end $seed$;

commit;
