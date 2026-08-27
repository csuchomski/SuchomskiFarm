-- 064 — the level above the pasture, and rounds that belong to one
--
-- STATUS: run 2026-08-27
--
-- Migration 052 called the piece of land a *pasture* and hung paddocks off
-- it. That is right for a farm that owns one block and rents a second. It is
-- not enough for Green Pastures, where the ground is leased across a county:
-- a dozen named places, each with its own pastures, each of those subdivided
-- into paddocks. The place and the pasture are two different things there,
-- and running them together loses which lease a move happened on.
--
-- So the ground gains one level, and only one:
--
--   farm → **property** → pasture → paddock → strip
--
--   * **property** — a deeded or leased place. "The home farm", "Vollmer",
--     "the Miller lease". New here.
--   * **pasture** — a piece of ground on that place, walked as one round.
--     Already here.
--   * **paddock**, **strip** — unchanged.
--
-- **`pastures.property_id` is nullable, on purpose**, for the same reason
-- `paddocks.pasture_id` is: every pasture on file predates properties, and
-- the honest thing to say about them is "we have not been told which place
-- this is on". A farm that never adds a property never sees the level.
--
-- The composite foreign key `(farm_id, property_id) → (farm_id, id)` is what
-- stops a pasture on farm A being filed under a property on farm B. MATCH
-- SIMPLE, so a null property_id skips the check rather than failing it. Same
-- shape as `paddocks_pasture_same_farm`.
--
-- ── the second half: a rotation number belongs to a pasture ────────────────
--
-- `paddocks_rotation_order_uniq` has been `(farm_id, rotation_order)` since
-- the beginning, which made the round a property of the whole farm. That was
-- true when a farm was one block. It is wrong at Green Pastures' forty-six
-- paddocks over six pastures: each pasture is walked as its own round, and
-- forcing one sequence across all of them means the numbers say nothing about
-- the order anything is actually grazed in.
--
-- The index becomes per pasture. Unassigned paddocks are grouped together
-- rather than left each in their own null bucket — `coalesce(pasture_id,
-- farm_id)` — because two paddocks nobody has placed yet still should not
-- both be number 1 on the same farm.
--
-- Farms with more than one pasture are renumbered so each pasture runs 1..n.
-- **Relative order within a pasture is preserved**, so nothing about which
-- paddock follows which changes — only the absolute figures. On file today
-- that touches the two demo farms and nothing else: Five Chimneys and Rocky
-- Ridge each have one pasture, where per-pasture and per-farm numbering are
-- the same thing.
--
-- The app side of this shipped first: `nextInRotation` already walks the ring
-- inside a pasture, so six paddocks sharing the number 1 cannot send a mob to
-- the wrong property.

-- ── properties ────────────────────────────────────────────────────────────

create table if not exists herd.properties (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid not null references herd.farms(id),
  name       text not null,
  code       text,
  -- What the deed or the lease says. Distinct from the sum of its pastures'
  -- acres, which is what is actually fenced — the two differ by the yard,
  -- the woods and the road frontage, and both are worth keeping.
  acres      numeric,
  -- Whose it is. A farm that leases half its ground needs to know which half
  -- is at somebody else's pleasure, and when that ends.
  tenure     text not null default 'owned',
  lease_ends date,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  rev        integer not null default 1,
  constraint properties_acres_nonneg check (acres is null or acres >= 0),
  constraint properties_name_not_blank check (btrim(name) <> ''),
  constraint properties_tenure_known check (tenure in ('owned', 'leased', 'shared', 'other')),
  -- A lease end on ground nobody is leasing is a figure that will go stale
  -- with nothing to correct it against.
  constraint properties_lease_ends_needs_lease
    check (lease_ends is null or tenure in ('leased', 'shared')),
  -- The target of the composite key on pastures.
  constraint properties_farm_id_id_key unique (farm_id, id)
);

create index if not exists properties_farm_idx on herd.properties (farm_id) where deleted_at is null;

-- Pasture and paddock names are already unique per farm; properties get the
-- same rule for the same reason. Two places called "the Miller" is a record
-- nobody can read back.
create unique index if not exists properties_farm_name_uniq
  on herd.properties (farm_id, lower(name)) where deleted_at is null;

alter table herd.properties enable row level security;

drop policy if exists properties_select on herd.properties;
create policy properties_select on herd.properties
  for select using (herd.is_farm_member(farm_id));

drop policy if exists properties_insert on herd.properties;
create policy properties_insert on herd.properties
  for insert with check (herd.can_write_farm(farm_id));

