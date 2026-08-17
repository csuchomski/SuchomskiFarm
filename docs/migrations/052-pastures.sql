-- 052 — the level between the farm and the paddock
--
-- STATUS: run 2026-08-17
--
-- The ground has always been two levels here: a farm, and a flat list of
-- paddocks under it. That works for one block of land. It stops working the
-- moment a farm rents a second piece across the road — the paddock list runs
-- the two together, acreage totals add up ground that is nowhere near each
-- other, and nothing in the record says which piece a move happened on.
--
-- So: farm → pasture → paddock → strip.
--
--   * **pasture** — a piece of land. The home place, the rented forty, the
--     river bottom. New here.
--   * **paddock** — a fenced or wired subdivision of a pasture. Already here.
--   * **strip** — a slice of a paddock taken behind a wire. Already here too,
--     recorded per move as `swept_from`/`swept_to` along the paddock's sweep
--     axis. Nothing to add: a paddock becomes strippable when it is given a
--     sweep heading, and that is a column it already has.
--
-- **`paddocks.pasture_id` is nullable, on purpose.** Every paddock already on
-- file predates pastures, and the honest thing to say about them is "we don't
-- know which piece of land this is on" — not to invent a pasture and claim
-- they were always in it. The UI shows them in an unassigned group and asks.
-- New paddocks are given a pasture at the point they are created.
--
-- The composite foreign key is what stops a paddock on farm A being filed
-- under a pasture on farm B. A plain reference to `pastures(id)` could not see
-- the difference; `(farm_id, pasture_id) → (farm_id, id)` can. It is MATCH
-- SIMPLE, so a null pasture_id skips the check rather than failing it.

-- ── the table ─────────────────────────────────────────────────────────────

create table if not exists herd.pastures (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  name       text not null,
  -- A short label for the report and the map, the way paddocks have one.
  code       text,
  -- What the deed or the FSA map says. Distinct from the sum of its
  -- paddocks' acres, which is what is actually fenced and grazable — the two
  -- differ by lanes, woods and the pond, and both are worth keeping.
  acres      numeric,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev        integer not null default 1,
  constraint pastures_acres_nonneg check (acres is null or acres >= 0),
  constraint pastures_name_not_blank check (btrim(name) <> ''),
  -- The target of the composite key on paddocks.
  constraint pastures_farm_id_id_key unique (farm_id, id)
);

create index if not exists pastures_farm_idx on herd.pastures (farm_id) where deleted_at is null;

-- Paddock names are already unique per farm; pastures get the same rule for
-- the same reason. Two pieces of ground called "the back forty" is a record
-- nobody can read back.
create unique index if not exists pastures_farm_name_uniq
  on herd.pastures (farm_id, lower(name)) where deleted_at is null;

alter table herd.pastures enable row level security;

drop policy if exists pastures_select on herd.pastures;
create policy pastures_select on herd.pastures
  for select using (herd.is_farm_member(farm_id));

drop policy if exists pastures_insert on herd.pastures;
create policy pastures_insert on herd.pastures
  for insert with check (herd.can_write_farm(farm_id));

drop policy if exists pastures_update on herd.pastures;
create policy pastures_update on herd.pastures
  for update using (herd.can_write_farm(farm_id)) with check (herd.can_write_farm(farm_id));

-- No delete policy, matching every other table in this schema: nothing is
-- removed, it is marked deleted. `delete_pasture` below does that.
grant select, insert, update on herd.pastures to authenticated;

-- ── hanging paddocks off it ───────────────────────────────────────────────

alter table herd.paddocks add column if not exists pasture_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'paddocks_pasture_same_farm'
  ) then
    alter table herd.paddocks
      add constraint paddocks_pasture_same_farm
      foreign key (farm_id, pasture_id) references herd.pastures (farm_id, id);
  end if;
end $$;

create index if not exists paddocks_pasture_idx on herd.paddocks (pasture_id) where deleted_at is null;

