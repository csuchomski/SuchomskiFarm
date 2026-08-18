-- 055 — putting an animal in a mob, in one move
--
-- STATUS: run 2026-08-18
--
-- Setting up a herd was two jobs done in two places: add the animal on Herd →
-- Animals, then go to Grazing → Mobs and add her to one. Nothing on the
-- animal form so much as mentioned a mob, so a farm could finish entering
-- twenty head and have no mob to move.
--
-- The client could already do it — `addToGroup` and `removeFromGroup` are
-- there — but *moving* an animal is two writes: close the membership she has
-- and open the one she is going to. Between those two she is in no mob at
-- all, and if the second fails she stays that way, silently, until somebody
-- notices the head count is wrong. Dragging a row from one mob to another is
-- going to do this often enough that it has to be one statement.
--
-- `joinRefusal` in lib/grazing.ts states the rule the database never has:
-- one open membership at a time. This keeps that rule and takes the sting
-- out of it — the answer to "she is in another mob" is now to move her, not
-- to make somebody take her out first.
--
-- **A null group means out of every mob**, which is how an animal is taken
-- off the grass without being put anywhere else.

-- One open membership per animal, so the rule the client asserts is also true
-- of the table. Partial, because the history rows — the closed ones — are the
-- whole point of keeping them.
create unique index if not exists grazing_group_members_one_open
  on herd.grazing_group_members (animal_id)
  where left_on is null and deleted_at is null;

create or replace function herd.set_animal_mob(
  p_farm_id   uuid,
  p_animal_id uuid,
  p_group_id  uuid,
  p_on        date default null
)
returns uuid
language plpgsql
security definer
set search_path = herd, public
as $$
declare
  v_on   date := coalesce(p_on, current_date);
  v_open grazing_group_members%rowtype;
  v_id   uuid;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  if not exists (
    select 1 from animals where id = p_animal_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That animal is not on this farm.';
  end if;

  if p_group_id is not null and not exists (
    select 1 from grazing_groups where id = p_group_id and farm_id = p_farm_id and deleted_at is null
  ) then
    raise exception 'That mob is not on this farm.';
  end if;

  select * into v_open
    from grazing_group_members
   where animal_id = p_animal_id and left_on is null and deleted_at is null
   limit 1;

  -- Already where she is meant to be. Doing nothing beats writing a departure
  -- and an arrival on the same day, which reads like she went somewhere.
  if found and v_open.group_id is not distinct from p_group_id then
    return v_open.id;
  end if;

  if found then
    -- She cannot have left before she arrived. A mob set up today and
    -- corrected today would otherwise trip the check constraint.
    update grazing_group_members
       set left_on    = greatest(v_on, coalesce(joined_on, v_on)),
           updated_at = now(), updated_by = auth.uid(), rev = rev + 1
     where id = v_open.id;
  end if;

  if p_group_id is null then
    return null;
  end if;

  insert into grazing_group_members (farm_id, group_id, animal_id, joined_on, created_by, updated_by)
  values (p_farm_id, p_group_id, p_animal_id, v_on, auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function herd.set_animal_mob(uuid, uuid, uuid, date) from public;
grant execute on function herd.set_animal_mob(uuid, uuid, uuid, date) to authenticated;

comment on function herd.set_animal_mob(uuid, uuid, uuid, date) is
  'Move an animal into a mob, or out of every mob with a null group. One statement, so she is never briefly in none.';
