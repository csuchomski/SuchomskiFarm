-- 039 — strip grazing: the wire as a position, not a polygon
--
-- STATUS: run 2026-08-13
--
-- The farm strip-grazes: a wire moved daily, sometimes twice, cutting a
-- fresh strip out of one of the five semi-permanent units. Strip widths
-- follow the forage, so they differ every time, and next pass the wire lands
-- nowhere near where it landed last pass.
--
-- The model built in 036/038 could not hold that. It treats a paddock as a
-- place with a rest clock, which is right for five fixed units and wrong for
-- a strip: a strip exists for a day, never recurs, and has no rest to speak
-- of. Making each strip a paddock row would mean two hundred rows a season,
-- each grazed once, each carrying a meaningless rest figure — and no way to
-- compare passes, because this pass's divisions do not line up with last
-- pass's.
--
-- What makes this tractable is a fact about the farm rather than about
-- software: **each unit is swept in one fixed direction.** P1 east to west,
-- P2 west to east, P3 east to west, P4 west to east, P5 south to north — a
-- serpentine that leaves the mob where the next unit begins.
--
-- With a fixed heading, the wire is a single number: how far along the sweep
-- it sits. A strip is the interval between the last wire and this one. So:
--
--   * capture is one scalar, not a drawn polygon;
--   * the strip's acres are a fraction of the unit's acres, which works
--     today, with no coordinates and no map;
--   * "when was this ground last grazed" is an interval query in one
--     dimension — intervals may overlap freely between passes, which is
--     exactly the case that had no answer before.
--
-- Nothing here needs PostGIS, a grid, or geometry of any kind. Geometry
-- remains welcome when the KML arrives — it makes the map drawable — but it
-- is no longer load-bearing.

-- ── the sweep, on the unit ─────────────────────────────────────────────

alter table herd.paddocks
  -- Compass bearing the mob advances toward: 0 N, 90 E, 180 S, 270 W.
  -- Degrees rather than an enum so a diagonal sweep needs no migration, and
  -- so the heading can be projected onto real geometry later.
  add column if not exists sweep_heading_deg numeric,
  -- How far it is across the unit along that heading. Optional: the strip
  -- arithmetic runs on fractions and acres without it. Its only job is to
  -- let the app say "the wire is 120 feet in", which is how a person
  -- standing at the gate thinks.
  add column if not exists sweep_length_ft numeric;

alter table herd.paddocks
  drop constraint if exists paddocks_sweep_heading_range;
alter table herd.paddocks
  add constraint paddocks_sweep_heading_range check (
    sweep_heading_deg is null or (sweep_heading_deg >= 0 and sweep_heading_deg < 360)
  );

alter table herd.paddocks
  drop constraint if exists paddocks_sweep_length_positive;
alter table herd.paddocks
  add constraint paddocks_sweep_length_positive check (
    sweep_length_ft is null or sweep_length_ft > 0
  );

-- ── the strip, on the grazing ──────────────────────────────────────────

alter table herd.grazing_events
  -- Where along the sweep this strip began and ended, as a fraction of the
  -- unit. Null on both means the whole unit was grazed at once, which is
  -- still a legitimate move and is what every event written before today is.
  add column if not exists swept_from numeric,
  add column if not exists swept_to   numeric;

alter table herd.grazing_events
  drop constraint if exists grazing_events_sweep_range;
alter table herd.grazing_events
  add constraint grazing_events_sweep_range check (
    (swept_from is null and swept_to is null)
    or (
      swept_from is not null and swept_to is not null
      and swept_from >= 0 and swept_to <= 1 and swept_to > swept_from
    )
  );

comment on column herd.grazing_events.swept_from is
  'Fraction along the unit''s sweep where this strip starts. Null means the whole unit.';
comment on column herd.grazing_events.swept_to is
  'Fraction along the unit''s sweep where this strip ends — where the wire was put.';

-- `boundary_override` was added for virtual-fence units, on the assumption
-- that a per-grazing shape was the exception. Under strip grazing it is the
-- norm, and it is not an override of anything: it is the shape actually
-- grazed. Renamed while the column is still empty and free to rename.
alter table herd.grazing_events
  rename column boundary_override to grazed_shape;

comment on column herd.grazing_events.grazed_shape is
  'GeoJSON of the ground actually grazed, when it is known. Optional: for a strip the shape is derivable from the unit boundary, the sweep heading and swept_from/swept_to.';

create index if not exists grazing_events_paddock_sweep_idx
  on herd.grazing_events (paddock_id, swept_from)
  where deleted_at is null and swept_from is not null;