-- ── writing a pasture ─────────────────────────────────────────────────────
--
-- Insert and update in one function, because the form is one form. A null
-- p_id means "new"; anything else has to already be on this farm, which is
-- also what stops an id from another farm being passed in and edited.

create or replace function herd.save_pasture(
  p_farm_id uuid,
  p_id      uuid,
  p_name    text,
  p_code    text    default null,
  p_acres   numeric default null,
  p_notes   text    default null,
  p_active  boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_id    uuid;
  v_clash text;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A pasture needs a name.';
  end if;

  -- Said here rather than left to the unique index, which would surface as
  -- "duplicate key value violates constraint pastures_farm_name_uniq".
  select name into v_clash from pastures
   where farm_id = p_farm_id and deleted_at is null
     and lower(name) = lower(btrim(p_name))
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    raise exception 'This farm already has a pasture called %.', v_clash;
  end if;

  if p_id is null then
    insert into pastures (farm_id, name, code, acres, notes, active, created_by, updated_by)
    values (p_farm_id, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''), p_acres,
            nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_active, true), auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  update pastures
     set name       = btrim(p_name),
         code       = nullif(btrim(coalesce(p_code, '')), ''),
         acres      = p_acres,
         notes      = nullif(btrim(coalesce(p_notes, '')), ''),
         active     = coalesce(p_active, true),
         updated_at = now(),
         updated_by = auth.uid(),
         rev        = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'That pasture is not on this farm, or has already been removed.';
  end if;
  return v_id;
end;
$$;

revoke all on function herd.save_pasture(uuid, uuid, text, text, numeric, text, boolean) from public;
grant execute on function herd.save_pasture(uuid, uuid, text, text, numeric, text, boolean) to authenticated;

-- Removing a pasture that still holds paddocks would orphan them behind the
-- composite key — the row is gone as far as every read is concerned, but the
-- paddocks still point at it and appear under a pasture nobody can see. So it
-- refuses, and says what to do instead. Emptying a pasture is a decision
-- about where those paddocks went, and only the farmer knows that.

create or replace function herd.delete_pasture(
  p_farm_id uuid,
  p_id      uuid
)
returns void
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_held integer;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  select count(*) into v_held
    from paddocks
   where pasture_id = p_id and farm_id = p_farm_id and deleted_at is null;

  if v_held > 0 then
    raise exception 'This pasture still holds % paddock(s). Move them to another pasture, or remove them, first.', v_held;
  end if;

  update pastures
     set deleted_at = now(), updated_at = now(), updated_by = auth.uid(), rev = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null;

  if not found then
    raise exception 'That pasture is not on this farm, or has already been removed.';
  end if;
end;
$$;

revoke all on function herd.delete_pasture(uuid, uuid) from public;
grant execute on function herd.delete_pasture(uuid, uuid) to authenticated;

-- ── writing a paddock ─────────────────────────────────────────────────────
--
-- There has never been a way to add one from the app; the five on file were
-- inserted by hand. A farm signing up today starts with none, so this is the
-- first thing a new farm needs.
--
-- Sweep heading and length are how a paddock is set up to be stripped: a
-- heading makes it a swept unit, and the Move page then offers a wire
-- position along it. Without one the paddock is taken whole.

