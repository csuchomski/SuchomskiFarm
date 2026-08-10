-- 035 — economic herd depreciation
--
-- STATUS: run 2026-08-10
--
-- Herd depreciation is a real cash-equivalent cost whether or not the IRS
-- lets you deduct it, and on a dairy it is the largest cost of production
-- nobody books:
--
--     (replacement cost of a springing heifer − cull value) ÷ productive lifetime
--
-- This is the management computation, not the tax one. Nothing here knows
-- about MACRS, conventions, §179 or recapture, and it must not learn: tax
-- depreciation exists only where there is basis, and a heifer raised on a
-- cash-basis Schedule F has none. See docs/BACKLOG.md.
--
-- Two things are added:
--
--   1. herd.animal_valuations — the raised-breeding-stock inventory value,
--      marked and rolled. Dated rows, never an overwritten field, because the
--      roll history is the artifact the lender and the accrual-adjusted
--      statements actually want.
--
--   2. herd.mark_herd_values() — one roll. It writes the carrying value of
--      every breeding female on the farm as of a date, declining from
--      replacement cost by the annual charge applied to the time since she
--      first freshened, and floored at cull value. That floor is what makes
--      it a value rather than a straight line to zero: a cull cow is worth
--      her cull cheque on the day she leaves.
--
-- The assumptions live in herd.settings, per farm, alongside the gestation
-- and voluntary-waiting-period figures the app already reads:
--
--   replacement_cost_cents          what a springing heifer costs to replace
--   cull_value_cents                what she is worth going out
--   productive_lifetime_lactations  how many lactations she is expected to give
--   expected_annual_yield_lb        for a herd $/cwt where a cow has no record
--   milk_lb_per_gallon              production is logged in gallons; cwt is pounds
--
-- A lactation is taken as a year. That is the convention the arithmetic
-- already encodes — $2,200 in, $900 out, 3.5 lactations, $371/cow/year — and
-- it is stated here rather than hidden in a divisor.

-- ── the inventory value ────────────────────────────────────────────────

create table if not exists herd.animal_valuations (
  id          uuid primary key default gen_random_uuid(),
  animal_id   uuid not null references herd.animals(id),
  farm_id     uuid not null references herd.farms(id),
  as_of       date not null,
  value_cents bigint not null,
  -- Where the number came from. 'marked' is the annual roll; the others are
  -- somebody's judgement and outrank it — see mark_herd_values below, which
  -- will not overwrite a hand-entered row.
  basis       text not null default 'marked',
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  deleted_at  timestamptz,
  rev         integer not null default 1,
  constraint animal_valuations_value_nonneg check (value_cents >= 0),
  constraint animal_valuations_basis_check
    check (basis in ('marked', 'purchase', 'appraisal', 'sale', 'manual'))
);

-- One value per animal per date. A re-roll on the same day replaces the
-- figure rather than stacking a second one beside it.
create unique index if not exists animal_valuations_animal_as_of_uniq
  on herd.animal_valuations (animal_id, as_of)
  where deleted_at is null;

create index if not exists animal_valuations_farm_as_of_idx
  on herd.animal_valuations (farm_id, as_of desc)
  where deleted_at is null;

alter table herd.animal_valuations enable row level security;

-- The same three policies every other herd table carries: read as a member,
-- write as an editor. No DELETE policy anywhere in this schema — removing a
-- valuation is deleted_at, which is right for a figure that has already been
-- reported.
drop policy if exists animal_valuations_select on herd.animal_valuations;
create policy animal_valuations_select on herd.animal_valuations
  for select using (herd.is_farm_member(farm_id));

drop policy if exists animal_valuations_insert on herd.animal_valuations;
create policy animal_valuations_insert on herd.animal_valuations
  for insert with check (herd.can_write_farm(farm_id));

drop policy if exists animal_valuations_update on herd.animal_valuations;
create policy animal_valuations_update on herd.animal_valuations
  for update using (herd.can_write_farm(farm_id)) with check (herd.can_write_farm(farm_id));

grant select, insert, update on herd.animal_valuations to authenticated, anon;

-- ── the assumptions ────────────────────────────────────────────────────

insert into herd.settings (key, value, farm_id)
select k.key, k.value, f.id
  from herd.farms f
 cross join (values
   ('replacement_cost_cents', '220000'::jsonb),
   ('cull_value_cents', '90000'::jsonb),
   ('productive_lifetime_lactations', '3.5'::jsonb),
   ('expected_annual_yield_lb', '20000'::jsonb),
   ('milk_lb_per_gallon', '8.6'::jsonb)
 ) as k(key, value)
 -- herd.farms has no deleted_at; a farm row is never soft-deleted.
 where not exists (
   select 1 from herd.settings s
    where s.farm_id = f.id and s.key = k.key and s.deleted_at is null
 );

-- ── the roll ───────────────────────────────────────────────────────────

