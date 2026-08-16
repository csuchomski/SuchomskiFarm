-- 047 — correcting the record: edit and delete a grazing move
--
-- STATUS: run 2026-08-16
--
-- Everything logged from a phone in a wet gateway is logged wrong sometimes:
-- the destination picked one row off, the wire read at 40% when it went to
-- 45%, the time stamped at the house an hour later than the gate. Until now
-- the record could only be added to, which meant a wrong move stayed wrong.
--
-- Two things make this more than an UPDATE from the client.
--
-- **A move is a boundary, not a point.** `log_grazing_move` closes the open
-- event at the very instant it opens the next, so every consecutive pair
-- shares a timestamp exactly. Moving one side of that seal without the other
-- tears a hole in the record — either a gap where the mob was nowhere, or an
-- overlap where they were in two paddocks at once. Both sides have to move
-- together, which is one transaction.
--
-- **Deleting the open event leaves the mob nowhere.** The same problem 038
-- was written for, in reverse: soft-delete the row they are standing in and
-- `whereIs` returns null, the board empties and the herd vanishes. So a
-- delete of the open event reopens the one before it — they never left.
--
-- A note on what edit does *not* take. A move has one time: when they
-- arrived. Its exit is the next move's arrival, the same instant seen from
-- the other side. So `p_exited_at` is only honoured on the last event in the
-- chain, where there is no next move to speak for it; anywhere else the
-- function refuses and says which move to edit instead. One boundary, one
-- place to edit it.

-- ── editing ───────────────────────────────────────────────────────────────

