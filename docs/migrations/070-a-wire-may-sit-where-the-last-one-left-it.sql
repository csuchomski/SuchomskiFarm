-- 070 — a wire may sit where the last one left it
--
-- STATUS: not yet run
--
-- Reported from the field: editing nothing but the date on a move is refused
-- with
--
--   That strip goes back over ground grazed earlier in the same pass —
--   the wire before it was at %38.
--
-- Two faults in one line, and a third behind them.
--
-- ── One: the guard is ten times tighter than the numbers it judges ────────
--
-- 047 lets a strip start up to 0.0001 behind the one before it — a hundredth
-- of a percentage point. The editor shows a wire to a tenth of a percentage
-- point, because nobody reads a paddock as 0.5191121495327102, so the coarsest
-- honest figure a person can put back is 0.001 away from the stored one. The
-- form could not express a value the function would accept.
--
-- On the farm this came from, the wires sit at 0.8211121495327103,
-- 0.6745046728971962, 0.5191121495327102 — sweep fractions worked out from
-- acres, not typed. Better than half of them round the wrong way.
--
-- The tolerance becomes 0.001, matching what the form can say. It is still a
-- guard: a wire genuinely dragged backwards moves by whole percentage points,
-- not by a tenth of one.
--
-- ── Two: the message prints the percent sign on the wrong side ────────────
--
-- `raise` reads `%%` as a literal percent and `%` as the next argument, left
-- to right — so `%%%` is "%" then the value, and 38 percent printed as "%38".
-- Three percent signs cannot produce the other order; the sign goes into the
-- argument instead.
--
-- ── Three, and the reason this was worth chasing ──────────────────────────
--
-- The error named a figure identical to the one in the box. Someone reading
-- "the wire before it was at 38" while looking at a field reading 38 has no
-- move left to make. A guard that refuses a value it cannot distinguish from
-- the one it wants is worse than no guard.
--
-- The app-side half of this ships separately and independently: the editor
-- now sends back the fraction it was given whenever nobody touched the box,
-- so an untouched wire is bit-for-bit what it was. This migration is what
-- makes a *typed* percentage work too — type 52 against a stored 0.5191 and
-- 047 refuses it.

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
  -- What the form can actually say: the wire is shown and taken to a
  -- tenth of a percentage point, so two fractions closer together than
  -- this are the same wire to anyone entering one.
  c_slack constant numeric := 0.001;
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
       and v_prev.swept_to is not null and p_swept_from < v_prev.swept_to - c_slack then
      raise exception 'That strip goes back over ground grazed earlier in the same pass — the wire before it was at %.',
        round(v_prev.swept_to * 100, 1) || '%';
    end if;

    if v_next.id is not null and v_next.paddock_id = p_paddock_id
       and v_next.swept_from is not null and p_swept_to > v_next.swept_from + c_slack then
      raise exception 'That strip runs past the wire that comes after it, at %.',
        round(v_next.swept_from * 100, 1) || '%';
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

-- ── What this does NOT change ─────────────────────────────────────────────
--
-- 039's `log_grazing_move` guards a new strip against the one standing open
-- with the same 0.0001, and its wire box takes the same tenth of a
-- percentage point — so a typed figure can be refused there for exactly this
-- reason. It is left alone here on purpose: it is a long function, this is
-- one line inside it, and it wants the same treatment as above — its own
-- text, edited in one place, rehearsed in a rolled-back transaction first.
-- Logging is the less likely path to hit it, because the figure typed there
-- is a fresh one rather than a stored fraction handed back.
