-- 034 — Attach a service to a calving that was recorded without one.
--
-- STATUS: not yet run.
-- Depends on: 031 (record_calving adopts an existing calf).
--
-- ── The report ────────────────────────────────────────────────────────
--
--   "why does vera not show her sire. The breeding shows that Patience and
--    Overalls had Vera."
--
-- The timestamps answer it:
--
--   2026-08-10 12:21  Patience's calving recorded, Vera adopted as the calf
--   2026-08-10 14:19  Patience bred 2023-07-01 by Overalls  — logged after
--   2026-08-10 14:26  Patience bred 2023-09-26 by Overalls  — logged after
--
-- record_calving takes the service either by name or by falling back to "her
-- most recent standing service before this date". At 12:21 she had exactly
-- one service on file, dated 2026-01-07 — two years *after* the calving — so
-- the fallback found nothing, breeding_event_id stayed null, and the calf got
-- no sire. The two Overalls services arrived two hours later and nothing
-- reached back for them.
--
-- That is not a mis-entry to be scolded about. Recording a season out of the
-- notebook happens in whatever order the notebook is in, and every animal
-- entered before Calvings existed will be assembled the same way. What was
-- missing is the join, after the fact.
--
-- ── What this adds ────────────────────────────────────────────────────
--
-- herd.attach_service_to_calving(calving, service). It sets the link, puts
-- that service's sire on the calving's live calves, and — now that a sire
-- exists — gives each calf the breed composition it should have inherited,
-- on exactly the terms record_calving uses: half from each parent, only when
-- both are on file, and never over a composition already there.
--
-- Re-pointing is allowed, because a service attached to the wrong calving is
-- the same kind of mistake and wants the same cure. A calf's sire is moved
-- only when it is null or still the *old* service's sire — a sire someone set
-- by hand is not this function's to overwrite.
--
-- Which service is Vera's is not a guess the database makes. Patience has two
-- Overalls services before that birth: 2023-07-01, which at a Jersey's 279
-- days is 95 days out and not a gestation, and 2023-09-26, which is 8 days
-- out and plainly is. The app suggests by that arithmetic and the farmer
-- confirms; see lib/repro-timeline likelyService, which already does this for
-- the calving form.

begin;

create or replace function herd.attach_service_to_calving(
  p_calving_id uuid,
  p_breeding_event_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_dam uuid; v_date date; v_was uuid; v_old_sire uuid; v_sire uuid;
  v_calf uuid;
begin
  select farm_id, dam_id, date, breeding_event_id
    into v_farm, v_dam, v_date, v_was
    from calvings where id = p_calving_id and deleted_at is null;
  if v_farm is null then raise exception 'Calving not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to change that calving';
  end if;

  if not exists (
    select 1 from breeding_events
     where id = p_breeding_event_id and animal_id = v_dam and deleted_at is null and date < v_date
  ) then
    raise exception 'That service is not one of hers before this calving';
  end if;

  if v_was is not null then
    select sire_id into v_old_sire from breeding_events where id = v_was;
  end if;
  select sire_id into v_sire from breeding_events where id = p_breeding_event_id;

  update calvings
     set breeding_event_id = p_breeding_event_id, updated_by = auth.uid(), updated_at = now()
   where id = p_calving_id;

  -- Each live calf of this calving.
  for v_calf in
    select calf_animal_id from calving_outcomes
     where calving_id = p_calving_id and calf_animal_id is not null and deleted_at is null
  loop
    -- Only where it is unset, or still whatever the previous service said. A
    -- sire entered by hand outranks one inferred from a link.
    update animals
       set sire_id = v_sire, updated_by = auth.uid(), updated_at = now()
     where id = v_calf
       and (sire_id is null or (v_old_sire is not null and sire_id = v_old_sire));

    -- The inheritance record_calving would have done, had the service been
    -- there at the time. Same terms: half from each, both parents or neither,
    -- and never over a composition already on file.
    if v_sire is not null
       and not exists (select 1 from breed_composition where animal_id = v_calf and deleted_at is null)
       and exists (select 1 from breed_composition where animal_id = v_dam and deleted_at is null)
       and exists (select 1 from breed_composition where animal_id = v_sire and deleted_at is null)
    then
      insert into breed_composition (animal_id, breed_id, percent, farm_id, created_by, updated_by)
      select v_calf, s.breed_id, round(sum(s.share) / 2, 2), v_farm, auth.uid(), auth.uid()
      from (
        select bc.breed_id, bc.percent * 100.0 / sum(bc.percent) over () as share
          from breed_composition bc where bc.animal_id = v_dam and bc.deleted_at is null
        union all
        select bc.breed_id, bc.percent * 100.0 / sum(bc.percent) over ()
          from breed_composition bc where bc.animal_id = v_sire and bc.deleted_at is null
      ) s
      group by s.breed_id
      having round(sum(s.share) / 2, 2) > 0;
    end if;
  end loop;
end $function$;

grant execute on function herd.attach_service_to_calving(uuid, uuid) to authenticated;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
-- As the farmer, inside a rolled-back transaction:
--
--   select herd.attach_service_to_calving('<Vera''s calving>', '<2023-09-26>');
--   -- Vera's sire becomes Overalls; her breeds are already on file so they
--   -- are left alone; the calving names the service.
--
--   select herd.attach_service_to_calving('<Vera''s calving>', '<2026-01-07>');
--   -- refused: that service is after the calving.
--
--   select herd.attach_service_to_calving('<Vera''s calving>', '<Martha''s>');
--   -- refused: not one of hers.