create or replace function herd.edit_grazing_move(
  p_farm_id  uuid,
  p_event_id uuid,
  p_paddock_id uuid,
  p_entered_at timestamptz,
  -- Only honoured when nothing follows this move. See above.
  p_exited_at  timestamptz default null,
  p_head_count             integer default null,
  p_avg_weight_lb          numeric default null,
  p_forage_height_in_entry numeric default null,
  p_residual_height_in_exit numeric default null,
  p_utilization_pct         numeric default null,
  p_soil_moisture          text    default null,
  p_notes                  text    default null,
  p_swept_from             numeric default null,
  p_swept_to               numeric default null
)
returns void
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_ev   grazing_events%rowtype;
  v_prev grazing_events%rowtype;
  v_next grazing_events%rowtype;
  v_sealed_before boolean;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  select * into v_ev
    from grazing_events
   where id = p_event_id and farm_id = p_farm_id and deleted_at is null;
  if not found then
    raise exception 'That move is not on this farm, or has already been deleted.';
  end if;

  if not exists (
    select 1 from paddocks where id = p_paddock_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That paddock is not on this farm.';
  end if;

  if (p_swept_from is null) <> (p_swept_to is null) then
    raise exception 'A strip needs both ends of the wire, or neither.';
  end if;

  if p_swept_from is not null and p_swept_from > p_swept_to then
    raise exception 'The wire cannot finish behind where it started.';
  end if;

  -- The moves either side, by time, within the same mob's chain.
  select * into v_prev
    from grazing_events
   where group_id = v_ev.group_id and deleted_at is null and entered_at < v_ev.entered_at
   order by entered_at desc limit 1;

  select * into v_next
    from grazing_events
   where group_id = v_ev.group_id and deleted_at is null and entered_at > v_ev.entered_at
   order by entered_at asc limit 1;

  -- ── the arrival, and the seal behind it ────────────────────────────────
  if v_prev.id is not null then
    if p_entered_at <= v_prev.entered_at then
      raise exception 'They cannot arrive on % — that is before or at the move that put them where they were, on %.',
        to_char(p_entered_at, 'Mon FMDD YYYY HH24:MI'),
        to_char(v_prev.entered_at, 'Mon FMDD YYYY HH24:MI');
    end if;

    -- Sealed means the previous move's exit *is* this move's arrival: the two
    -- sides of one boundary. Drag it along. Where there is already a gap, the
    -- gap is a fact about the record and is left alone — but the arrival still
    -- cannot reach back into the previous stay.
    v_sealed_before := v_prev.exited_at = v_ev.entered_at;
    if v_sealed_before then
      update grazing_events
         set exited_at = p_entered_at,
             updated_by = auth.uid(), updated_at = now(), rev = rev + 1
       where id = v_prev.id;
    elsif v_prev.exited_at is not null and p_entered_at < v_prev.exited_at then
      raise exception 'They cannot arrive on % — they were still in the paddock before until %.',
        to_char(p_entered_at, 'Mon FMDD YYYY HH24:MI'),
        to_char(v_prev.exited_at, 'Mon FMDD YYYY HH24:MI');
    end if;
  end if;

  -- ── the departure ──────────────────────────────────────────────────────
  if v_next.id is not null then
    -- The next move owns this boundary. Follow its arrival rather than take
    -- an argument for it, so the two can never be told different things.
    if p_entered_at >= v_next.entered_at then
      raise exception 'They cannot arrive on % — they had already moved on by %.',
        to_char(p_entered_at, 'Mon FMDD YYYY HH24:MI'),
        to_char(v_next.entered_at, 'Mon FMDD YYYY HH24:MI');
    end if;

    if p_exited_at is not null and p_exited_at <> v_ev.exited_at then
      raise exception 'This move ends where the next one begins. Edit the move on % to change that.',
        to_char(v_next.entered_at, 'Mon FMDD YYYY HH24:MI');
    end if;
  else
    -- Nothing follows: the exit is this event's own to state, including
    -- clearing it to put the mob back on the grass.
    if p_exited_at is not null and p_exited_at < p_entered_at then
      raise exception 'They cannot leave before they arrive.';
    end if;

    if p_exited_at is null and v_ev.exited_at is not null and exists (
      select 1 from grazing_events
       where group_id = v_ev.group_id and deleted_at is null
         and exited_at is null and id <> v_ev.id
    ) then
      raise exception 'The mob is already standing somewhere else. Close that move before reopening this one.';
    end if;
  end if;

  -- ── the wire, against the neighbours in the same ground ────────────────
  -- Only where the sweep actually continues: a different paddock either side
  -- is a different sweep, and says nothing about where this wire may sit.
  if p_swept_from is not null then
    if v_prev.id is not null and v_prev.paddock_id = p_paddock_id
       and v_prev.swept_to is not null and p_swept_from < v_prev.swept_to - 0.0001 then
      raise exception 'That strip goes back over ground grazed earlier in the same pass — the wire before it was at %%%.',
        round(v_prev.swept_to * 100);
    end if;

    if v_next.id is not null and v_next.paddock_id = p_paddock_id
       and v_next.swept_from is not null and p_swept_to > v_next.swept_from + 0.0001 then
      raise exception 'That strip runs past the wire that comes after it, at %%%.',
        round(v_next.swept_from * 100);
    end if;
  end if;

  update grazing_events
     set paddock_id = p_paddock_id,
         entered_at = p_entered_at,
         exited_at  = case when v_next.id is not null then v_ev.exited_at else p_exited_at end,
         head_count = p_head_count,
         avg_weight_lb = p_avg_weight_lb,
         forage_height_in_entry = p_forage_height_in_entry,
         residual_height_in_exit = p_residual_height_in_exit,
         utilization_pct = p_utilization_pct,
         soil_moisture = p_soil_moisture,
         notes = coalesce(p_notes, ''),
         swept_from = p_swept_from,
         swept_to   = p_swept_to,
         updated_by = auth.uid(), updated_at = now(), rev = rev + 1
   where id = p_event_id;
end;
$$;

revoke all on function herd.edit_grazing_move(
  uuid, uuid, uuid, timestamptz, timestamptz, integer, numeric, numeric,
  numeric, numeric, text, text, numeric, numeric) from public;
grant execute on function herd.edit_grazing_move(
  uuid, uuid, uuid, timestamptz, timestamptz, integer, numeric, numeric,
  numeric, numeric, text, text, numeric, numeric) to authenticated;

-- ── deleting ──────────────────────────────────────────────────────────────

create or replace function herd.delete_grazing_move(
  p_farm_id  uuid,
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_ev   grazing_events%rowtype;
  v_prev grazing_events%rowtype;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  select * into v_ev
    from grazing_events
   where id = p_event_id and farm_id = p_farm_id and deleted_at is null;
  if not found then
    raise exception 'That move is not on this farm, or has already been deleted.';
  end if;

  select * into v_prev
    from grazing_events
   where group_id = v_ev.group_id and deleted_at is null and entered_at < v_ev.entered_at
   order by entered_at desc limit 1;

  -- Out first. The open-per-group index counts live rows, so the row being
  -- removed has to stop being open before another one is allowed to be.
  update grazing_events
     set deleted_at = now(), updated_by = auth.uid(), updated_at = now(), rev = rev + 1
   where id = p_event_id;

  -- Undoing the move they are standing in puts them back where they came
  -- from: it says the departure never happened. Only for the open event —
  -- deleting a closed one in the middle of the chain leaves a gap, and a gap
  -- is the truth. Filling it by stretching the previous stay would claim the
  -- mob was somewhere no one recorded them.
  --
  -- The residual height on the reopened event stays. It was read off the
  -- ground as they walked out, and it is still what the grass measured that
  -- day; the move being undone is where they went next, not what was left
  -- behind. Clearing it would throw away a measurement to tidy a field.
  if v_ev.exited_at is null and v_prev.id is not null then
    update grazing_events
       set exited_at = null,
           updated_by = auth.uid(), updated_at = now(), rev = rev + 1
     where id = v_prev.id;
  end if;
end;
$$;

revoke all on function herd.delete_grazing_move(uuid, uuid) from public;
grant execute on function herd.delete_grazing_move(uuid, uuid) to authenticated;

-- A whole round, which is a derived thing — there is no rotations table, only
-- the moves that make one up. Newest first, so each delete's repair is undone
-- in turn by the next and the mob ends up where they stood before the round
-- began, rather than in the middle of a round that no longer exists.
create or replace function herd.delete_grazing_moves(
  p_farm_id   uuid,
  p_event_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  for v_id in
    select e.id from grazing_events e
     where e.id = any(p_event_ids) and e.farm_id = p_farm_id and e.deleted_at is null
     order by e.entered_at desc
  loop
    perform delete_grazing_move(p_farm_id, v_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function herd.delete_grazing_moves(uuid, uuid[]) from public;
grant execute on function herd.delete_grazing_moves(uuid, uuid[]) to authenticated;
