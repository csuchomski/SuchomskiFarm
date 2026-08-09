-- 030 — Tie a calf to the service that made it, and let it inherit its
--       parents' breeds.
--
-- STATUS: run 2026-08-09, rehearsed first as the farmer with RLS applied.
-- Depends on: 028 (record_calving), 029 (gestation resolves per breed).
--
-- ── The tie ───────────────────────────────────────────────────────────
--
-- record_calving already took p_breeding_event_id and the app always passed
-- null, so it fell back to "her most recent standing service before the
-- date". That is wrong exactly when it matters: a cow served on 1 March,
-- returned to heat and served again on 22 March, then calving in December
-- conceived on the *first* service, and the fallback credits the second —
-- which means the wrong sire on the calf.
--
-- The app now names the breeding, defaulting to the service whose expected
-- calving date is nearest the real one rather than the latest. That is an app
-- change; the parameter has been here since 028.
--
-- ── What this migration adds ──────────────────────────────────────────
--
-- A calf born here gets its dam and sire filled in, and from 030 its breed
-- composition too: half from each parent, per breed. That is the concrete
-- meaning of "the genetics follow the calf" — and it closes a loop, because
-- gestation now resolves through breed composition, so this calf's own due
-- date will be right when her turn comes instead of falling back to a
-- species average.
--
-- Only when *both* parents have a composition on file. Half a pedigree is
-- not a composition, and recording the dam's half alone would state that a
-- calf is 50% Jersey and 50% nothing. Today the reference bull has none, so
-- nothing is inherited until somebody gives him one — which is what
-- set_breed_composition is for.
--
-- ── Not in here: inferred genetic status ──────────────────────────────
--
-- herd.animal_genetic_status.source allows 'pedigree_inferred', so the
-- schema plainly intends carrier status to descend from parents. It is not
-- built, because marker_genotypes, animal_genetic_status and genomic_tests
-- are all empty — there is nothing to infer from, and code that infers from
-- no data is code nobody can tell is wrong.

begin;

-- ── replacing an animal's composition ─────────────────────────────────
--
-- Whole-set replacement rather than row edits: a composition is a set of
-- fractions that has to be consistent, and letting someone add 60% Jersey to
-- an animal already 100% Angus produces a 160% animal that every weighted
-- average then quietly divides by.

create or replace function herd.set_breed_composition(p_animal_id uuid, p_shares jsonb)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare v_farm uuid; v_share jsonb; v_breed uuid; v_pct numeric; v_total numeric := 0;
begin
  select farm_id into v_farm from animals where id = p_animal_id and deleted_at is null;
  if v_farm is null then raise exception 'Animal not found'; end if;
  if not can_write_farm(v_farm) then
    raise exception 'Not allowed to change that animal';
  end if;
  if jsonb_typeof(p_shares) <> 'array' then raise exception 'Expected a list of breeds'; end if;

  -- Validate the whole set before touching anything, so a bad share can't
  -- leave the animal with half a composition.
  for v_share in select * from jsonb_array_elements(p_shares) loop
    v_breed := (v_share ->> 'breed_id')::uuid;
    v_pct := round((v_share ->> 'percent')::numeric, 2);
    if not exists (select 1 from breeds where id = v_breed and farm_id = v_farm and deleted_at is null) then
      raise exception 'That breed is not on this farm';
    end if;
    if v_pct is null or v_pct <= 0 or v_pct > 100 then
      raise exception 'Each share is above 0 and at most 100';
    end if;
    v_total := v_total + v_pct;
  end loop;

  if jsonb_array_length(p_shares) > 0 and round(v_total, 2) <> 100 then
    raise exception 'The shares come to %, not 100', round(v_total, 2);
  end if;

  update breed_composition set deleted_at = now(), updated_by = auth.uid()
   where animal_id = p_animal_id and deleted_at is null;

  for v_share in select * from jsonb_array_elements(p_shares) loop
    insert into breed_composition (animal_id, breed_id, percent, farm_id, created_by, updated_by)
    values (p_animal_id, (v_share ->> 'breed_id')::uuid,
            round((v_share ->> 'percent')::numeric, 2), v_farm, auth.uid(), auth.uid());
  end loop;
end $function$;

comment on function herd.set_breed_composition(uuid, jsonb) is
  'Replace an animal''s breed composition. Whole-set, and the shares must '
  'total 100 — a partial edit is how an animal ends up 160% bred.';

grant execute on function herd.set_breed_composition(uuid, jsonb) to authenticated;

-- ── the calf inherits ─────────────────────────────────────────────────
--
-- Body identical to 028's except for the composition block at the end of the
-- live-calf branch. Signature copied verbatim so this replaces rather than
-- overloads — see the README on 011.

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
    v_animal := null;

    if v_outcome = 'live' then
      insert into animals (
        ear_tag, barn_name, sex, class, status, birth_date, purpose, origin,
        record_type, dam_id, sire_id, farm_id, created_by, updated_by
      ) values (
        v_tag, btrim(coalesce(v_calf ->> 'barn_name', '')), v_calf_sex, 'calf', 'active',
        p_date, v_purpose, 'born_on_farm', 'herd', p_dam_id, v_sire, v_farm,
        auth.uid(), auth.uid()
      ) returning id into v_animal;

      -- Half from each parent, and only when both have one. A calf recorded
      -- as its dam's breeds alone would be stating that half of it came from
      -- nowhere, and every weighted average downstream would believe it.
      if v_sire is not null
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

-- ── Where the AI cost lives, and why it doesn't move ──────────────────
--
-- Nothing in this migration touches cost_entries. The straw's cost stays on
-- the cow, and the schema is the reason rather than a preference:
--
--   expense_categories 'breeding'    basis_type 'operating'
--                                    schedule_f_line 'Veterinary, breeding,
--                                                     and medicine'
--   expense_categories 'acquisition' basis_type 'basis'
--                                    schedule_f_line '— (basis, not an
--                                                     expense line)'
--
-- Breeding and semen is already classified as an operating expense that goes
-- on a Schedule F line in the year it is paid, not a basis cost capitalised
-- into an animal. Moving it onto the calf would put it in the wrong column of
-- the return.
--
-- It is also incurred before any calf exists, and most of the reason to track
-- it is the services that *don't* take — those have no calf to carry them.
--
-- "What did this calf cost" is still answerable, and this migration is what
-- makes it so: calving -> breeding_events -> cost_entries.source_ref_id. The
-- money is derivable through the link without being moved.

-- ── Verify after running ──────────────────────────────────────────────
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<the farmer>","role":"authenticated"}';
--   select herd.set_breed_composition('<a bull>',
--     '[{"breed_id":"<angus>","percent":100}]'::jsonb);
--   select herd.set_breed_composition('<a bull>',
--     '[{"breed_id":"<angus>","percent":60}]'::jsonb);   -- refused, 60 <> 100
--   select herd.record_calving('<a jersey cow>', current_date,
--     '[{"outcome":"live","sex":"female","ear_tag":"77"}]'::jsonb,
--     1, 'unassisted', 'anterior', false, '', '<her service>');
--   select b.name, bc.percent from herd.breed_composition bc
--     join herd.breeds b on b.id = bc.breed_id
--    where bc.animal_id = (select id from herd.animals where ear_tag = '77');
--     -- 50 Jersey, 50 Angus
--
-- Rollback:
--   drop function if exists herd.set_breed_composition(uuid, jsonb);
--   -- and restore 028's record_calving, which omits the composition block
--   -- and does not validate a named breeding.
