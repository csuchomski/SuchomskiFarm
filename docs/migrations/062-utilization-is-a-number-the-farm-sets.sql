-- 062 — Utilization is a number the farm sets, not two the app guesses.
--
-- The forecast took three bites out of a sward: the graze-down, then 15% for
-- what goes under a hoof, then 3% of the ground refused around dung. Only the
-- first came from the farm. The other two were this app's figures for "a
-- daily-move mob", and on this farm both were left blank, so both were the
-- app's the whole time.
--
-- ── What the owner said ─────────────────────────────────────────────────
--
--   "If the mob grazes down from 12" to 6", we can't assume that's all
--    eaten. That's why we need the utilization percentage. The utilization
--    percentage is the percent of take down forage actually consumed and
--    what should be compared against when taking the 3% of the mob's total
--    weight."
--
-- So the model is three named steps rather than a stack of deductions:
--
--   take-down  = (entry − residual) × lb DM per acre-inch   ← what vanished
--   consumed   = take-down × utilization                    ← what was eaten
--   demand     = mob weight × intake %                      ← what they need
--
-- The arithmetic barely moves. `standing × (entry − residual) / entry` is
-- already exactly the take-down, and the trampling percentage was already
-- sitting in the place utilization now occupies. What changes is whose number
-- it is, and that it is one number with a name a grazier uses rather than two
-- corrections nobody set.
--
-- ── The columns that are left ───────────────────────────────────────────
--
-- `trampling_loss_pct` and `fouled_area_pct` stay on the table. Nothing reads
-- them after this and the plan form no longer offers them, but they are null
-- on every plan on file and dropping a column to tidy up is a destructive
-- change made for neatness. If they are still unused in a season, drop them
-- then and know what is being thrown away.
--
-- `plan_paddock_targets.target_utilization_pct` also stays and also goes
-- unread. It was already unreachable wherever a paddock had entry and
-- residual heights, which is every paddock on this farm — and its values show
-- what an unread column collects: Paddock 1 holds 1%, Paddocks 4 and 5 hold
-- 50%. A per-paddock override may be worth having again, but it should be
-- added back deliberately and with a meaning stated, not inherited.

begin;

alter table herd.grazing_plans
  add column if not exists default_utilization_pct numeric;

-- A share, and a real one. Zero would mean the mob ate nothing at all, which
-- is not a plan; above 100 would mean they ate more than disappeared.
alter table herd.grazing_plans
  drop constraint if exists grazing_plans_utilization_range;
alter table herd.grazing_plans
  add constraint grazing_plans_utilization_range
  check (default_utilization_pct is null or (default_utilization_pct > 0 and default_utilization_pct <= 100));

comment on column herd.grazing_plans.default_utilization_pct is
  'The share of the take-down actually eaten, as a percentage. Take-down is '
  'what disappeared between entry and residual height; this is how much of it '
  'went into an animal rather than under a hoof. Null leaves the app''s stated '
  'figure standing.';

-- ── the plan form's write path ──────────────────────────────────────────
--
-- Reprinted from the live definition with the new parameter added and the two
-- old ones left in place. They are kept so an older client still saves rather
-- than failing on an unknown argument — PostgREST matches an RPC by the names
-- it is given, and a deploy is not simultaneous.
--
-- **The old signature is dropped first, and that is not tidiness.** `CREATE OR
-- REPLACE FUNCTION` only replaces on an exact argument-type match, so adding
-- a parameter — even one with a default — creates a second overload beside
-- the first. Both then match a call that omits the new argument, and Postgres
-- refuses it as ambiguous: "function herd.save_grazing_plan(...) is not
-- unique". The rehearsal caught exactly that, which is the same way migration
-- 011 grew a duplicate `reserve_product`.

drop function if exists herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text,
  numeric, numeric, numeric, numeric, numeric, numeric
);

create or replace function herd.save_grazing_plan(
  p_farm_id uuid,
  p_plan_id uuid,
  p_name text,
  p_period_start date,
  p_period_end date,
  p_contract_number text,
  p_tract_number text,
  p_field_ids text,
  p_long_term_goals text,
  p_immediate_objectives text,
  p_benchmark_stocking_rate_aum_per_acre numeric,
  p_monitoring_cadence_kind text,
  p_monitoring_cadence_value numeric,
  p_default_dmi_pct_bw numeric,
  p_lb_dm_per_acre_inch numeric,
  p_target_residual_height_in numeric,
  p_trampling_loss_pct numeric default null::numeric,
  p_fouled_area_pct numeric default null::numeric,
  p_default_utilization_pct numeric default null::numeric
) returns uuid
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

  if p_name is null or trim(p_name) = '' then
    raise exception 'A plan needs a name.';
  end if;

  if p_default_utilization_pct is not null
     and (p_default_utilization_pct <= 0 or p_default_utilization_pct > 100) then
    raise exception 'Utilization is a share of what came off, between 0 and 100';
  end if;

  if p_plan_id is not null then
    update grazing_plans
       set name = trim(p_name),
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
           target_residual_height_in = p_target_residual_height_in,
           trampling_loss_pct = p_trampling_loss_pct,
           fouled_area_pct = p_fouled_area_pct,
           default_utilization_pct = p_default_utilization_pct,
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
    lb_dm_per_acre_inch, target_residual_height_in,
    trampling_loss_pct, fouled_area_pct, default_utilization_pct,
    active, created_by, updated_by
  ) values (
    p_farm_id, trim(p_name), p_period_start, p_period_end, p_contract_number,
    p_tract_number, p_field_ids, p_long_term_goals, p_immediate_objectives,
    p_benchmark_stocking_rate_aum_per_acre,
    p_monitoring_cadence_kind, p_monitoring_cadence_value, p_default_dmi_pct_bw,
    p_lb_dm_per_acre_inch, p_target_residual_height_in,
    p_trampling_loss_pct, p_fouled_area_pct, p_default_utilization_pct,
    true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

commit;