drop policy if exists properties_update on herd.properties;
create policy properties_update on herd.properties
  for update using (herd.can_write_farm(farm_id)) with check (herd.can_write_farm(farm_id));

-- No delete policy, matching every other table in this schema: nothing is
-- removed, it is marked deleted. `delete_property` below does that.
grant select, insert, update on herd.properties to authenticated;

-- ── hanging pastures off it ───────────────────────────────────────────────

alter table herd.pastures add column if not exists property_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pastures_property_same_farm'
  ) then
    alter table herd.pastures
      add constraint pastures_property_same_farm
      foreign key (farm_id, property_id) references herd.properties (farm_id, id);
  end if;
end $$;

create index if not exists pastures_property_idx on herd.pastures (property_id) where deleted_at is null;

-- ── writing a property ────────────────────────────────────────────────────

create or replace function herd.save_property(
  p_farm_id    uuid,
  p_id         uuid,
  p_name       text,
  p_code       text    default null,
  p_acres      numeric default null,
  p_tenure     text    default 'owned',
  p_lease_ends date    default null,
  p_notes      text    default null,
  p_active     boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_id     uuid;
  v_clash  text;
  v_tenure text := coalesce(nullif(btrim(coalesce(p_tenure, '')), ''), 'owned');
  v_ends   date := p_lease_ends;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A property needs a name.';
  end if;
  if v_tenure not in ('owned', 'leased', 'shared', 'other') then
    raise exception '% is not a tenure this app knows.', v_tenure;
  end if;

  -- Rather than failing the check constraint: ground moved from leased to
  -- owned has no lease to end, and the date on it is now a lie.
  if v_tenure not in ('leased', 'shared') then
    v_ends := null;
  end if;

  -- Said here rather than left to the unique index, which would surface as
  -- "duplicate key value violates constraint properties_farm_name_uniq".
  select name into v_clash from properties
   where farm_id = p_farm_id and deleted_at is null
     and lower(name) = lower(btrim(p_name))
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    raise exception 'This farm already has a property called %.', v_clash;
  end if;

  if p_id is null then
    insert into properties (farm_id, name, code, acres, tenure, lease_ends, notes, active,
                            created_by, updated_by)
    values (p_farm_id, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''), p_acres,
            v_tenure, v_ends, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_active, true),
            auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  update properties
     set name       = btrim(p_name),
         code       = nullif(btrim(coalesce(p_code, '')), ''),
         acres      = p_acres,
         tenure     = v_tenure,
         lease_ends = v_ends,
         notes      = nullif(btrim(coalesce(p_notes, '')), ''),
         active     = coalesce(p_active, true),
         updated_at = now(),
         updated_by = auth.uid(),
         rev        = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'That property is not on this farm, or has already been removed.';
  end if;
  return v_id;
end;
$$;

revoke all on function herd.save_property(uuid, uuid, text, text, numeric, text, date, text, boolean) from public;
grant execute on function herd.save_property(uuid, uuid, text, text, numeric, text, date, text, boolean) to authenticated;

-- Removing a property that still holds pastures would orphan them behind the
-- composite key — the row is gone as far as every read is concerned, but the
-- pastures still point at it and appear under a place nobody can see. So it
-- refuses, exactly as `delete_pasture` does. Where those pastures went is a
-- decision only the farmer can make.

