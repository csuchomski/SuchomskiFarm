-- 028 — Did it take, and then she calved.
--
-- STATUS: RUN, 2026-08-08. Verified as the farmer in a rolled-back
-- transaction, so RLS applied:
--   a check found its own breeding: 35 days bred, conception = the service
--   twins on a dairy dam -> live heifer got an animals row (calf,
--     born_on_farm, dam and sire filled in, purpose inherited); the
--     stillborn twin got an outcome and no animal
--   her lactation 3 closed at the calving date with reason 'calved', and
--     lactation 4 opened against this calving
--   a beef dam got no lactation, and her calf inherited purpose 'beef'
--   a second calving the same day did not open a second lactation
--   no calves, a live calf with no sex, a male 'dam', an unknown method, an
--     unknown result, and a check dated before the service were each refused
--
-- The first rehearsal failed on `lactations_one_open_per_animal`, which is
-- why the freshening block closes the open lactation first — see the note
-- there.
-- Depends on: 027 (breeding_events are now written).
--
-- ── What's already here ───────────────────────────────────────────────
--
-- The same story as 027: every table exists and none has ever had a row.
--
--   pregnancy_checks   method  palpation | ultrasound | blood_biopryn |
--                              milk_test | visual
--                      result  open | pregnant | recheck | aborted
--                      breeding_event_id, estimated_days_bred,
--                      estimated_conception_date
--
--   calvings           dam_id, calving_ease 1-5, assistance, presentation,
--                      retained_placenta, is_twin, breeding_event_id
--
--   calving_outcomes   one row per calf: outcome live | stillborn |
--                      died_within_24h, sex, birth_weight_lb, vigor_score,
--                      is_freemartin, and calf_animal_id -> animals
--
-- Note what is *not* here. herd.ultrasound_scans is carcass ultrasound —
-- imf_pct, ribeye_area_sqin, backfat_in, rump_fat_in. It is a beef seedstock
-- measurement and has nothing to do with pregnancy; a pregnancy ultrasound is
-- a pregnancy_checks row with method 'ultrasound'. This migration leaves that
-- table alone.
--
-- ── Why functions ─────────────────────────────────────────────────────
--
-- A pregnancy check could be a plain insert, and the one thing a function
-- buys is that the check attaches itself to the right breeding and works out
-- how many days bred she was — done client-side, those two would drift from
-- whatever the breeding actually says.
--
-- A calving cannot be a plain insert. It is:
--
--   1. the calvings row
--   2. one calving_outcomes row per calf
--   3. an animals row per *live* calf, with its dam and sire filled in
--   4. calving_outcomes.calf_animal_id pointing at each
--   5. a lactation opened for a dairy dam, which is what freshening is
--
-- Half of that is a calving with calves nobody can find, or calves with no
-- calving behind them.
--
-- ── Two rules worth stating ───────────────────────────────────────────
--
-- A live calf needs a sex before it can become an animal, because
-- animals.sex is NOT NULL. A calf recorded without one is kept as an
-- outcome and no animal is created — better than inventing a sex.
--
-- The lactation is opened for a dairy or dual dam regardless of how the calf
-- did. A stillborn calf still freshens her, and pretending otherwise would
-- lose the lactation her milk belongs to. It is skipped if she already has
-- one dated that day, so recording a calving after a freshening on the
-- Lactations page doesn't produce two.

begin;