-- ── moving the wire ────────────────────────────────────────────────────
--
-- Replaces the 038 signature. Two things change beyond the new arguments.
--
-- **A move into the same paddock is now normal.** 038 refused it — right
-- when a paddock was a place you occupy whole, wrong when the mob spends a
-- fortnight crossing one unit a strip at a time. It is refused only when the
-- strip does not advance, which is the case that means somebody has entered
-- the wrong number.
--
-- **A strip may not overlap the strip before it in the same pass.** Grazing
-- ground you have just grazed is what the back fence exists to prevent, so a
-- `swept_from` behind the last `swept_to` is a mistake worth catching rather
-- than a record worth keeping.

create or replace function herd.log_grazing_move(
  p_farm_id    uuid,
  p_group_id   uuid,
  p_paddock_id uuid,
  p_at         timestamptz default now(),
  p_head_count             integer default null,
  p_avg_weight_lb          numeric default null,
  p_forage_height_in_entry numeric default null,
  p_soil_moisture          text    default null,
  p_notes                  text    default null,
  p_latitude               numeric default null,
  p_longitude              numeric default null,
  p_residual_height_in_exit numeric default null,
  p_utilization_pct         numeric default null,
  -- the wire
  p_swept_from numeric default null,
  p_swept_to   numeric default null
)
returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_open   grazing_events%rowtype;
  v_new_id uuid;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  if not exists (
    select 1 from paddocks where id = p_paddock_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That paddock is not on this farm.';
  end if;

  if not exists (
    select 1 from grazing_groups where id = p_group_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That group is not on this farm.';
  end if;

  if (p_swept_from is null) <> (p_swept_to is null) then
    raise exception 'A strip needs both ends of the wire, or neither.';
  end if;

  select * into v_open
    from grazing_events
   where group_id = p_group_id and exited_at is null and deleted_at is null
   limit 1;

  if found then
    if p_at < v_open.entered_at then
      raise exception 'They arrived where they are on %, which is after %.',
        to_char(v_open.entered_at, 'Mon FMDD YYYY'), to_char(p_at, 'Mon FMDD YYYY');
    end if;

    if v_open.paddock_id = p_paddock_id then
      -- Same unit: this is the next strip, so it has to move forward.
      if p_swept_from is null or v_open.swept_to is null then
        raise exception 'They are already in that paddock. Say where the wire went to cut the next strip.';
      end if;

      if p_swept_from < v_open.swept_to - 0.0001 then
        raise exception 'That strip goes back over ground they have just grazed — the last wire was at % percent.',
          round(v_open.swept_to * 100);
      end if;
    end if;

    update grazing_events
       set exited_at = p_at,
           residual_height_in_exit = coalesce(p_residual_height_in_exit, residual_height_in_exit),
           utilization_pct         = coalesce(p_utilization_pct, utilization_pct),
           updated_by = auth.uid(), updated_at = now(), rev = rev + 1
     where id = v_open.id;
  end if;

  insert into grazing_events (
    farm_id, paddock_id, group_id, entered_at,
    head_count, avg_weight_lb, forage_height_in_entry, soil_moisture,
    notes, latitude, longitude, swept_from, swept_to, created_by, updated_by
  ) values (
    p_farm_id, p_paddock_id, p_group_id, p_at,
    p_head_count, p_avg_weight_lb, p_forage_height_in_entry, p_soil_moisture,
    coalesce(p_notes, ''), p_latitude, p_longitude, p_swept_from, p_swept_to,
    auth.uid(), auth.uid()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$function$;

-- The 038 signature is now a shadow of this one and would be picked by any
-- call that omits the wire. Dropped so there is exactly one.
drop function if exists herd.log_grazing_move(
  uuid, uuid, uuid, timestamptz, integer, numeric, numeric, text, text, numeric, numeric, numeric, numeric
);

revoke all on function herd.log_grazing_move(
  uuid, uuid, uuid, timestamptz, integer, numeric, numeric, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) from public;
grant execute on function herd.log_grazing_move(
  uuid, uuid, uuid, timestamptz, integer, numeric, numeric, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated;

-- ── this farm's sweep ──────────────────────────────────────────────────
--
-- A serpentine, so the mob finishes each unit where the next one starts.

update herd.paddocks set sweep_heading_deg = 270 where name = 'Paddock 1' and deleted_at is null;  -- east to west
update herd.paddocks set sweep_heading_deg =  90 where name = 'Paddock 2' and deleted_at is null;  -- west to east
update herd.paddocks set sweep_heading_deg = 270 where name = 'Paddock 3' and deleted_at is null;  -- east to west
update herd.paddocks set sweep_heading_deg =  90 where name = 'Paddock 4' and deleted_at is null;  -- west to east
update herd.paddocks set sweep_heading_deg =   0 where name = 'Paddock 5' and deleted_at is null;  -- south to north