create or replace function herd.delete_property(
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
    from pastures
   where property_id = p_id and farm_id = p_farm_id and deleted_at is null;

  if v_held > 0 then
    raise exception 'This property still holds % pasture(s). Move them to another property, or remove them, first.', v_held;
  end if;

  update properties
     set deleted_at = now(), updated_at = now(), updated_by = auth.uid(), rev = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null;

  if not found then
    raise exception 'That property is not on this farm, or has already been removed.';
  end if;
end;
$$;

revoke all on function herd.delete_property(uuid, uuid) from public;
grant execute on function herd.delete_property(uuid, uuid) to authenticated;

-- ── a pasture can say which place it is on ────────────────────────────────
--
-- `create or replace function` only replaces on an exact signature match, so
-- adding a parameter would leave the seven-argument version in place beside
-- the new one and let PostgREST pick either. Migration 011 learned that the
-- hard way with `reserve_product`. The old one goes first, by signature.

drop function if exists herd.save_pasture(uuid, uuid, text, text, numeric, text, boolean);

create or replace function herd.save_pasture(
  p_farm_id     uuid,
  p_id          uuid,
  p_name        text,
  p_code        text    default null,
  p_acres       numeric default null,
  p_notes       text    default null,
  p_active      boolean default true,
  p_property_id uuid    default null
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

  -- Belt and braces over the composite key: this says which farm the
  -- property was on, where the constraint would only say the write failed.
  if p_property_id is not null and not exists (
    select 1 from properties
     where id = p_property_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That property is not on this farm.';
  end if;

  select name into v_clash from pastures
   where farm_id = p_farm_id and deleted_at is null
     and lower(name) = lower(btrim(p_name))
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    raise exception 'This farm already has a pasture called %.', v_clash;
  end if;

  if p_id is null then
    insert into pastures (farm_id, property_id, name, code, acres, notes, active, created_by, updated_by)
    values (p_farm_id, p_property_id, btrim(p_name), nullif(btrim(coalesce(p_code, '')), ''), p_acres,
            nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_active, true), auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  update pastures
     set property_id = p_property_id,
         name        = btrim(p_name),
         code        = nullif(btrim(coalesce(p_code, '')), ''),
         acres       = p_acres,
         notes       = nullif(btrim(coalesce(p_notes, '')), ''),
         active      = coalesce(p_active, true),
         updated_at  = now(),
         updated_by  = auth.uid(),
         rev         = rev + 1
   where id = p_id and farm_id = p_farm_id and deleted_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'That pasture is not on this farm, or has already been removed.';
  end if;
  return v_id;
end;
$$;

revoke all on function herd.save_pasture(uuid, uuid, text, text, numeric, text, boolean, uuid) from public;
grant execute on function herd.save_pasture(uuid, uuid, text, text, numeric, text, boolean, uuid) to authenticated;

-- ── a rotation number belongs to a pasture ────────────────────────────────
--
-- The old index comes off *first*. A unique index is checked row by row as a
-- statement runs — it is not deferrable — so renumbering under
-- `(farm_id, rotation_order)` would fail the moment the second pasture's
-- paddock became number 1 while the first pasture's number 1 still existed.
-- Between the drop and the create there is no uniqueness on the column, which
-- is fine for the length of this migration and is the only order that works.

drop index if exists herd.paddocks_rotation_order_uniq;

-- Relative order within each pasture is preserved; ties on a null
-- rotation_order fall back to name, which is the same tiebreak the app's
-- `inRotation` uses.

do $$
declare
  v_farm uuid;
begin
  for v_farm in
    select farm_id from herd.paddocks
     where deleted_at is null and pasture_id is not null
     group by farm_id
    having count(distinct pasture_id) > 1
  loop
    update herd.paddocks p
       set rotation_order = r.seq,
           updated_at     = now(),
           rev            = rev + 1
      from (
        select id,
               row_number() over (
                 partition by coalesce(pasture_id, farm_id)
                 order by rotation_order nulls last, name
               ) as seq
          from herd.paddocks
         where farm_id = v_farm and deleted_at is null and rotation_order is not null
      ) r
     where p.id = r.id and p.rotation_order is distinct from r.seq;
  end loop;
end $$;

create unique index if not exists paddocks_rotation_order_uniq
  on herd.paddocks (farm_id, coalesce(pasture_id, farm_id), rotation_order)
  where rotation_order is not null and deleted_at is null;

-- `save_paddock` checked the number against the whole farm. It has to ask the
-- same question the index now asks, or the friendly message and the
-- constraint disagree about what a clash is.

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
  v_where text;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A paddock needs a name.';
  end if;

  if p_pasture_id is not null and not exists (
    select 1 from pastures
     where id = p_pasture_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That pasture is not on this farm.';
  end if;

  select name into v_clash from paddocks
   where farm_id = p_farm_id and deleted_at is null
     and lower(name) = lower(btrim(p_name))
     and (p_id is null or id <> p_id)
   limit 1;
  if v_clash is not null then
    raise exception 'This farm already has a paddock called %.', v_clash;
  end if;

  -- Per pasture, matching the index. Unassigned paddocks are one group, the
  -- same way `coalesce(pasture_id, farm_id)` groups them there.
  if p_rotation_order is not null then
    select name into v_clash from paddocks
     where farm_id = p_farm_id and deleted_at is null
       and coalesce(pasture_id, farm_id) = coalesce(p_pasture_id, p_farm_id)
       and rotation_order = p_rotation_order
       and (p_id is null or id <> p_id)
     limit 1;
    if v_clash is not null then
      select 'in ' || name into v_where
        from pastures where id = p_pasture_id and deleted_at is null;
      raise exception '% is already number % %.',
        v_clash, p_rotation_order, coalesce(v_where, 'on the unassigned ground');
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