create or replace function herd.record_pregnancy_check(
  p_animal_id uuid,
  p_date date,
  p_method text,
  p_result text,
  p_breeding_event_id uuid default null,
  p_technician text default '',
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare v_farm uuid; v_sex text; v_name text; v_breeding uuid; v_bred_on date; v_id uuid;
begin
  if p_method not in ('palpation', 'ultrasound', 'blood_biopryn', 'milk_test', 'visual') then
    raise exception 'Unknown check method: %', p_method;
  end if;
  if p_result not in ('open', 'pregnant', 'recheck', 'aborted') then
    raise exception 'A check comes back open, pregnant, recheck or aborted';
  end if;

  select farm_id, sex, coalesce(nullif(barn_name, ''), ear_tag)
    into v_farm, v_sex, v_name
    from animals where id = p_animal_id and deleted_at is null;
  if v_farm is null then raise exception 'Animal not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to record a check for that animal';
  end if;
  if v_sex <> 'female' then raise exception '% is not a female', v_name; end if;

  -- The breeding this is about: the one given, or her most recent standing
  -- service on or before the day of the check.
  v_breeding := p_breeding_event_id;
  if v_breeding is null then
    select id into v_breeding from breeding_events
     where animal_id = p_animal_id and not voided and deleted_at is null and date <= p_date
     order by date desc, created_at desc limit 1;
  end if;

  if v_breeding is not null then
    select date into v_bred_on from breeding_events where id = v_breeding;
    if v_bred_on is null then raise exception 'That breeding is not on file'; end if;
    if v_bred_on > p_date then
      raise exception 'She was bred on %, which is after this check', v_bred_on;
    end if;
  end if;

  insert into pregnancy_checks (
    animal_id, date, method, result, estimated_days_bred, estimated_conception_date,
    breeding_event_id, technician, notes, farm_id, created_by, updated_by
  ) values (
    p_animal_id, p_date, p_method, p_result,
    case when v_bred_on is null then null else p_date - v_bred_on end,
    v_bred_on,
    v_breeding, coalesce(p_technician, ''), coalesce(p_notes, ''), v_farm, auth.uid(), auth.uid()
  ) returning id into v_id;

  return v_id;
end $function$;

comment on function herd.record_pregnancy_check(uuid, date, text, text, uuid, text, text) is
  'Record a pregnancy check. Attaches itself to her most recent standing '
  'breeding unless told otherwise, and derives days bred from it.';

-- ── the calving ───────────────────────────────────────────────────────
--
-- p_calves is a jsonb array, one object per calf:
--   [{"outcome": "live", "sex": "female", "ear_tag": "12",
--     "barn_name": "Bess", "birth_weight_lb": 78, "vigor_score": 8,
--     "is_freemartin": false, "notes": ""}]

create or replace function herd.record_calving(
  p_dam_id uuid,
  p_date date,
  p_calves jsonb default '[]'::jsonb,
  p_calving_ease integer default 1,
  p_assistance text default 'unassisted',
  p_presentation text default 'anterior',
  p_retained_placenta boolean default false,
  p_notes text default '',
  p_breeding_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_sex text; v_name text; v_purpose text;
  v_breeding uuid; v_sire uuid; v_id uuid;
  v_calf jsonb; v_outcome text; v_calf_sex text; v_tag text; v_animal uuid;
  v_count integer; v_lact integer;
begin
  select farm_id, sex, coalesce(nullif(barn_name, ''), ear_tag), purpose
    into v_farm, v_sex, v_name, v_purpose
    from animals where id = p_dam_id and deleted_at is null;
  if v_farm is null then raise exception 'Animal not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to record a calving for that animal';
  end if;
  if v_sex <> 'female' then raise exception '% is not a female', v_name; end if;

  if jsonb_typeof(p_calves) <> 'array' or jsonb_array_length(p_calves) = 0 then
    raise exception 'A calving needs at least one calf, even a stillborn one';
  end if;

  -- Validate every calf before writing anything, so a bad one can't leave
  -- half a calving on the record.
  for v_calf in select * from jsonb_array_elements(p_calves) loop
    v_outcome := v_calf ->> 'outcome';
    v_calf_sex := coalesce(v_calf ->> 'sex', '');
    if v_outcome not in ('live', 'stillborn', 'died_within_24h') then
      raise exception 'Each calf is live, stillborn or died_within_24h';
    end if;
    if v_calf_sex not in ('', 'female', 'male') then
      raise exception 'A calf is female or male, or not recorded';
    end if;
    if v_outcome = 'live' and v_calf_sex = '' then
      raise exception 'A live calf needs a sex before it can have a record of its own';
    end if;
  end loop;

  v_breeding := p_breeding_event_id;
  if v_breeding is null then
    select id into v_breeding from breeding_events
     where animal_id = p_dam_id and not voided and deleted_at is null and date < p_date
     order by date desc, created_at desc limit 1;
  end if;
  if v_breeding is not null then
    select sire_id into v_sire from breeding_events where id = v_breeding;
  end if;

  v_count := jsonb_array_length(p_calves);

  insert into calvings (
    dam_id, date, calving_ease, assistance, presentation, retained_placenta,
    breeding_event_id, is_twin, notes, farm_id, created_by, updated_by
  ) values (
    p_dam_id, p_date, p_calving_ease, p_assistance, p_presentation, p_retained_placenta,
    v_breeding, v_count > 1, coalesce(p_notes, ''), v_farm, auth.uid(), auth.uid()
  ) returning id into v_id;

  for v_calf in select * from jsonb_array_elements(p_calves) loop
    v_outcome := v_calf ->> 'outcome';
    v_calf_sex := coalesce(v_calf ->> 'sex', '');
    v_tag := btrim(coalesce(v_calf ->> 'ear_tag', ''));
    v_animal := null;

    -- A live calf becomes an animal, with its parents already filled in —
    -- the dam from this calving, the sire from the breeding behind it.
    if v_outcome = 'live' then
      insert into animals (
        ear_tag, barn_name, sex, class, status, birth_date, purpose, origin,
        record_type, dam_id, sire_id, farm_id, created_by, updated_by
      ) values (
        v_tag, btrim(coalesce(v_calf ->> 'barn_name', '')), v_calf_sex, 'calf', 'active',
        p_date, v_purpose, 'born_on_farm', 'herd', p_dam_id, v_sire, v_farm,
        auth.uid(), auth.uid()
      ) returning id into v_animal;
    end if;

    insert into calving_outcomes (
      calving_id, calf_animal_id, outcome, sex, birth_weight_lb, is_freemartin,
      vigor_score, notes, farm_id, created_by, updated_by
    ) values (
      v_id, v_animal, v_outcome, v_calf_sex,
      (v_calf ->> 'birth_weight_lb')::numeric,
      coalesce((v_calf ->> 'is_freemartin')::boolean, false),
      (v_calf ->> 'vigor_score')::integer,
      coalesce(v_calf ->> 'notes', ''), v_farm, auth.uid(), auth.uid()
    );
  end loop;

  -- Freshening. A stillborn calf still starts her lactation, so this doesn't
  -- look at the outcomes at all.
  if v_purpose in ('dairy', 'dual')
     and not exists (
       select 1 from lactations
        where animal_id = p_dam_id and fresh_date = p_date and deleted_at is null
     ) then
    -- `lactations_one_open_per_animal` is a partial unique index: one
    -- lactation per animal with no dry_off_date. She cannot freshen into a
    -- new one while the last is still open, and the rehearsal of this
    -- migration hit exactly that — Patience had lactation 3 open.
    --
    -- Closing it at the calving date is the honest reading: dry-off usually
    -- happens weeks earlier and simply wasn't recorded, and the calving is
    -- the latest moment it can possibly have been. The alternative is
    -- refusing the calving until someone dries her off by hand, which is a
    -- worse answer at 3am in a calving pen.
    update lactations
       set dry_off_date = p_date,
           termination_reason = case when termination_reason = '' then 'calved' else termination_reason end,
           updated_by = auth.uid(), updated_at = now()
     where animal_id = p_dam_id and dry_off_date is null and deleted_at is null;

    select coalesce(max(lactation_number), 0) + 1 into v_lact
      from lactations where animal_id = p_dam_id and deleted_at is null;

    insert into lactations (animal_id, lactation_number, fresh_date, calving_id, farm_id, created_by, updated_by)
    values (p_dam_id, v_lact, p_date, v_id, v_farm, auth.uid(), auth.uid());
  end if;

  return v_id;
end $function$;

comment on function herd.record_calving(uuid, date, jsonb, integer, text, text, boolean, text, uuid) is
  'Record a calving, its calves, an animal record for each live one, and — '
  'for a dairy dam — the lactation it freshens. One transaction, because a '
  'calf with no calving behind it is worse than no calf.';

grant execute on function herd.record_pregnancy_check(uuid, date, text, text, uuid, text, text) to authenticated;
grant execute on function herd.record_calving(uuid, date, jsonb, integer, text, text, boolean, text, uuid) to authenticated;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'herd' and p.proname in ('record_pregnancy_check', 'record_calving');
--     -- exactly two rows, no overloads
--
-- And with RLS applied, inside a transaction you roll back:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--   select herd.record_breeding('<a dairy cow>', current_date - 300, 'natural', '<a bull>');
--   select herd.record_pregnancy_check('<her>', current_date - 265, 'palpation', 'pregnant');
--     -- estimated_days_bred 35, and breeding_event_id filled in by itself
--   select herd.record_calving('<her>', current_date,
--            '[{"outcome":"live","sex":"female","ear_tag":"99","birth_weight_lb":80}]'::jsonb);
--   select class, origin, dam_id, sire_id from herd.animals where ear_tag = '99';
--   select lactation_number, fresh_date, calving_id from herd.lactations where animal_id = '<her>';
--
-- Rollback:
--   drop function if exists herd.record_pregnancy_check(uuid, date, text, text, uuid, text, text);
--   drop function if exists herd.record_calving(uuid, date, jsonb, integer, text, text, boolean, text, uuid);
