-- 043 — a way in for weights, the rotation order, and grass height as forage
--
-- STATUS: run 2026-08-13
--
-- Three small things the one-page move needs before it can be effortless.

-- ── 1. Recording a weight ──────────────────────────────────────────────
--
-- `herd.weights` has existed and been empty all along, because nothing could
-- write to it. The request was for "a weight field on the animal", and the
-- module had previously chosen dated rows over a field on `animals` so a
-- heifer's April figure stays her April figure.
--
-- Both are right, and this is how they meet: the Animals form gets one field,
-- and it writes a dated row. It reads as a field and keeps the history.
--
-- An RPC rather than a PostgREST insert for one reason — weighing the same
-- animal twice on the same day should correct the figure, not leave two rows
-- for the day with no way to tell which is meant. That is an upsert on
-- (animal_id, date), and there is no unique index to infer, so it branches
-- here where it can be done in one statement.

create or replace function herd.record_weight(
  p_farm_id   uuid,
  p_animal_id uuid,
  p_weight_lb numeric,
  p_date      date default current_date,
  -- 'adhoc' is the one the table's own check constraint has for a weighing
  -- that is not a birth, weaning, yearling, sale or processing figure — which
  -- is what a weight typed on the animal's record is.
  p_weight_type text default 'adhoc',
  p_notes     text default ''
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
    select 1 from animals where id = p_animal_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That animal is not on this farm.';
  end if;

  -- A weight of zero is not a light animal, it is an empty field that got
  -- saved. Negative is a typo. Neither belongs in a record somebody will
  -- later divide by. The table's own check would refuse both; this is here
  -- to say so in words a person can act on.
  if p_weight_lb is null or p_weight_lb <= 0 then
    raise exception 'A weight has to be more than nothing.';
  end if;

  update weights
     set weight_lb = p_weight_lb,
         weight_type = coalesce(nullif(trim(p_weight_type), ''), 'adhoc'),
         notes = coalesce(p_notes, ''),
         updated_by = auth.uid(), updated_at = now(), rev = rev + 1
   where animal_id = p_animal_id and date = p_date and deleted_at is null
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into weights (
    farm_id, animal_id, date, weight_lb, weight_type, contemporary_group, notes,
    created_by, updated_by
  ) values (
    p_farm_id, p_animal_id, p_date, p_weight_lb,
    coalesce(nullif(trim(p_weight_type), ''), 'adhoc'), '', coalesce(p_notes, ''),
    auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function herd.record_weight(uuid, uuid, numeric, date, text, text) from public;
grant execute on function herd.record_weight(uuid, uuid, numeric, date, text, text) to authenticated;

-- ── 2. The order the mob walks ─────────────────────────────────────────
--
-- P1 → P2 → P3 → P4 → P5 → back to P1. The serpentine has been confirmed
-- since 040 and was inferable from the sweep headings, but nowhere recorded —
-- and "move to the next paddock" and "set the back line to the start of
-- Paddock 5" both need the app to know the sequence rather than guess it.
--
-- An integer rather than a linked list: it sorts, it is obvious in a table,
-- and a farm that reorders its rotation renumbers rather than relinks.

alter table herd.paddocks
  add column if not exists rotation_order integer;

alter table herd.paddocks
  drop constraint if exists paddocks_rotation_order_positive;
alter table herd.paddocks
  add constraint paddocks_rotation_order_positive check (
    rotation_order is null or rotation_order > 0
  );

-- Unique per farm so two units cannot claim the same place in the round.
-- Partial, so units left out of the rotation simply carry null.
create unique index if not exists paddocks_rotation_order_uniq
  on herd.paddocks (farm_id, rotation_order)
  where rotation_order is not null and deleted_at is null;

comment on column herd.paddocks.rotation_order is
  'Where this unit falls in the round, 1 first. Wraps: after the last comes the first. Null means it is not part of the rotation.';

update herd.paddocks set rotation_order = 1 where name = 'Paddock 1' and deleted_at is null;
update herd.paddocks set rotation_order = 2 where name = 'Paddock 2' and deleted_at is null;
update herd.paddocks set rotation_order = 3 where name = 'Paddock 3' and deleted_at is null;
update herd.paddocks set rotation_order = 4 where name = 'Paddock 4' and deleted_at is null;
update herd.paddocks set rotation_order = 5 where name = 'Paddock 5' and deleted_at is null;

-- ── 3. Turning a height reading into standing forage ───────────────────
--
-- `grazing_events.forage_height_in_entry` has been recorded since step 2 and
-- used for nothing. This is the number that makes it worth taking: pounds of
-- dry matter per acre-inch of sward.
--
-- It lives on the plan, not in code, for the same reason every other
-- threshold does. It varies with sward, season and density, and an app that
-- picked one would be making an agronomic recommendation it has no standing
-- to make. **300 is this farm's own figure**, given by the owner.

alter table herd.grazing_plans
  add column if not exists lb_dm_per_acre_inch numeric;

alter table herd.grazing_plans
  drop constraint if exists grazing_plans_lb_dm_per_acre_inch_positive;
alter table herd.grazing_plans
  add constraint grazing_plans_lb_dm_per_acre_inch_positive check (
    lb_dm_per_acre_inch is null or lb_dm_per_acre_inch > 0
  );

comment on column herd.grazing_plans.lb_dm_per_acre_inch is
  'Pounds of dry matter per acre-inch of standing sward, for turning a height reading into available forage. The farm''s own figure — this app must never supply one.';

-- The plan-writing RPC has to carry it, or the Plan page cannot set it.
-- Replaced rather than added to, and the old signature dropped below so
-- there is exactly one.

create or replace function herd.save_grazing_plan(
  p_farm_id uuid,
  p_plan_id uuid default null,
  p_name text default null,
  p_period_start date default null,
  p_period_end date default null,
  p_contract_number text default null,
  p_tract_number text default null,
  p_field_ids text default null,
  p_long_term_goals text default null,
  p_immediate_objectives text default null,
  p_benchmark_stocking_rate_aum_per_acre numeric default null,
  p_monitoring_cadence_kind text default 'every_rotation',
  p_monitoring_cadence_value numeric default null,
  p_default_dmi_pct_bw numeric default null,
  p_lb_dm_per_acre_inch numeric default null
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

  if coalesce(trim(p_name), '') = '' then
    raise exception 'A plan needs a name — the season it covers is usually enough.';
  end if;

  if p_period_start is not null and p_period_end is not null
     and p_period_end < p_period_start then
    raise exception 'The plan ends before it starts.';
  end if;

  if p_plan_id is not null then
    update grazing_plans set
      name = trim(p_name),
      period_start = p_period_start,
      period_end = p_period_end,
      contract_number = p_contract_number,
      tract_number = p_tract_number,
      field_ids = p_field_ids,
      long_term_goals = p_long_term_goals,
      immediate_objectives = p_immediate_objectives,
      benchmark_stocking_rate_aum_per_acre = p_benchmark_stocking_rate_aum_per_acre,
      monitoring_cadence_kind = p_monitoring_cadence_kind,
      monitoring_cadence_value = p_monitoring_cadence_value,
      default_dmi_pct_bw = p_default_dmi_pct_bw,
      lb_dm_per_acre_inch = p_lb_dm_per_acre_inch,
      updated_by = auth.uid(), updated_at = now(), rev = rev + 1
    where id = p_plan_id and farm_id = p_farm_id and deleted_at is null
    returning id into v_id;

    if v_id is null then
      raise exception 'That plan is not on this farm.';
    end if;
    return v_id;
  end if;

  update grazing_plans
     set active = false, updated_by = auth.uid(), updated_at = now(), rev = rev + 1
   where farm_id = p_farm_id and active and deleted_at is null;

  insert into grazing_plans (
    farm_id, name, period_start, period_end, contract_number, tract_number,
    field_ids, long_term_goals, immediate_objectives,
    benchmark_stocking_rate_aum_per_acre,
    monitoring_cadence_kind, monitoring_cadence_value, default_dmi_pct_bw,
    lb_dm_per_acre_inch, active, created_by, updated_by
  ) values (
    p_farm_id, trim(p_name), p_period_start, p_period_end, p_contract_number,
    p_tract_number, p_field_ids, p_long_term_goals, p_immediate_objectives,
    p_benchmark_stocking_rate_aum_per_acre,
    p_monitoring_cadence_kind, p_monitoring_cadence_value, p_default_dmi_pct_bw,
    p_lb_dm_per_acre_inch, true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- 042's signature would still be picked by any call omitting the new
-- argument. Dropped, the same way 039 dropped 038's.
drop function if exists herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric
);

revoke all on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric, numeric
) from public;
grant execute on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric, numeric
) to authenticated;
