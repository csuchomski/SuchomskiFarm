-- 042 — writing a grazing plan, and its per-paddock targets
--
-- STATUS: run 2026-08-13
--
-- Both of these are RPCs rather than PostgREST upserts, for the same reason
-- `record_valuation` was: the uniqueness they need to upsert against is a
-- **partial** index —
--
--   grazing_plans_one_active     on (farm_id) where active and deleted_at is null
--   plan_paddock_targets_uniq    on (plan_id, paddock_id) where deleted_at is null
--
-- — and PostgREST cannot infer a partial unique index for `on_conflict`. An
-- upsert from the client would either fail outright or, worse, insert a
-- duplicate the index does not cover. Doing the branch in SQL is also the only
-- place the "one active plan" rule can be enforced atomically.

-- ── the plan ───────────────────────────────────────────────────────────
--
-- Passing a null id means *start a new plan*, which deactivates the one in
-- force. That is a deliberate act — a new season's plan supersedes last
-- season's — and it happens inside this function so there is never a moment
-- with two active plans or none.
--
-- Nothing cascades from deactivating a plan. Last year's targets, concerns
-- and decisions stay exactly where they are and stay readable, which is the
-- whole point of keeping plans rather than editing one forever.

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
  p_default_dmi_pct_bw numeric default null
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
      updated_by = auth.uid(), updated_at = now(), rev = rev + 1
    where id = p_plan_id and farm_id = p_farm_id and deleted_at is null
    returning id into v_id;

    if v_id is null then
      raise exception 'That plan is not on this farm.';
    end if;
    return v_id;
  end if;

  -- New plan: the one in force steps aside first, so the partial unique
  -- index never sees two.
  update grazing_plans
     set active = false, updated_by = auth.uid(), updated_at = now(), rev = rev + 1
   where farm_id = p_farm_id and active and deleted_at is null;

  insert into grazing_plans (
    farm_id, name, period_start, period_end, contract_number, tract_number,
    field_ids, long_term_goals, immediate_objectives,
    benchmark_stocking_rate_aum_per_acre,
    monitoring_cadence_kind, monitoring_cadence_value, default_dmi_pct_bw,
    active, created_by, updated_by
  ) values (
    p_farm_id, trim(p_name), p_period_start, p_period_end, p_contract_number,
    p_tract_number, p_field_ids, p_long_term_goals, p_immediate_objectives,
    p_benchmark_stocking_rate_aum_per_acre,
    p_monitoring_cadence_kind, p_monitoring_cadence_value, p_default_dmi_pct_bw,
    true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric
) from public;
grant execute on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric
) to authenticated;

-- ── a paddock's targets ────────────────────────────────────────────────
--
-- One row per paddock per plan. Recovery is deliberately two figures rather
-- than one: a single recovery period for the whole year is the assumption
-- that gets paddocks hurt, because thirty days in June and thirty days in
-- September are not the same rest.

create or replace function herd.save_paddock_target(
  p_farm_id uuid,
  p_plan_id uuid,
  p_paddock_id uuid,
  p_target_entry_height_in numeric default null,
  p_target_residual_height_in numeric default null,
  p_min_recovery_days_growing integer default null,
  p_min_recovery_days_dormant integer default null,
  p_target_utilization_pct numeric default null,
  p_planned_grazing_notes text default null,
  p_planned_deferment_notes text default null,
  p_sensitive_area_strategy text default null,
  p_notes text default null
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
    select 1 from grazing_plans where id = p_plan_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That plan is not on this farm.';
  end if;

  if not exists (
    select 1 from paddocks where id = p_paddock_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That paddock is not on this farm.';
  end if;

  update plan_paddock_targets set
    target_entry_height_in = p_target_entry_height_in,
    target_residual_height_in = p_target_residual_height_in,
    min_recovery_days_growing = p_min_recovery_days_growing,
    min_recovery_days_dormant = p_min_recovery_days_dormant,
    target_utilization_pct = p_target_utilization_pct,
    planned_grazing_notes = p_planned_grazing_notes,
    planned_deferment_notes = p_planned_deferment_notes,
    sensitive_area_strategy = p_sensitive_area_strategy,
    notes = p_notes,
    updated_by = auth.uid(), updated_at = now(), rev = rev + 1
  where plan_id = p_plan_id and paddock_id = p_paddock_id and deleted_at is null
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  insert into plan_paddock_targets (
    farm_id, plan_id, paddock_id,
    target_entry_height_in, target_residual_height_in,
    min_recovery_days_growing, min_recovery_days_dormant,
    target_utilization_pct, planned_grazing_notes, planned_deferment_notes,
    sensitive_area_strategy, notes, created_by, updated_by
  ) values (
    p_farm_id, p_plan_id, p_paddock_id,
    p_target_entry_height_in, p_target_residual_height_in,
    p_min_recovery_days_growing, p_min_recovery_days_dormant,
    p_target_utilization_pct, p_planned_grazing_notes, p_planned_deferment_notes,
    p_sensitive_area_strategy, p_notes, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function herd.save_paddock_target(
  uuid, uuid, uuid, numeric, numeric, integer, integer, numeric, text, text, text, text
) from public;
grant execute on function herd.save_paddock_target(
  uuid, uuid, uuid, numeric, numeric, integer, integer, numeric, text, text, text, text
) to authenticated;
