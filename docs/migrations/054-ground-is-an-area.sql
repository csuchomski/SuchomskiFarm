-- 054 — ground is an area, and the database says so too
--
-- STATUS: run 2026-08-18
--
-- A farm was set up through the KML import with three of its paddocks
-- carrying a `LineString` boundary: the fence lines from the drawing, marked
-- as paddocks on the review screen because the screen let them be.
--
-- Nothing failed. `asPolygonRing` returns null for anything that is not a
-- Polygon, so those paddocks were dropped from the map's projection, measured
-- no acres, and cut no strips — and the Move page, finding no ring anywhere on
-- the farm, said "No boundaries on file, so there is nothing to draw on."
-- The rows looked fine in the list. They were simply never drawn again.
--
-- The review screen no longer offers a role to a line or a marker, which is
-- the fix people will actually meet. This is the one behind it: a boundary
-- that reaches `import_ground` has to be a Polygon with a ring in it, whatever
-- the client believes. Geometry that cannot be drawn should not be storable,
-- because the failure it causes is silent and arrives days later.
--
-- Deliberately *not* retro-active. The three rows already written are left
-- exactly as they are: deciding what becomes of somebody's records is theirs
-- to do, from Settings → Ground, where removing a paddock with no moves on it
-- already works.

-- What the app can draw: a Polygon whose outer ring has enough points to
-- enclose anything. Mirrors `asPolygonRing` in lib/pasture-map.ts, which is
-- the function that actually decides whether a boundary is ever seen.
create or replace function herd.is_drawable_area(geo jsonb)
returns boolean
language sql
immutable
as $$
  select geo is not null
     and jsonb_typeof(geo) = 'object'
     and geo ->> 'type' = 'Polygon'
     and jsonb_typeof(geo -> 'coordinates') = 'array'
     and jsonb_typeof(geo -> 'coordinates' -> 0) = 'array'
     and jsonb_array_length(geo -> 'coordinates' -> 0) >= 4;
$$;

create or replace function herd.import_ground(
  p_farm_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_pasture jsonb := p_payload -> 'pasture';
  v_rows    jsonb := coalesce(p_payload -> 'paddocks', '[]'::jsonb);
  v_pasture_id uuid;
  v_name    text;
  v_clash   text;
  v_row     jsonb;
  v_count   integer := 0;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;
  if v_pasture is null then
    raise exception 'An import needs a pasture to put the paddocks on.';
  end if;
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'The paddocks have to arrive as a list.';
  end if;

  -- ── the pasture ────────────────────────────────────────────────────────
  v_pasture_id := nullif(v_pasture ->> 'id', '')::uuid;

  if (v_pasture -> 'boundary') is not null
     and jsonb_typeof(v_pasture -> 'boundary') <> 'null'
     and not is_drawable_area(v_pasture -> 'boundary') then
    raise exception 'A pasture boundary has to be an area, and %.',
      case when v_pasture -> 'boundary' ->> 'type' = 'Polygon'
           then 'that one has too few points to enclose anything'
           else 'that one is a ' || coalesce(v_pasture -> 'boundary' ->> 'type', 'shape of some other kind') end;
  end if;

  if v_pasture_id is not null then
    -- Adding to land already on file. Left exactly as it is, apart from a
    -- boundary where it had none — that is new information, not a rewrite.
    if not exists (
      select 1 from pastures where id = v_pasture_id and farm_id = p_farm_id and deleted_at is null
    ) then
      raise exception 'That pasture is not on this farm.';
    end if;

    update pastures
       set boundary   = coalesce(boundary, v_pasture -> 'boundary'),
           updated_at = now(), updated_by = auth.uid(), rev = rev + 1
     where id = v_pasture_id;
  else
    v_name := btrim(coalesce(v_pasture ->> 'name', ''));
    if v_name = '' then
      raise exception 'A pasture needs a name.';
    end if;

    select name into v_clash from pastures
     where farm_id = p_farm_id and deleted_at is null and lower(name) = lower(v_name)
     limit 1;
    if v_clash is not null then
      raise exception 'This farm already has a pasture called %. Import into it by picking it on the review screen.', v_clash;
    end if;

    insert into pastures (farm_id, name, code, acres, notes, boundary, created_by, updated_by)
    values (
      p_farm_id, v_name,
      nullif(btrim(coalesce(v_pasture ->> 'code', '')), ''),
      (v_pasture ->> 'acres')::numeric,
      nullif(btrim(coalesce(v_pasture ->> 'notes', '')), ''),
      v_pasture -> 'boundary',
      auth.uid(), auth.uid()
    )
    returning id into v_pasture_id;
  end if;

  -- ── its paddocks ───────────────────────────────────────────────────────
  for v_row in select * from jsonb_array_elements(v_rows)
  loop
    v_name := btrim(coalesce(v_row ->> 'name', ''));
    if v_name = '' then
      raise exception 'Every paddock in the file needs a name. Name it on the review screen, or leave it out.';
    end if;

    -- The check this migration exists for. A paddock with a line for a
    -- boundary is invisible to every map and every acre of arithmetic.
    if (v_row -> 'boundary') is not null
       and jsonb_typeof(v_row -> 'boundary') <> 'null'
       and not is_drawable_area(v_row -> 'boundary') then
      raise exception '% cannot be a paddock: %. Fences and gates have to be left out.',
        v_name,
        case when v_row -> 'boundary' ->> 'type' = 'Polygon'
             then 'its outline has too few points to enclose anything'
             else 'a ' || coalesce(v_row -> 'boundary' ->> 'type', 'shape of that kind') || ' is not an area' end;
    end if;

    -- Checked one at a time inside the loop so the message names the paddock
    -- that clashed, and so two rows in the same file that share a name are
    -- caught as well — the unique index would catch the second, but only
    -- after the first had been written.
    select name into v_clash from paddocks
     where farm_id = p_farm_id and deleted_at is null and lower(name) = lower(v_name)
     limit 1;
    if v_clash is not null then
      raise exception 'This farm already has a paddock called %. Nothing was imported.', v_clash;
    end if;

    if (v_row ->> 'rotationOrder') is not null then
      select name into v_clash from paddocks
       where farm_id = p_farm_id and deleted_at is null
         and rotation_order = (v_row ->> 'rotationOrder')::integer
       limit 1;
      if v_clash is not null then
        raise exception '% is already number % in the rotation. Nothing was imported.',
          v_clash, (v_row ->> 'rotationOrder')::integer;
      end if;
    end if;

    insert into paddocks (
      farm_id, pasture_id, name, code, acres_measured, acres_grazable, unit_type,
      rotation_order, sweep_heading_deg, sweep_length_ft, boundary, created_by, updated_by
    ) values (
      p_farm_id, v_pasture_id, v_name,
      nullif(btrim(coalesce(v_row ->> 'code', '')), ''),
      (v_row ->> 'acresMeasured')::numeric,
      (v_row ->> 'acresGrazable')::numeric,
      coalesce(nullif(v_row ->> 'unitType', ''), 'permanent'),
      (v_row ->> 'rotationOrder')::integer,
      (v_row ->> 'sweepHeadingDeg')::numeric,
      (v_row ->> 'sweepLengthFt')::numeric,
      v_row -> 'boundary',
      auth.uid(), auth.uid()
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('pastureId', v_pasture_id, 'paddocks', v_count);
end;
$$;

revoke all on function herd.import_ground(uuid, jsonb) from public;
grant execute on function herd.import_ground(uuid, jsonb) to authenticated;
