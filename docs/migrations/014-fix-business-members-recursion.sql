-- 014 — Stop business_members' own policies recursing.
--
-- STATUS: RUN, 2026-08-06. Replaces two policies; no data changes.
-- Depends on: 006 (the policies this replaces).
--
-- Verified after running: the select below returns three memberships for
-- the owner, and zero rows for both a user with no membership and an
-- anonymous caller — the recursion is gone without access widening.
--
-- Every select against public.business_members currently fails outright:
--
--   ERROR: 42P17: infinite recursion detected in policy for relation
--                 "business_members"
--
-- 006 tested membership with a plain `exists` against business_members from
-- inside a policy *on* business_members. Evaluating the policy needs to read
-- the table, and reading the table needs to evaluate the policy. Its comment
-- has the reasoning inverted: a self-referential `exists` is the recursive
-- case, and a security definer helper is what breaks the cycle, because the
-- function body runs with RLS bypassed and never re-enters the policy.
--
-- The write policy is `for all`, which includes select, so it has to be
-- fixed too — replacing only the select policy leaves the recursion in place.
--
-- Visible symptom: the topbar business switcher never appears. The app reads
-- the error, can't tell it apart from "table not created yet", and silently
-- falls back to its pre-006 path, which can only ever return the single farm
-- business. One business means nothing to switch between.

begin;

-- Both helpers are security definer *and* pinned to an empty-ish search_path,
-- so a caller can't shadow `business_members` with a table of their own and
-- grant themselves membership.
create or replace function public.current_user_business_ids()
returns setof bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select business_id from public.business_members where user_id = auth.uid();
$fn$;

create or replace function public.current_user_owned_business_ids()
returns setof bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select business_id
    from public.business_members
   where user_id = auth.uid()
     and role = 'owner';
$fn$;

-- security definer functions are executable by public by default, which
-- would hand anonymous callers a membership oracle.
revoke all on function public.current_user_business_ids() from public;
revoke all on function public.current_user_owned_business_ids() from public;
grant execute on function public.current_user_business_ids() to authenticated;
grant execute on function public.current_user_owned_business_ids() to authenticated;

-- Same intent as 006: your own row, plus the roster of any business you
-- belong to. Only the mechanism changes.
drop policy if exists business_members_select on public.business_members;
create policy business_members_select on public.business_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or business_id in (select public.current_user_business_ids())
  );

-- Same intent as 006: only an owner of that business may write its roster.
drop policy if exists business_members_owner_write on public.business_members;
create policy business_members_owner_write on public.business_members
  for all to authenticated
  using (business_id in (select public.current_user_owned_business_ids()))
  with check (business_id in (select public.current_user_owned_business_ids()));

commit;

-- Verify — this errored with 42P17 before, and returns one row per
-- membership afterwards. Substitute a real user id:
--
--   set local role authenticated;
--   set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
--   select bm.business_id, bm.role, b.name, b.type
--     from public.business_members bm
--     join public.businesses b on b.id = bm.business_id
--    where bm.user_id = auth.uid()
--    order by bm.business_id;
--
-- And confirm nobody can see a roster they don't belong to — this must
-- return zero rows for a user with no membership in that business.

-- Rollback: restores 006's policies, and with them the recursion.
--   begin;
--   drop policy if exists business_members_select on public.business_members;
--   drop policy if exists business_members_owner_write on public.business_members;
--   -- then re-run the two create policy statements from 006, and:
--   drop function if exists public.current_user_business_ids();
--   drop function if exists public.current_user_owned_business_ids();
--   commit;
