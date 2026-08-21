-- 059 — An ear tag is required, and unique within a farm.
--
-- A bull calf called Victor was added on 2026-08-21 and his record would not
-- open. His `ear_tag` is the empty string, and `/animals/:tag` resolves an
-- animal by tag, so his only link pointed at `/animals/` and there was
-- nothing to fetch. He was created by `herd.record_calving`, which takes the
-- calf's tag as given —
--
--   v_tag := btrim(coalesce(v_calf ->> 'ear_tag', ''));
--
-- — and inserts it whatever it is. The calving forms never asked for one.
-- His row and the calving that made him share a `created_at` to the
-- microsecond, so this is the path, not a guess.
--
-- `herd.animals.ear_tag` is NOT NULL, which an empty string satisfies, and
-- there is no unique index. So the column the app uses as identity is
-- neither required nor unique in the database, and the only thing standing
-- between the herd and an unreachable animal is a form.
--
-- ── What is enforced, and where ─────────────────────────────────────────
--
-- A live calf getting a **new** record needs a tag. A calf adopting a record
-- already on file does not — it brings that record's tag with it, and the
-- form disables the field. A stillborn calf gets no animal record at all, so
-- it is never asked.
--
-- The checks go in the pre-flight loop, before the calving row is written.
-- Raising later would leave a calving on file with a calf missing from it,
-- since the whole function is one statement's worth of work but the caller
-- sees only the exception.
--
-- ── Unique within a farm, not globally ──────────────────────────────────
--
-- Martha is tag 1 on Suchomski Family Farm and an animal called "test" is
-- tag 1 on Rocky Ridge. That is not a collision and must keep working: farms
-- number their own animals. The index is therefore on `(farm_id, ear_tag)`,
-- which is also exactly what `AnimalForm` has always checked on the client —
-- it compares against the herd the account can read, and RLS scopes that to
-- one farm.
--
-- Blank tags are excluded from the index rather than blocked by a CHECK.
-- Victor is on file with one and a CHECK would refuse every future update to
-- his row, including the one that gives him a tag. Excluding '' lets the
-- existing rows be fixed in the app instead of by hand here — this migration
-- does not invent a number for somebody's bull calf.
--
-- Verified against the live database first: no farm has two animals sharing
-- a tag today, so the index builds.

begin;

-- ── the index ───────────────────────────────────────────────────────────

create unique index if not exists animals_farm_ear_tag_uniq
  on herd.animals (farm_id, ear_tag)
  where deleted_at is null and ear_tag <> '';

comment on index herd.animals_farm_ear_tag_uniq is
  'A tag identifies one animal on one farm. Two farms may both use number 1; '
  'one farm may not. Blank tags are excluded so rows predating 059 can still '
  'be updated — record_calving refuses to write new ones.';

-- ── record_calving ──────────────────────────────────────────────────────
--
-- Reprinted from the live definition with three checks added to the
-- pre-flight loop and nothing else changed.