create or replace function herd.save_paddock(
  p_farm_id           uuid,
  p_id                uuid,
  p_name              text,
  p_pasture_id        uuid    default null,
  p_code              text    default null,
  p_acres_measured    numeric default null,
  p_acres_grazable    numeric default null,
  p_unit_type         text    default 'permanent',
  p_rotation_order    integer default null,
  p_sweep_heading_deg numeric default null,
  p_sweep_length_ft   numeric default null,
  p_fence_type        text    default null,
  p_notes             text    default null,
  p_active            boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_id    uuid;
  v_clash text;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A paddock needs a name.';
  end if;

  -- Belt and braces over the composite key: this says which farm the pasture
  -- was on, where the constraint would only say the write failed.
  if p_pasture_id is not null and not exists (
    select 1 from pastures
     where id = p_pasture_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That pasture is not on this farm.';
  end if;

  -- The two unique indexes on this table, in words. Left to the index they
  -- reach the farmer as "duplicate key value violates unique constraint
  -- paddocks_rotation_order_uniq", which says nothing about which paddock
  -- already holds the number.
  select name into v_clash from paddocks
   where farm_id = p_farm_id and deleted_at is null
     and lower(name) = lower(btrim(p_name))
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    raise exception 'This farm already has a paddock called %.', v_clash;
  end if;

  if p_rotation_order is not null then
    select name into v_clash from paddocks
     where farm_id = p_farm_id and deleted_at is null
       and rotation_order = p_rotation_order
       and (p_id is null or id <> p_id)
     limit 1;
    if v_clash is not null then
      raise exception '% is already number % in the rotation.', v_clash, p_rotation_order;
    end if;
  end if;

  if p_id is null then
    insert into paddocks (
      farm_id, pasture_id, name, code, acres_measured, acres_grazable, unit_type,
      rotation_order, sweep_heading_deg, sweep_length_ft, fence_type, notes, active,
      created_by, updated_by
    ) values (
      p_farm_id, p_pasture_id, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''),
      p_acres_measured, p_acres_grazable, coalesce(p_unit_type, 'permanent'),
      p_rotation_order, p_sweep_heading_deg, p_sweep_length_ft,
      nullif(btrim(coalesce(p_fence_type, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(p_active, true), auth.uid(), auth.uid()
    )
    returning id into v_id;
    return v_id;
  end if;

  update paddocks
     set pasture_id        = p_pasture_id,
         name              = btrim(p_name),
         code              = nullif(btrim(coalesce(p_code, '')), ''),
         acres_measured    = p_acres_measured,
         acres_grazable    = p_acres_grazable,
         unit_type         = coalesce(p_unit_type, 'permanent'),
         rotation_order    = p_rotation_order,
         sweep_heading_deg = p_sweep_heading_deg,
         sweep_length_ft   = p_sweep_length_ft,
         fence_type        = nullif(btrim(coalesce(p_fence_type, '')), ''),
         notes             = nullif(btrim(coalesce(p_notes, '')), ''),
         active            = coalesce(p_active, true),
         updated_at        = now(),
         updated_by        = auth.uid(),
         rev               = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'That paddock is not on this farm, or has already been removed.';
  end if;
  return v_id;
end;
$$;

revoke all on function herd.save_paddock(uuid, uuid, text, uuid, text, numeric, numeric, text, integer, numeric, numeric, text, text, boolean) from public;
grant execute on function herd.save_paddock(uuid, uuid, text, uuid, text, numeric, numeric, text, integer, numeric, numeric, text, text, boolean) to authenticated;

-- Removing a paddock the herd has been on would take the moves with it: the
-- payment record prints a paddock's name and code against every strip, and a
-- deleted paddock leaves that report with holes in it. Ground that has been
-- grazed is retired instead — `active = false` drops it off the board and out
-- of the rotation while every move that happened on it still reads back.
--
-- A paddock drawn by mistake and never grazed has no such history, so that
-- one really can go.

create or replace function herd.delete_paddock(
  p_farm_id uuid,
  p_id      uuid
)
returns void
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_moves integer;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  select count(*) into v_moves
    from grazing_events
   where paddock_id = p_id and farm_id = p_farm_id and deleted_at is null;

  if v_moves > 0 then
    raise exception 'This paddock has % recorded move(s) on it, so removing it would take them out of the record. Retire it instead.', v_moves;
  end if;

  update paddocks
     set deleted_at = now(), updated_at = now(), updated_by = auth.uid(), rev = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null;

  if not found then
    raise exception 'That paddock is not on this farm, or has already been removed.';
  end if;
end;
$$;

revoke all on function herd.delete_paddock(uuid, uuid) from public;
grant execute on function herd.delete_paddock(uuid, uuid) to authenticated;
