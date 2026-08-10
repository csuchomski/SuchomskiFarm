-- 033 — A sire's purpose follows his breeds.
--
-- STATUS: not yet run.
-- Depends on: 030 (set_breed_composition).
--
-- ── Why ───────────────────────────────────────────────────────────────
--
--   "the sires should pull purpose from the Breed record. I don't want to
--    maintain a breeds purpose in two places."
--
-- Correct, and the duplication was introduced the day before by putting a
-- Purpose select on the sire edit form. The species-mismatch warning added at
-- the same time only existed because two facts could disagree — the cure for
-- which is one fact, not a better warning.
--
-- herd.breeds.species_type and herd.animals.purpose already use the same
-- three words: beef, dairy, dual. So for a bull the derivation is direct.
--
-- ── For males only, and deliberately so ───────────────────────────────
--
-- A cow's purpose is a decision the farm makes about her, not a fact about
-- her breeds: a Jersey run as a beef cow, nursing her own calf, is a beef
-- cow, and lib/herd.ts isMilked() has said so since the beef/dairy split.
-- Deriving hers would overwrite that decision every time somebody corrected
-- a breed.
--
-- A bull is different. He is never milked and never calves; his purpose is
-- read as a label and as the species fallback for gestation, and it is
-- nothing but a summary of what he is. There is no decision to overwrite.
--
-- ── The rule ──────────────────────────────────────────────────────────
--
-- If every breed he carries shares one species_type, that is his purpose.
-- If they don't, he is 'dual' — which is exactly what a Shorthorn over an
-- Angus is, and the vocabulary already has the word. With no composition on
-- file the function returns null and his purpose is left alone, because
-- "unknown" is not one of the three values the CHECK allows and the column
-- is NOT NULL.
--
-- ── What it fixes right now ───────────────────────────────────────────
--
-- Sunnybrook Patriot and Sunnybrook Valor are on file as 100% Belted
-- Galloway — a beef breed — with purpose 'dairy', because
-- createReferenceSire hard-codes 'dairy' and nothing has ever revisited it.
-- The backfill at the end corrects them and any bull like them.

begin;

/**
 * The purpose implied by an animal's breed composition, or null when nothing
 * on file implies one.
 */
create or replace function herd.purpose_from_breeds(p_animal_id uuid)
returns text
language sql
stable
security definer
set search_path to 'herd', 'public'
as $function$
  select case
           when count(*) = 0 then null
           when count(distinct b.species_type) = 1 then min(b.species_type)
           else 'dual'
         end
    from breed_composition bc
    join breeds b on b.id = bc.breed_id
   where bc.animal_id = p_animal_id
     and bc.deleted_at is null
     and b.deleted_at is null
     and b.species_type in ('beef', 'dairy', 'dual');
$function$;

grant execute on function herd.purpose_from_breeds(uuid) to authenticated;

-- Setting a bull's breeds now sets his purpose too, so the two can't drift.
create or replace function herd.set_breed_composition(p_animal_id uuid, p_shares jsonb)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm uuid; v_share jsonb; v_breed uuid; v_pct numeric; v_total numeric := 0;
  v_sex text; v_purpose text;
begin
  select farm_id, sex into v_farm, v_sex from animals where id = p_animal_id and deleted_at is null;
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

  -- Males only. A cow's purpose is how the farm runs her; a bull's is a
  -- summary of what he is, and nothing else reads it. See the header.
  if v_sex = 'male' then
    v_purpose := purpose_from_breeds(p_animal_id);
    if v_purpose is not null then
      update animals
         set purpose = v_purpose, updated_by = auth.uid(), updated_at = now()
       where id = p_animal_id and purpose is distinct from v_purpose;
    end if;
  end if;
end $function$;

-- Bring every bull already on file into line with his breeds.
update herd.animals a
   set purpose = herd.purpose_from_breeds(a.id), updated_at = now()
 where a.sex = 'male'
   and a.deleted_at is null
   and herd.purpose_from_breeds(a.id) is not null
   and a.purpose is distinct from herd.purpose_from_breeds(a.id);

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select barn_name, purpose from herd.animals
--    where sex = 'male' and deleted_at is null order by barn_name;
--
--   -- expect Sunnybrook Patriot and Sunnybrook Valor to read 'beef' now
--   -- (100% Belted Galloway), Dutton and Overalls 'dairy' (100% Jersey).
--
-- Then, as the farmer inside a rolled-back transaction:
--
--   select herd.set_breed_composition('<a bull>',
--     '[{"breed_id":"<jersey>","percent":100}]'::jsonb);
--   -- his purpose follows to 'dairy'
--
--   select herd.set_breed_composition('<a bull>',
--     '[{"breed_id":"<jersey>","percent":50},{"breed_id":"<angus>","percent":50}]'::jsonb);
--   -- 'dual', because they don't agree
--
--   select herd.set_breed_composition('<a cow>',
--     '[{"breed_id":"<jersey>","percent":100}]'::jsonb);
--   -- her purpose is untouched, whatever it was
