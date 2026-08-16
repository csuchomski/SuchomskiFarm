-- 048 — what the cows do not eat
--
-- STATUS: run 2026-08-16
--
-- Until now the module treated everything that left the sward as feed. The
-- graze-down gives a disappearance figure — in at nine inches, off at six, so
-- a third of the standing forage went — and every calculation downstream
-- called that third "what they will eat, and once it is logged, what they
-- ate". It is not. It is what disappeared, and disappearance is not intake.
--
-- Two losses sit inside that gap, and they are different enough that one
-- number cannot hold both.
--
-- **Trampled forage leaves the sward.** Trodden in, lain on, knocked down on
-- the way past. It is inside the height drop and currently counted as eaten,
-- so it needs a straight discount on the dry matter — and it applies to the
-- forecast and to the record alike, because both start from a height drop.
--
-- **Fouled forage stays standing.** Cattle refuse the fringe around a dung
-- pat, and that grass is still there at full height when they leave. So it
-- raises the post-graze average and is *already* netted out of any intake
-- worked back from a measured residual. Only the forecast is blind to it,
-- because the forecast assumes they shear the whole strip down to target. It
-- is a discount on the strip's usable *area*, not on its dry matter, and it
-- applies before the graze-down rather than after.
--
-- Both are stored as losses rather than efficiencies. "Harvest efficiency" in
-- the extension literature means intake over forage *grown*, which is a
-- different denominator from anything this module holds, and naming a column
-- after it would invite exactly the double-count it is meant to prevent.
--
-- The defaults are the app's, not the farm's, and the UI says so. Fifteen
-- percent trodden in is the middle of what is reported for daily-move strip
-- grazing, where the mob is given a fresh break before it has time to walk
-- the last one in. Three percent fouled is this farm's own arithmetic: five
-- head at eleven or twelve pats a day, a rejected fringe of ten to twenty
-- centimetres around each, against a strip of a fifth of an acre.

alter table herd.grazing_plans
  add column if not exists trampling_loss_pct numeric,
  add column if not exists fouled_area_pct    numeric;

alter table herd.grazing_plans
  drop constraint if exists grazing_plans_loss_range;
alter table herd.grazing_plans
  add constraint grazing_plans_loss_range check (
    (trampling_loss_pct is null or (trampling_loss_pct >= 0 and trampling_loss_pct < 100))
    and (fouled_area_pct is null or (fouled_area_pct >= 0 and fouled_area_pct < 100))
  );

comment on column herd.grazing_plans.trampling_loss_pct is
  'Share of the forage that disappears which is trodden in rather than eaten. Discounts dry matter, in the forecast and in the record.';
comment on column herd.grazing_plans.fouled_area_pct is
  'Share of a strip refused around dung. Discounts usable area in the forecast only — a measured residual already carries it.';

-- The 16-argument signature has to go explicitly. `create or replace` matches
-- on the exact argument list, so without this drop the farm would be left
-- with two overloads and PostgREST picking between them by argument names —
-- the trap migration 011 fell into.
drop function if exists herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text,
  numeric, text, numeric, numeric, numeric, numeric);

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
  p_trampling_loss_pct numeric default null,
  p_fouled_area_pct    numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_id uuid;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  if p_name is null or trim(p_name) = '' then
    raise exception 'A plan needs a name.';
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
    trampling_loss_pct, fouled_area_pct, active, created_by, updated_by
  ) values (
    p_farm_id, trim(p_name), p_period_start, p_period_end, p_contract_number,
    p_tract_number, p_field_ids, p_long_term_goals, p_immediate_objectives,
    p_benchmark_stocking_rate_aum_per_acre,
    p_monitoring_cadence_kind, p_monitoring_cadence_value, p_default_dmi_pct_bw,
    p_lb_dm_per_acre_inch, p_target_residual_height_in,
    p_trampling_loss_pct, p_fouled_area_pct, true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text,
  numeric, text, numeric, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text,
  numeric, text, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;
