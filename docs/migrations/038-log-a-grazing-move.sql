-- 038 — log a grazing move
--
-- STATUS: run 2026-08-13
--
-- Step 2 of the grazing module. One function, because a move is two writes
-- that have to land together: the mob leaves where it was and arrives where
-- it is going, at the same instant.
--
-- Doing that from the app would mean an update and an insert with a network
-- hop between them. If the second fails the mob is *nowhere* — closed out of
-- one paddock and not in another — and the board would show five empty
-- paddocks and a herd that has vanished. Worse, `grazing_events_one_open_per_
-- group` means the reverse order cannot work either: inserting the arrival
-- first is refused while the old event is still open.
--
-- So it is a function, for the same reason `record_breeding` is one.
--
-- The exit details belong to the *outgoing* event, not the new one. Residual
-- height and utilization describe the paddock being left — they are what you
-- read off the ground as you shut the gate behind you. Putting them on the
-- arrival is the mistake this signature is shaped to prevent.

create or replace function herd.log_grazing_move(
  p_farm_id    uuid,
  p_group_id   uuid,
  p_paddock_id uuid,
  p_at         timestamptz default now(),
  -- the arrival
  p_head_count             integer default null,
  p_avg_weight_lb          numeric default null,
  p_forage_height_in_entry numeric default null,
  p_soil_moisture          text    default null,
  p_notes                  text    default null,
  p_latitude               numeric default null,
  p_longitude              numeric default null,
  -- what was left behind
  p_residual_height_in_exit numeric default null,
  p_utilization_pct         numeric default null
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

  select * into v_open
    from grazing_events
   where group_id = p_group_id and exited_at is null and deleted_at is null
   limit 1;

  if found then
    if v_open.paddock_id = p_paddock_id then
      raise exception 'They are already in that paddock.';
    end if;

    -- A move cannot predate the arrival it is ending. Without this the
    -- outgoing event gets an exit before its entry, which the table's own
    -- check would refuse anyway — but with a message about a constraint
    -- rather than about the herd.
    if p_at < v_open.entered_at then
      raise exception 'They arrived where they are on %, which is after %.',
        to_char(v_open.entered_at, 'Mon FMDD YYYY'), to_char(p_at, 'Mon FMDD YYYY');
    end if;

    update grazing_events
       set exited_at = p_at,
           -- Only overwrite where something was given: a move logged in a
           -- hurry should not blank a residual height entered earlier.
           residual_height_in_exit = coalesce(p_residual_height_in_exit, residual_height_in_exit),
           utilization_pct         = coalesce(p_utilization_pct, utilization_pct),
           updated_by = auth.uid(),
           updated_at = now(),
           rev = rev + 1
     where id = v_open.id;
  end if;

  insert into grazing_events (
    farm_id, paddock_id, group_id, entered_at,
    head_count, avg_weight_lb, forage_height_in_entry, soil_moisture,
    notes, latitude, longitude, created_by, updated_by
  ) values (
    p_farm_id, p_paddock_id, p_group_id, p_at,
    p_head_count, p_avg_weight_lb, p_forage_height_in_entry, p_soil_moisture,
    coalesce(p_notes, ''), p_latitude, p_longitude, auth.uid(), auth.uid()
  )
  returning id into v_new_id;

  return v_new_id;
end;
$function$;

revoke all on function herd.log_grazing_move(uuid, uuid, uuid, timestamptz, integer, numeric, numeric, text, text, numeric, numeric, numeric, numeric) from public;
grant execute on function herd.log_grazing_move(uuid, uuid, uuid, timestamptz, integer, numeric, numeric, text, text, numeric, numeric, numeric, numeric) to authenticated;

-- ── ending a grazing without starting another ──────────────────────────
--
-- Taking the mob off pasture entirely — onto a holding area, into the barn
-- for the winter — is a close with no arrival. Separate from the move so
-- that "where are they now" has an honest answer of "nowhere on pasture"
-- rather than a paddock they are not in.

create or replace function herd.end_grazing(
  p_farm_id  uuid,
  p_group_id uuid,
  p_at       timestamptz default now(),
  p_residual_height_in_exit numeric default null,
  p_utilization_pct         numeric default null
)
returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_open grazing_events%rowtype;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  select * into v_open
    from grazing_events
   where group_id = p_group_id and exited_at is null and deleted_at is null
   limit 1;

  if not found then
    raise exception 'They are not on pasture.';
  end if;

  if p_at < v_open.entered_at then
    raise exception 'They arrived on %, which is after %.',
      to_char(v_open.entered_at, 'Mon FMDD YYYY'), to_char(p_at, 'Mon FMDD YYYY');
  end if;

  update grazing_events
     set exited_at = p_at,
         residual_height_in_exit = coalesce(p_residual_height_in_exit, residual_height_in_exit),
         utilization_pct         = coalesce(p_utilization_pct, utilization_pct),
         updated_by = auth.uid(),
         updated_at = now(),
         rev = rev + 1
   where id = v_open.id;

  return v_open.id;
end;
$function$;

revoke all on function herd.end_grazing(uuid, uuid, timestamptz, numeric, numeric) from public;
grant execute on function herd.end_grazing(uuid, uuid, timestamptz, numeric, numeric) to authenticated;
