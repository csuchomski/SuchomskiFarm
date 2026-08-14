-- 045 — the height they graze down to
--
-- STATUS: run 2026-08-14. Verified as `authenticated` in a rolled-back
--   transaction: one signature survives the drop; 4 in round-trips through an
--   update; blank clears it back to null; zero refused; another farm's plan
--   refused; 043's lb/acre-inch untouched at 300.
--
--   One check needed rewriting rather than believing: reading the column back
--   inside the same statement that called the function returned null, because
--   a statement sees the snapshot it started with. Two statements, and it
--   reads 4. The function was right and the test was wrong.
--
-- The farm's own framing: "we can't assume the cows are eating all of the
-- grass available. I want to be able to set the average height in a paddock
-- and the height I want them to eat to."
--
-- That is the right model and it is not the one the app had. The app took a
-- height, turned it into pounds standing, then discounted it by a utilization
-- percentage — a number nobody on a farm sets, measures, or particularly
-- believes. A grazier sets a graze-down: in at eight inches, off at four.
-- What comes off is the difference.
--
--     usable lb DM/acre = (entry height − residual height) × lb per acre-inch
--
-- Nothing downstream has to change, because utilization stops being an input
-- and becomes an *outcome*:
--
--     utilization = (entry − residual) ÷ entry
--
-- Feed that back in place of the typed percentage and the arithmetic already
-- in the app — standing × utilization — lands on exactly the expression
-- above. Which is the point of doing it this way: one path through the
-- calculation, and no way to apply the discount twice.
--
-- ── Where the figure lives ────────────────────────────────────────────
--
-- Per paddock it already exists. `plan_paddock_targets.target_residual_height_in`
-- has been in the schema since 038 and the Plan page has always edited it. All
-- five of this farm's are null, which is why nothing has ever used it.
--
-- What is missing is a farm-wide default, so the per-paddock figure can stay
-- an exception rather than five copies of one number. It goes beside
-- `default_dmi_pct_bw` and `lb_dm_per_acre_inch`, which are the same kind of
-- fact: the farm's figure, applied everywhere until a paddock says otherwise.

alter table herd.grazing_plans
  add column if not exists target_residual_height_in numeric;

comment on column herd.grazing_plans.target_residual_height_in is
  'Default height in inches to graze down to. Overridden per paddock by '
  'plan_paddock_targets.target_residual_height_in. Together with an entry '
  'height it replaces the utilization percentage rather than compounding '
  'with it.';

-- ── The plan write ────────────────────────────────────────────────────
--
-- 043 replaced this at fifteen arguments. Sixteen now, and the fifteen is
-- dropped below: `create or replace function` matches on the exact signature,
-- so without the drop both survive and PostgREST chooses between them by
-- argument name at runtime. That has bitten this database once already —
-- migration 011 left a `reserve_product` overload behind the same way, and
-- 012 existed only to clear it up.

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
  p_lb_dm_per_acre_inch numeric default null,
  p_target_residual_height_in numeric default null
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

  -- Null means "not set", which is allowed and falls back to a utilization
  -- percentage. Zero or negative is not a harder graze, it is a typo, and it
  -- would take the whole sward and then some.
  if p_target_residual_height_in is not null and p_target_residual_height_in <= 0 then
    raise exception 'The graze-down height has to be above zero.';
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
      target_residual_height_in = p_target_residual_height_in,
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
    lb_dm_per_acre_inch, target_residual_height_in, active, created_by, updated_by
  ) values (
    p_farm_id, trim(p_name), p_period_start, p_period_end, p_contract_number,
    p_tract_number, p_field_ids, p_long_term_goals, p_immediate_objectives,
    p_benchmark_stocking_rate_aum_per_acre,
    p_monitoring_cadence_kind, p_monitoring_cadence_value, p_default_dmi_pct_bw,
    p_lb_dm_per_acre_inch, p_target_residual_height_in, true, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- 043's signature would still be picked by any call omitting the new
-- argument. Dropped, the same way 043 dropped 042's.
drop function if exists herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric, numeric
);

revoke all on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric, numeric, numeric
) from public;
grant execute on function herd.save_grazing_plan(
  uuid, uuid, text, date, date, text, text, text, text, text, numeric, text, numeric, numeric, numeric, numeric
) to authenticated;

-- ── Verification ──────────────────────────────────────────────────────
--
-- Run as `authenticated` inside a rolled-back transaction — not from the SQL
-- editor as superuser, where every permission check passes and proves
-- nothing. The actual results are recorded under STATUS above.
--
--   begin;
--   create temp table res(what text, got text);
--   grant insert on res to authenticated;
--   set local role authenticated;
--   set local request.jwt.claims =
--     '{"sub":"c3bec7a2-9b0d-4ec6-8994-accd67660e1f","role":"authenticated"}';
--
--   -- 1. exactly one signature survives the drop
--   insert into res select 'signatures', count(*)::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'herd' and p.proname = 'save_grazing_plan';
--
--   -- 2. the figure round-trips through an update
--   insert into res select 'saves 4in', (
--     select target_residual_height_in::text from herd.grazing_plans
--      where id = herd.save_grazing_plan(
--        '309fcb68-7a38-456e-bc81-fd212ea50d10',
--        (select id from herd.grazing_plans
--          where farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'
--            and active and deleted_at is null limit 1),
--        '2026', null, null, null, null, null, null, null,
--        null, 'every_rotation', null, 3, 300, 4));
--
--   -- 3. zero is refused
--   do $$
--   begin
--     perform herd.save_grazing_plan(
--       '309fcb68-7a38-456e-bc81-fd212ea50d10',
--       (select id from herd.grazing_plans
--         where farm_id = '309fcb68-7a38-456e-bc81-fd212ea50d10'
--           and active and deleted_at is null limit 1),
--       '2026', null, null, null, null, null, null, null,
--       null, 'every_rotation', null, 3, 300, 0);
--     insert into res values ('zero refused', 'NO — it was accepted');
--   exception when others then
--     insert into res values ('zero refused', 'yes');
--   end $$;
--
--   -- 4. another farm's plan is still refused
--   do $$
--   begin
--     perform herd.save_grazing_plan(
--       '00000000-0000-0000-0000-000000000000', null, 'x',
--       null, null, null, null, null, null, null,
--       null, 'every_rotation', null, 3, 300, 4);
--     insert into res values ('foreign farm refused', 'NO — it was accepted');
--   exception when others then
--     insert into res values ('foreign farm refused', 'yes');
--   end $$;
--
--   select * from res;
--   rollback;
--
-- Rollback, if it comes to that — note this leaves the 16-argument function
-- in place, so drop it too and re-run 043's definition:
--
--   alter table herd.grazing_plans drop column target_residual_height_in;
