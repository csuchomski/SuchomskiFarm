-- 066 — a round is a thing you start, through one pasture, with one mob
--
-- STATUS: run 2026-09-01
--
-- The Rounds page has always *derived* a round: it ends when the mob walks
-- into a unit it has already been in this round. That rule needs no notion of
-- the correct order, which is why it was chosen — but it is wrong in three
-- ways that only showed up at scale.
--
-- **It ignores which mob.** `staysFrom` sorts every event on the farm by time
-- and never looks at `group_id`, so four mobs grazing at once interleave into
-- one sequence and the repeat rule fires on paths crossing. Measured on the
-- Green Pastures demo — 236 moves, four mobs, 46 paddocks — the page reports
-- **20 rounds of about twelve stays each, six to nine days apiece**. There is
-- no such thing on that farm. Per mob, the same data is two rounds.
--
-- **It ignores which pasture.** A round of 46 stays spans six pastures over
-- three separate leases. Nobody walks that as one trip, and the question a
-- round exists to answer — had this paddock recovered when we walked back in
-- — is asked within a piece of ground, not across a county.
--
-- **It cannot be told it is wrong.** Where the mob overwinters, which paddock
-- is shut up for hay, and which is too wet this week all move the start of a
-- round, and none of them is visible in the move record. A heuristic that
-- cannot be corrected quietly mis-states the year.
--
-- So a round becomes a row, and the farm starts one. Not guessed:
--
--   * **one mob, one pasture** — the scale the recovery question is asked at,
--     and on a farm with one pasture it is exactly what a round is today.
--   * **a start, and no end.** Asking somebody to close a round is asking
--     them to remember something at the moment they are busiest. A round runs
--     until the next one in the same mob and pasture begins.
--   * **the span is its moves, not its markers.** First entry to last exit of
--     the events that fall in it. A mob that leaves in November and comes
--     back in April has a round with a hole in it, and dating the round from
--     its start marker to the next one would report a 150-day trip through
--     eight paddocks.
--
-- ── The backfill, which is a judgement call ────────────────────────────────
--
-- Rounds are explicit from here on. But every move already on file predates
-- this table, and leaving it all round-less would mean the report filter this
-- was built for matches nothing on day one.
--
-- So the history is backfilled once, using the old rule applied properly —
-- per mob, per pasture. That is a guess about the past, and it is marked as
-- one: `derived = true` on every row this writes, so the page can say which
-- rounds the farm drew and which the app inferred. Anything started from the
-- app afterwards is `derived = false`.
--
-- Re-running the backfill is not idempotent by nature — it is a one-time
-- reading of history — so it refuses if any derived round already exists.

-- ── the table ─────────────────────────────────────────────────────────────

create table if not exists herd.grazing_rounds (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  group_id   uuid not null references herd.grazing_groups(id),
  -- Null means the ground carries no pasture, which is every farm before 052
  -- and plenty since. Those farms get one sequence of rounds, which is what a
  -- round has always meant to them.
  pasture_id uuid,
  started_at timestamptz not null,
  -- Optional. "Spring 1", "after the hay". A round with no name is shown by
  -- its number, which is what the page has always done.
  name       text,
  notes      text,
  -- True only for rows the backfill wrote. The farm's own rounds are false,
  -- and the page says which is which rather than presenting a guess as a
  -- record.
  derived    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev        integer not null default 1,
  constraint grazing_rounds_name_not_blank check (name is null or btrim(name) <> ''),
  -- A mob cannot start two rounds through the same ground at the same
  -- instant; one of them would own no moves. NULLS NOT DISTINCT because
  -- `pasture_id` is null on every farm that has not divided its ground, and
  -- the default treats those nulls as all different — which would let exactly
  -- the farms with the simplest setup hold duplicate rounds.
  constraint grazing_rounds_once unique nulls not distinct (group_id, pasture_id, started_at)
);

create index if not exists grazing_rounds_farm_idx
  on herd.grazing_rounds (farm_id) where deleted_at is null;

-- The lookup every read does: this mob, this ground, in order.
create index if not exists grazing_rounds_scope_idx
  on herd.grazing_rounds (group_id, pasture_id, started_at) where deleted_at is null;

alter table herd.grazing_rounds enable row level security;

drop policy if exists grazing_rounds_select on herd.grazing_rounds;
create policy grazing_rounds_select on herd.grazing_rounds
  for select using (herd.is_farm_member(farm_id));

drop policy if exists grazing_rounds_insert on herd.grazing_rounds;
create policy grazing_rounds_insert on herd.grazing_rounds
  for insert with check (herd.can_write_farm(farm_id));

