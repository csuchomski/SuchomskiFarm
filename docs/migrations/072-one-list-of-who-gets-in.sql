-- 072 — one list of who gets in
--
-- STATUS: run 2026-09-24
--
-- Who can reach a farm is kept twice: `public.business_members` (what the
-- app reads, and what the books and shop now check — see 071) and
-- `herd.farm_members` (what every herd table checks, through
-- can_write_farm). Nothing kept them in step. Settings → Farm & people wrote
-- only the first, so taking somebody off the list there left them able to
-- log moves, treatments and weights for as long as they liked.
--
-- The two lists even spell a role differently: the app says 'viewer', the
-- herd check constraint says 'readonly'. Same meaning — reads, writes
-- nothing — so the translation lives here and nowhere else.
--
-- From now on both lists change together or not at all, through three
-- functions that check the caller owns the business. Direct writes to either
-- table are revoked from signed-in users, so these are the only way in.
-- create_farm is security definer and keeps working.
--
-- A farm always keeps at least one owner. Somebody has to be able to let the
-- next person in.

create or replace function public.add_member(p_business_id bigint, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user  uuid;
begin
  if p_business_id is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the farm''s owner can let somebody in.';
  end if;
  if p_role is null or p_role not in ('owner', 'helper', 'vet', 'viewer') then
    raise exception 'There is no role called %.', coalesce(p_role, 'nothing');
  end if;
  if v_email = '' then
    raise exception 'Give their email address.';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    raise exception 'Nobody has an account under %.', v_email;
  end if;

  if exists (select 1 from public.business_members where business_id = p_business_id and user_id = v_user) then
    raise exception '% can already get in. Change their role instead.', v_email;
  end if;

  insert into public.business_members (business_id, user_id, role)
  values (p_business_id, v_user, p_role);

  insert into herd.farm_members (farm_id, user_id, role)
  select f.id, v_user, case p_role when 'viewer' then 'readonly' else p_role end
    from herd.farms f
   where f.business_id = p_business_id
  on conflict (farm_id, user_id) do update set role = excluded.role;

  -- An owner is a farmer everywhere profiles.role is still read.
  if p_role = 'owner' then
    update public.profiles set role = 'farmer' where id = v_user and role is distinct from 'farmer';
  end if;

  return v_user;
end;
$$;

create or replace function public.set_member_role(p_business_id bigint, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_was text;
begin
  if p_business_id is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the farm''s owner can change what people may do.';
  end if;
  if p_role is null or p_role not in ('owner', 'helper', 'vet', 'viewer') then
    raise exception 'There is no role called %.', coalesce(p_role, 'nothing');
  end if;

  select role into v_was from public.business_members
   where business_id = p_business_id and user_id = p_user_id
   for update;
  if v_was is null then
    raise exception 'They are not on this farm.';
  end if;

  if v_was = 'owner' and p_role <> 'owner' and not exists (
    select 1 from public.business_members
     where business_id = p_business_id and role = 'owner' and user_id <> p_user_id
  ) then
    raise exception 'A farm needs at least one owner. Make somebody else an owner first.';
  end if;

  update public.business_members set role = p_role
   where business_id = p_business_id and user_id = p_user_id;

  insert into herd.farm_members (farm_id, user_id, role)
  select f.id, p_user_id, case p_role when 'viewer' then 'readonly' else p_role end
    from herd.farms f
   where f.business_id = p_business_id
  on conflict (farm_id, user_id) do update set role = excluded.role;

  if p_role = 'owner' then
    update public.profiles set role = 'farmer' where id = p_user_id and role is distinct from 'farmer';
  end if;
end;
$$;

create or replace function public.remove_member(p_business_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_was text;
begin
  if p_business_id is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the farm''s owner can take somebody off.';
  end if;

  select role into v_was from public.business_members
   where business_id = p_business_id and user_id = p_user_id
   for update;
  if v_was is null then
    raise exception 'They are not on this farm.';
  end if;

  if v_was = 'owner' and not exists (
    select 1 from public.business_members
     where business_id = p_business_id and role = 'owner' and user_id <> p_user_id
  ) then
    raise exception 'A farm needs at least one owner. Make somebody else an owner first.';
  end if;

  delete from public.business_members
   where business_id = p_business_id and user_id = p_user_id;

  -- Their access, not their work: the moves and treatments they logged keep
  -- their name on them.
  delete from herd.farm_members m
   using herd.farms f
   where f.id = m.farm_id and f.business_id = p_business_id and m.user_id = p_user_id;
end;
$$;

revoke execute on function public.add_member(bigint, text, text)       from public, anon;
revoke execute on function public.set_member_role(bigint, uuid, text)  from public, anon;
revoke execute on function public.remove_member(bigint, uuid)          from public, anon;
grant  execute on function public.add_member(bigint, text, text)       to authenticated;
grant  execute on function public.set_member_role(bigint, uuid, text)  to authenticated;
grant  execute on function public.remove_member(bigint, uuid)          to authenticated;

-- The functions above are now the only door. Reading stays as it was.
revoke insert, update, delete, truncate on public.business_members from anon, authenticated;
revoke insert, update, delete, truncate on herd.farm_members       from anon, authenticated;
