-- 031 — A calving can name a calf that is already on file.
--
-- STATUS: not yet run.
-- Depends on: 030 (record_calving takes a named breeding and inherits breeds).
--
-- ── Why ───────────────────────────────────────────────────────────────
--
-- Abigail was entered on 2026-08-04 as an animal with dam Martha and sire
-- Sunnybrook Patriot. That is the pedigree link, and it is correct. What she
-- has never had is a *calving*: herd.calvings is empty, farm-wide.
--
-- The two links are not the same thing and the app reads the second one.
-- A season on the breeding timeline runs calving -> breeding_event_id ->
-- service, so with no calving row Martha's first season never closes and her
-- record still says she is eleven days overdue with a calf standing next to
-- her.
--
-- It could not be fixed from the app, because record_calving *creates* an
-- animal for every live calf. Recording Martha's calving would have produced
-- a second Abigail. There was no way to say "the calf is that one".
--
-- Each element of p_calves may now carry an `animal_id`. When present, the
-- calving adopts that animal instead of minting one.
--
-- ── What adoption does, and what it refuses ───────────────────────────
--
-- It fills in what a birth records — dam, sire, origin — and leaves alone
-- anything already recorded that agrees. Where an existing value *disagrees*
-- it refuses rather than overwriting, because the disagreement is the
-- interesting part and silently resolving it would destroy the evidence:
--
--   * a birth date that isn't the calving date. A calf is born on the day of
--     the calving; two dates mean one of them is wrong, and picking one for
--     the farmer would hide which.
--   * a sex that contradicts the calf row.
--   * a dam or sire already recorded as somebody else.
--   * an animal already attached to another calving — no calf is born twice.
--
-- Breed composition is inherited only when the calf has none. Abigail was
-- given 100% Belted Galloway by hand; that is a claim about her sire this
-- function cannot make, since Sunnybrook Patriot has no composition on file,
-- and overwriting it with nothing would be a downgrade.
--
-- The signature is unchanged, so this is a true CREATE OR REPLACE and no
-- overload appears. Only the shape of the p_calves elements grew, and the
-- new key is optional — every existing caller keeps working.

begin;

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
  v_adopt uuid; v_a record;
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
    -- Only a live calf has an animal record at all, so only a live calf can
    -- point at one.
    if (v_calf ->> 'animal_id') is not null and v_outcome <> 'live' then
      raise exception 'Only a live calf can be an animal already on file';
    end if;
  end loop;

  v_breeding := p_breeding_event_id;
  if v_breeding is null then
    select id into v_breeding from breeding_events
     where animal_id = p_dam_id and not voided and deleted_at is null and date < p_date
     order by date desc, created_at desc limit 1;
  else
    -- A named breeding has to be hers, and has to predate the calving.
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
      -- ── adopting an animal already on file ──────────────────────────
      select id, farm_id, sex, birth_date, dam_id, sire_id,
             coalesce(nullif(barn_name, ''), ear_tag, 'that animal') as label
        into v_a
        from animals where id = v_adopt and deleted_at is null;

      if v_a.id is null then raise exception 'That calf is not on file'; end if;
      if v_a.farm_id <> v_farm then raise exception 'That calf belongs to another farm'; end if;
      if v_a.id = p_dam_id then raise exception 'A cow cannot be her own calf'; end if;

      if exists (
        select 1 from calving_outcomes
         where calf_animal_id = v_adopt and deleted_at is null
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

      -- Fill in what a birth records, without touching a name, a tag or a
      -- class somebody has already decided on.
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

    -- Half from each parent, and only when both have one. A calf recorded as
    -- its dam's breeds alone would be stating that half of it came from
    -- nowhere, and every weighted average downstream would believe it.
    --
    -- Never over an existing composition: an adopted calf may have been given
    -- one by hand, and a hand-entered pedigree beats an inference this
    -- function can only make when both parents happen to be filled in.
    if v_animal is not null
       and v_sire is not null
       and not exists (select 1 from breed_composition where animal_id = v_animal and deleted_at is null)
       and exists (select 1 from breed_composition where animal_id = p_dam_id and deleted_at is null)
       and exists (select 1 from breed_composition where animal_id = v_sire and deleted_at is null)
    then
      insert into breed_composition (animal_id, breed_id, percent, farm_id, created_by, updated_by)
      select v_animal, s.breed_id, round(sum(s.share) / 2, 2), v_farm, auth.uid(), auth.uid()
      from (
        -- Each parent normalised to 100 first: the column is only
        -- constrained per row, so a parent's shares can total anything.
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

  if v_purpose in ('dairy', 'dual')
     and not exists (
       select 1 from lactations
        where animal_id = p_dam_id and fresh_date = p_date and deleted_at is null
     ) then
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

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
-- As the farmer, inside a rolled-back transaction:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--
--   -- adopts rather than duplicating
--   select herd.record_calving('<martha>', '2026-07-24',
--     '[{"outcome":"live","sex":"female","animal_id":"<abigail>"}]'::jsonb,
--     1, 'unassisted', 'anterior', false, '', '<the 20 Oct service>');
--   -- one Abigail, one outcome row pointing at her, no new animal
--
--   -- and refuses each contradiction
--   ... animal_id of a calf born on another date       -> 'on file as born …'
--   ... animal_id of an animal already in a calving    -> 'already recorded against a calving'
--   ... animal_id on a stillborn row                   -> 'Only a live calf …'
