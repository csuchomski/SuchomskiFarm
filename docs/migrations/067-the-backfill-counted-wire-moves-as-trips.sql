-- 067 — the backfill counted wire moves as trips round
--
-- STATUS: run 2026-09-01
--
-- 066's backfill is wrong, and wrong in the way that matters most on a farm
-- that strip-grazes — which is every farm this app is for.
--
-- ── What it did ───────────────────────────────────────────────────────────
--
-- The app collapses consecutive moves in the same paddock into a **stay**:
-- fourteen wire moves across Paddock 1 over a fortnight are one visit, not
-- fourteen. `staysFrom` does that, and `rotationRounds` always applied the
-- repeat rule to stays.
--
-- The backfill applied it to raw events instead. So the second wire move
-- inside a paddock looked like walking back into somewhere already grazed,
-- and opened a new round. Every strip became a trip round the farm.
--
-- Measured on Golden Acres — one mob, one pasture, fourteen moves that are
-- really two paddock visits (five strips off Paddock 5, then nine off Paddock
-- 1): **13 rounds, averaging 1.14 paddocks each.** That is a round per wire
-- move, which is not a round at all.
--
-- It went unnoticed because the demo seeds log one event per paddock rather
-- than stripping, so Green Pastures came out at 7.41 paddocks per round —
-- right, and hiding the defect.
--
-- ── What this does ────────────────────────────────────────────────────────
--
-- Clears the derived rounds and reads the history again, over stays.
--
-- **Only derived rows go.** A round the farm started or corrected is its own
-- record and is never touched here; at the time of writing there are none,
-- but this must stay true if 067 is ever re-run.
--
-- The stay rule matches the app's exactly, because two answers to "is this
-- one visit or two" is how the record starts disagreeing with itself:
-- consecutive events, same paddock, and no more than an hour between one
-- leaving and the next arriving. `log_grazing_move` closes and opens in the
-- same instant; the hour absorbs a hand-edited timestamp without swallowing
-- a genuine return, which is always days away.

begin;

-- Hard delete rather than soft: these are rows 066 wrote by mistake this
-- week, not anybody's record of anything. Soft-deleting them would leave 75
-- tombstones for a thing that never happened.
delete from herd.grazing_rounds where derived;

do $backfill$
declare
  r         record;
  v_seen    uuid[] := array[]::uuid[];
  v_group   uuid   := null;
  v_pasture uuid   := null;
  v_first   boolean := true;
  v_written integer := 0;
begin
  if exists (select 1 from herd.grazing_rounds where derived and deleted_at is null) then
    raise exception 'Derived rounds still present. This reads history once; clear them first.';
  end if;

  for r in
    with ev as (
      select e.id, e.farm_id, e.group_id, p.pasture_id, e.paddock_id,
             e.entered_at, e.exited_at
        from herd.grazing_events e
        join herd.paddocks p on p.id = e.paddock_id
       where e.deleted_at is null
    ),
    -- A stay starts wherever the mob arrives somewhere it was not already.
    -- Partitioned by mob only, matching `staysFrom`, which is handed one
    -- mob's whole record rather than one pasture's.
    marked as (
      select ev.*,
             case
               when lag(paddock_id) over w is distinct from paddock_id
                 or lag(exited_at) over w is null
                 or entered_at - lag(exited_at) over w > interval '1 hour'
               then 1 else 0
             end as opens
        from ev
      window w as (partition by group_id order by entered_at, id)
    ),
    numbered as (
      select marked.*,
             sum(opens) over (partition by group_id order by entered_at, id
                              rows between unbounded preceding and current row) as stay_no
        from marked
    ),
    -- One row per stay: where it was and when the mob walked in.
    firsts as (
      select distinct on (group_id, stay_no)
             farm_id, group_id, pasture_id, paddock_id, entered_at, stay_no
        from numbered
       order by group_id, stay_no, entered_at, id
    )
    -- Walked one mob-and-pasture at a time. Ordering by time alone would
    -- interleave the pastures, and the loop below — which restarts its
    -- sequence when the pasture changes — would open a fresh round every
    -- time a mob crossed to other ground and came back.
    select * from firsts
     order by group_id, pasture_id nulls first, entered_at
  loop
    -- Rounds are per mob and per pasture, so the sequence restarts on either.
    if v_first
       or r.group_id is distinct from v_group
       or r.pasture_id is distinct from v_pasture
       or r.paddock_id = any (v_seen) then
      insert into herd.grazing_rounds (farm_id, group_id, pasture_id, started_at, derived)
      values (r.farm_id, r.group_id, r.pasture_id, r.entered_at, true)
      on conflict (group_id, pasture_id, started_at) do nothing;
      v_written := v_written + 1;
      v_seen := array[]::uuid[];
    end if;

    v_group := r.group_id;
    v_pasture := r.pasture_id;
    v_first := false;
    if not (r.paddock_id = any (v_seen)) then
      v_seen := v_seen || r.paddock_id;
    end if;
  end loop;

  raise notice 'Backfilled % derived round(s) over stays.', v_written;
end $backfill$;

commit;