create or replace function herd.record_calving(
  p_dam_id uuid,
  p_date date,
  p_calves jsonb default '[]'::jsonb,
  p_calving_ease integer default 1,
  p_assistance text default 'unassisted'::text,
  p_presentation text default 'anterior'::text,
  p_retained_placenta boolean default false,
  p_notes text default ''::text,
  p_breeding_event_id uuid default null::uuid
) returns uuid
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_sex text; v_name text; v_purpose text;
  v_breeding uuid; v_sire uuid; v_id uuid;
  v_calf jsonb; v_outcome text; v_calf_sex text; v_tag text; v_animal uuid;
  v_count integer; v_lact integer;
  v_adopt uuid; v_a record; v_next_fresh date;
  v_seen text[] := '{}';
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
    if (v_calf ->> 'animal_id') is not null and v_outcome <> 'live' then
      raise exception 'Only a live calf can be an animal already on file';
    end if;

    -- The tag is how a record is reached. A calf adopting a record already on
    -- file brings that record's tag with it and is not asked for one.
    if v_outcome = 'live' and nullif(v_calf ->> 'animal_id', '') is null then
      v_tag := btrim(coalesce(v_calf ->> 'ear_tag', ''));
      if v_tag = '' then
        raise exception 'A live calf needs an ear tag — it is how her record is found later';
      end if;
      if exists (
        select 1 from animals
         where farm_id = v_farm and ear_tag = v_tag and deleted_at is null
      ) then
        raise exception 'Tag % is already on another animal', v_tag;
      end if;
      if v_tag = any (v_seen) then
        raise exception 'Both calves are down as tag %', v_tag;
      end if;
      v_seen := v_seen || v_tag;
    end if;
  end loop;

  v_breeding := p_breeding_event_id;
  if v_breeding is null then
    select id into v_breeding from breeding_events
     where animal_id = p_dam_id and not voided and deleted_at is null and date < p_date
     order by date desc, created_at desc limit 1;
  else
    if not exists (
      select 1 from breeding_events
       where id = v_breeding and animal_id = p_dam_id and deleted_at is null and date < p_date
    ) then
      raise exception 'That service is not one of hers before this calving';
    end if;
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
    v_adopt := nullif(v_calf ->> 'animal_id', '')::uuid;
    v_animal := null;

    if v_outcome = 'live' and v_adopt is not null then
      select id, farm_id, sex, birth_date, dam_id, sire_id,
             coalesce(nullif(barn_name, ''), ear_tag, 'that animal') as label
        into v_a
        from animals where id = v_adopt and deleted_at is null;

      if v_a.id is null then raise exception 'That calf is not on file'; end if;
      if v_a.farm_id <> v_farm then raise exception 'That calf belongs to another farm'; end if;
      if v_a.id = p_dam_id then raise exception 'A cow cannot be her own calf'; end if;

      if exists (
        select 1 from calving_outcomes where calf_animal_id = v_adopt and deleted_at is null
      ) then
        raise exception '% is already recorded against a calving', v_a.label;
      end if;

      if v_a.birth_date <> p_date then
        raise exception '% is on file as born %, not % — fix one of the two first',
          v_a.label, v_a.birth_date, p_date;
      end if;
      if v_calf_sex <> '' and v_a.sex <> v_calf_sex then
        raise exception '% is on file as %, not %', v_a.label, v_a.sex, v_calf_sex;
      end if;
      if v_a.dam_id is not null and v_a.dam_id <> p_dam_id then
        raise exception '% is already out of a different dam', v_a.label;
      end if;
      if v_a.sire_id is not null and v_sire is not null and v_a.sire_id <> v_sire then
        raise exception '% is already by a different sire than this service', v_a.label;
      end if;

      update animals
         set dam_id = p_dam_id,
             sire_id = coalesce(sire_id, v_sire),
             origin = 'born_on_farm',
             updated_by = auth.uid(), updated_at = now()
       where id = v_adopt;

      v_animal := v_adopt;

    elsif v_outcome = 'live' then
      insert into animals (
        ear_tag, barn_name, sex, class, status, birth_date, purpose, origin,
        record_type, dam_id, sire_id, farm_id, created_by, updated_by
      ) values (
        v_tag, btrim(coalesce(v_calf ->> 'barn_name', '')), v_calf_sex, 'calf', 'active',
        p_date, v_purpose, 'born_on_farm', 'herd', p_dam_id, v_sire, v_farm,
        auth.uid(), auth.uid()
      ) returning id into v_animal;
    end if;

    if v_animal is not null
       and v_sire is not null
       and not exists (select 1 from breed_composition where animal_id = v_animal and deleted_at is null)
       and exists (select 1 from breed_composition where animal_id = p_dam_id and deleted_at is null)
       and exists (select 1 from breed_composition where animal_id = v_sire and deleted_at is null)
    then
      insert into breed_composition (animal_id, breed_id, percent, farm_id, created_by, updated_by)
      select v_animal, s.breed_id, round(sum(s.share) / 2, 2), v_farm, auth.uid(), auth.uid()
      from (
        select bc.breed_id, bc.percent * 100.0 / sum(bc.percent) over () as share
          from breed_composition bc
         where bc.animal_id = p_dam_id and bc.deleted_at is null
        union all
        select bc.breed_id, bc.percent * 100.0 / sum(bc.percent) over ()
          from breed_composition bc
         where bc.animal_id = v_sire and bc.deleted_at is null
      ) s
      group by s.breed_id
      having round(sum(s.share) / 2, 2) > 0;
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

  -- ── the lactation this calving freshens ─────────────────────────────
  if v_purpose in ('dairy', 'dual')
     and not exists (
       select 1 from lactations
        where animal_id = p_dam_id and fresh_date = p_date and deleted_at is null
     ) then

    -- Only a lactation that had already started can be ended by this calving.
    -- One that began afterwards belongs to a later calving.
    update lactations
       set dry_off_date = p_date,
           termination_reason = case when termination_reason = '' then 'calved' else termination_reason end,
           updated_by = auth.uid(), updated_at = now()
     where animal_id = p_dam_id
       and dry_off_date is null
       and fresh_date <= p_date
       and deleted_at is null;

    -- Parity follows the calendar, not the order things were typed in.
    select coalesce(max(lactation_number), 0) + 1 into v_lact
      from lactations
     where animal_id = p_dam_id and deleted_at is null and fresh_date <= p_date;

    -- Only shift when the number is actually taken. Patience is on file at
    -- lactation 3 with nothing before it; the 2024 calving becomes 1 and 3 is
    -- left alone, because 1 < 3 already runs with the calendar and 3 is a
    -- number the farm typed. The gap at 2 is honest — it says there is no
    -- record of that lactation, which is true.
    if exists (
      select 1 from lactations
       where animal_id = p_dam_id and deleted_at is null and lactation_number = v_lact
    ) then
      -- Two passes via negative numbers: lactations_animal_parity_uniq is
      -- checked per row, so a single shift would collide with a row it has
      -- not updated yet. Anything at or above v_lact is necessarily later
      -- than this calving, since v_lact is one past the highest number
      -- among the lactations that precede it.
      update lactations set lactation_number = -lactation_number
       where animal_id = p_dam_id and deleted_at is null and lactation_number >= v_lact;

      update lactations
         set lactation_number = -lactation_number + 1,
             updated_by = auth.uid(), updated_at = now()
       where animal_id = p_dam_id and deleted_at is null and lactation_number < 0;
    end if;

    -- Only one lactation may be open. If she freshened again later, this one
    -- has to be closed, and the next freshening is the only date on file that
    -- bounds it — an upper bound, not a dry-off she recorded, so it says so.
    select min(fresh_date) into v_next_fresh
      from lactations
     where animal_id = p_dam_id and deleted_at is null and fresh_date > p_date;

    insert into lactations (
      animal_id, lactation_number, fresh_date, dry_off_date, termination_reason,
      calving_id, farm_id, created_by, updated_by
    ) values (
      p_dam_id, v_lact, p_date, v_next_fresh,
      case when v_next_fresh is null then '' else 'closed by the next freshening — dry-off not recorded' end,
      v_id, v_farm, auth.uid(), auth.uid()
    );
  end if;

  return v_id;
end $function$;

commit;