drop policy if exists grazing_rounds_update on herd.grazing_rounds;
create policy grazing_rounds_update on herd.grazing_rounds
  for update using (herd.can_write_farm(farm_id)) with check (herd.can_write_farm(farm_id));

-- No delete policy, matching every other table in this schema.
grant select, insert, update on herd.grazing_rounds to authenticated;

-- ── starting one, and correcting one ──────────────────────────────────────
--
-- Insert and update in one function, because it is one form. A null p_id
-- means "new". The pasture is not passed in: it is read off the mob's own
-- ground so the round cannot be filed against a pasture the paddock is not
-- on. Passing it would be one more thing that can disagree with itself.

create or replace function herd.save_round(
  p_farm_id    uuid,
  p_id         uuid,
  p_group_id   uuid,
  p_pasture_id uuid,
  p_started_at timestamptz,
  p_name       text default null,
  p_notes      text default null
)
returns uuid
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_id    uuid;
  v_clash timestamptz;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;
  if p_started_at is null then
    raise exception 'A round needs a day it started.';
  end if;

  -- Said here rather than left to the foreign keys, which would report only
  -- that the write failed and not which of the two was on another farm.
  if not exists (
    select 1 from grazing_groups
     where id = p_group_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That mob is not on this farm.';
  end if;

  if p_pasture_id is not null and not exists (
    select 1 from pastures
     where id = p_pasture_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That pasture is not on this farm.';
  end if;

  select started_at into v_clash from grazing_rounds
   where group_id = p_group_id
     and pasture_id is not distinct from p_pasture_id
     and started_at = p_started_at
     and deleted_at is null
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    raise exception 'That mob already has a round starting on this ground at %.', v_clash;
  end if;

  if p_id is null then
    insert into grazing_rounds (farm_id, group_id, pasture_id, started_at, name, notes,
                                derived, created_by, updated_by)
    values (p_farm_id, p_group_id, p_pasture_id, p_started_at,
            nullif(btrim(coalesce(p_name, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
            false, auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  -- Editing a round the backfill wrote makes it the farm's: somebody has
  -- looked at it and said where it really starts, which is no longer a guess.
  update grazing_rounds
     set group_id   = p_group_id,
         pasture_id = p_pasture_id,
         started_at = p_started_at,
         name       = nullif(btrim(coalesce(p_name, '')), ''),
         notes      = nullif(btrim(coalesce(p_notes, '')), ''),
         derived    = false,
         updated_at = now(),
         updated_by = auth.uid(),
         rev        = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'That round is not on this farm, or has already been removed.';
  end if;
  return v_id;
end;
$$;

revoke all on function herd.save_round(uuid, uuid, uuid, uuid, timestamptz, text, text) from public;
grant execute on function herd.save_round(uuid, uuid, uuid, uuid, timestamptz, text, text) to authenticated;

-- Removing a round takes away a boundary, not a record. Its moves are
-- untouched; they simply fall into the round before it, which is exactly what
-- "this was not really a new round" means. Nothing about the grazing changes,
-- which is why this one is safe to do without a warning about lost history.

create or replace function herd.delete_round(
  p_farm_id uuid,
  p_id      uuid
)
returns void
language plpgsql
security definer
set search_path = herd, public
as $$
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  update grazing_rounds
     set deleted_at = now(), updated_at = now(), updated_by = auth.uid(), rev = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null;

  if not found then
    raise exception 'That round is not on this farm, or has already been removed.';
  end if;
end;
$$;

revoke all on function herd.delete_round(uuid, uuid) from public;
grant execute on function herd.delete_round(uuid, uuid) to authenticated;

-- ── the backfill ──────────────────────────────────────────────────────────
--
-- The old rule, applied per mob and per pasture rather than across the farm:
-- a round ends when the mob walks into a paddock it has already been in on
-- this ground during this round. Every row written here is marked derived.

do $backfill$
declare
  r          record;
  v_seen     uuid[];
  v_group    uuid;
  v_pasture  uuid;
  v_first    boolean;
  v_written  integer := 0;
begin
  if exists (select 1 from herd.grazing_rounds where derived and deleted_at is null) then
    raise exception 'Derived rounds already exist. The backfill reads history once; clear them first if you mean to redo it.';
  end if;

  v_group := null;
  v_pasture := null;
  v_seen := array[]::uuid[];
  v_first := true;

  for r in
    select e.farm_id, e.group_id, p.pasture_id, e.paddock_id, e.entered_at
      from herd.grazing_events e
      join herd.paddocks p on p.id = e.paddock_id
     where e.deleted_at is null
     order by e.group_id, p.pasture_id nulls first, e.entered_at, e.id
  loop
    -- A new mob or a new piece of ground restarts the sequence, and its first
    -- move opens a round.
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

  raise notice 'Backfilled % derived round(s).', v_written;
end $backfill$;
