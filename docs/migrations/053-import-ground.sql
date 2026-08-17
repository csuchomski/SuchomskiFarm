-- 053 — a pasture's boundary, and importing a whole one at once
--
-- STATUS: run 2026-08-17
--
-- 040 measured this farm off a KML the owner drew, and it settled real
-- questions: the five units run 1.375 to 2.255 acres where every one of them
-- had been carrying a flat 1.91, and a strip's acreage is a fraction of its
-- unit's. That work was done by hand, offline, by somebody with a Python
-- interpreter. This is the same road, opened to the farm.
--
-- Two things are added.
--
-- **`pastures.boundary`.** Paddocks have carried GeoJSON since 040; pastures
-- were born without it in 052 because nothing could draw one yet. A KML gives
-- the outer piece of land as readily as the subdivisions, and the pasture is
-- the shape that gives the map its frame.
--
-- **`import_ground`.** A pasture and its paddocks in one call, because an
-- import is one decision. Done as separate `save_pasture` and `save_paddock`
-- calls from the client, a name clash on the fourth paddock leaves three
-- paddocks and a pasture on the farm and an error on the screen, and the
-- farmer has to work out what landed and undo it by hand. This either takes
-- the lot or takes none of it.
--
-- The existing `save_pasture` and `save_paddock` are deliberately left alone.
-- Adding `p_boundary` to them would have meant that every ordinary edit — a
-- name, a rotation number — carried a boundary argument, and the day one of
-- those calls passed null by omission it would erase geometry nobody could
-- get back without the original file. Import writes boundaries; the forms
-- write everything else.

alter table herd.pastures add column if not exists boundary jsonb;

-- ── one pasture and its paddocks, atomically ──────────────────────────────
--
-- The payload is the shape the review screen produces:
--
--   {
--     "pasture":  { "id": null, "name": "...", "code": null, "acres": 9.53,
--                   "notes": null, "boundary": { GeoJSON Polygon } },
--     "paddocks": [ { "name": "...", "code": null,
--                     "acresMeasured": 2.003, "acresGrazable": null,
--                     "sweepHeadingDeg": null, "sweepLengthFt": 533,
--                     "rotationOrder": 1, "boundary": { GeoJSON Polygon } } ]
--   }
--
-- A `pasture.id` that is already on this farm adds the paddocks to it and
-- updates nothing else about it — importing a second file of subdivisions
-- into land already on file is a normal thing to want, and it should not
-- rewrite the name somebody typed.
--
-- jsonb rather than arrays of scalars: the alternative is fourteen parallel
-- arrays that must stay the same length, and the first ragged one writes a
-- paddock's acres onto its neighbour.

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

comment on function herd.import_ground(uuid, jsonb) is
  'A pasture and its paddocks in one transaction, from a drawn file. All or nothing: a clash on the last paddock leaves the farm as it was.';