create or replace function herd.mark_herd_values(p_farm_id uuid, p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm        uuid := p_farm_id;
  v_replacement numeric;
  v_cull        numeric;
  v_lifetime    numeric;
  v_annual      numeric;
  v_written     integer := 0;
begin
  -- security definer, so the farm is checked here rather than by RLS.
  if v_farm is null or not can_write_farm(v_farm) then
    raise exception 'That is not a farm you can write to.';
  end if;

  select (value #>> '{}')::numeric into v_replacement
    from settings where farm_id = v_farm and key = 'replacement_cost_cents' and deleted_at is null;
  select (value #>> '{}')::numeric into v_cull
    from settings where farm_id = v_farm and key = 'cull_value_cents' and deleted_at is null;
  select (value #>> '{}')::numeric into v_lifetime
    from settings where farm_id = v_farm and key = 'productive_lifetime_lactations' and deleted_at is null;

  if v_replacement is null or v_cull is null or v_lifetime is null then
    raise exception 'Set the replacement cost, cull value and productive lifetime first.';
  end if;

  if v_lifetime <= 0 then
    raise exception 'A productive lifetime of % lactations gives nothing to divide by.', v_lifetime;
  end if;

  if v_cull > v_replacement then
    raise exception 'Cull value is above replacement cost, which would depreciate her upwards.';
  end if;

  v_annual := (v_replacement - v_cull) / v_lifetime;

  -- Breeding females on the dairy side only. A bull is not herd inventory on
  -- this model, a calf is not yet in the string, and a reference animal is a
  -- name on a straw.
  --
  -- Beef females are deliberately left out rather than given a value. Every
  -- figure these assumptions carry is a dairy figure — a springing heifer, a
  -- cull cow, a productive lifetime in lactations — and marking a beef cow
  -- with them would be inventing a number, not measuring one. She can still
  -- be valued by hand; the roll simply doesn't speak for her.
  with eligible as (
    select a.id,
           least(
             (select min(l.fresh_date) from lactations l
               where l.animal_id = a.id and l.deleted_at is null and l.fresh_date <= p_as_of),
             (select min(c.date) from calvings c
               where c.dam_id = a.id and c.deleted_at is null and c.date <= p_as_of)
           ) as entered_production
      from animals a
     where a.farm_id = v_farm
       and a.deleted_at is null
       and a.sex = 'female'
       and a.class <> 'calf'
       and a.status = 'active'
       and a.record_type <> 'reference'
       and a.purpose in ('dairy', 'dual')
  ),
  valued as (
    -- Time since she entered production, not lactations counted. A cow one
    -- day fresh has not lost a year's value, and counting the lactation she
    -- is standing in would say she had. A springing heifer who has not
    -- calved yet is worth replacement cost, which is what she would cost to
    -- replace. LEAST ignores nulls, so either record starts her clock.
    select e.id,
           greatest(
             v_cull,
             v_replacement - v_annual * coalesce((p_as_of - e.entered_production)::numeric / 365, 0)
           ) as value_cents
      from eligible e
  ),
  written as (
    insert into animal_valuations (animal_id, farm_id, as_of, value_cents, basis, note, created_by, updated_by)
    select v.id, v_farm, p_as_of, round(v.value_cents), 'marked',
           'rolled from the herd assumptions', auth.uid(), auth.uid()
      from valued v
     where not exists (
       -- A hand-entered figure for the day is somebody's judgement about that
       -- animal. The roll fills gaps; it does not argue.
       select 1 from animal_valuations av
        where av.animal_id = v.id and av.as_of = p_as_of and av.deleted_at is null and av.basis <> 'marked'
     )
    on conflict (animal_id, as_of) where deleted_at is null
    do update set value_cents = excluded.value_cents,
                  note        = excluded.note,
                  updated_by  = auth.uid(),
                  updated_at  = now(),
                  rev         = animal_valuations.rev + 1
    returning 1
  )
  select count(*) into v_written from written;

  return v_written;
end;
$function$;

revoke all on function herd.mark_herd_values(uuid, date) from public;
grant execute on function herd.mark_herd_values(uuid, date) to authenticated;

-- ── a value somebody decided on ────────────────────────────────────────
--
-- A function rather than a PostgREST upsert, because the unique index it has
-- to conflict on is partial (`where deleted_at is null`) and PostgREST emits
-- no WHERE clause, so Postgres can't infer the index and the upsert fails.
-- Making the index total instead would mean a soft-deleted row permanently
-- blocked that animal-and-date.

create or replace function herd.record_valuation(
  p_farm_id     uuid,
  p_animal_id   uuid,
  p_as_of       date,
  p_value_cents bigint,
  p_basis       text default 'manual',
  p_note        text default ''
)
returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_id uuid;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  if not exists (
    select 1 from animals a
     where a.id = p_animal_id and a.farm_id = p_farm_id and a.deleted_at is null
  ) then
    raise exception 'That animal is not on this farm.';
  end if;

  if p_value_cents < 0 then
    raise exception 'A value below zero is not a value.';
  end if;

  insert into animal_valuations (animal_id, farm_id, as_of, value_cents, basis, note, created_by, updated_by)
  values (p_animal_id, p_farm_id, p_as_of, p_value_cents, coalesce(p_basis, 'manual'), coalesce(p_note, ''),
          auth.uid(), auth.uid())
  on conflict (animal_id, as_of) where deleted_at is null
  do update set value_cents = excluded.value_cents,
                basis       = excluded.basis,
                note        = excluded.note,
                updated_by  = auth.uid(),
                updated_at  = now(),
                rev         = animal_valuations.rev + 1
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function herd.record_valuation(uuid, uuid, date, bigint, text, text) from public;
grant execute on function herd.record_valuation(uuid, uuid, date, bigint, text, text) to authenticated;
