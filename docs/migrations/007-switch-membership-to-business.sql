-- 007 — Answer herd access through business membership.
--
-- STATUS: PROPOSAL. Not run.
-- Depends on: 005 (farms.business_id) and 006 (business_members).
--
-- ⚠️ THIS IS THE SHARP EDGE. Isolated in its own file for that reason.
--
-- Roughly 41 tables in the herd schema have RLS policies, and every one of
-- them calls herd.is_farm_member() or herd.can_write_farm(). Redefining
-- those two functions changes what all 41 tables mean, at once, in one
-- statement. Nothing else in this migration set can lock you out of your own
-- data; this can.
--
-- Before running:
--   1. Restore a backup somewhere else and run it there first. Not a
--      "backup exists" check — an actual restore you queried afterwards.
--   2. Confirm every farm has a business_id (see 005's check query).
--   3. Confirm every business has at least one member (see 006's).
--   4. Have the rollback at the bottom of this file open in another tab.
--
-- The old definitions are preserved in the rollback section verbatim. If
-- anything looks wrong afterwards, paste them back — recovery is one
-- statement, and it does not depend on this file still being reachable.

begin;

-- Membership: is the caller a member of the business this farm belongs to?
create or replace function herd.is_farm_member(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = herd, public
as $$
  select exists (
    select 1
      from herd.farms f
      join public.business_members m on m.business_id = f.business_id
     where f.id = fid
       and m.user_id = auth.uid()
  );
$$;

-- Write access: same, restricted to roles that may write. 'member' is
-- deliberately excluded — a bookkeeper reading the books shouldn't be able
-- to edit animal records by default. Widen here if that's wrong.
create or replace function herd.can_write_farm(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = herd, public
as $$
  select exists (
    select 1
      from herd.farms f
      join public.business_members m on m.business_id = f.business_id
     where f.id = fid
       and m.user_id = auth.uid()
       and m.role in ('owner', 'admin', 'manager')
  );
$$;

commit;

-- Verify immediately, signed in as a normal user (not service_role, which
-- bypasses RLS and will happily tell you everything is fine):
--
--   select count(*) from herd.animals;   -- expect 4, not 0
--   select count(*) from herd.farms;     -- expect 1, not 0
--
-- A zero here means the link or the membership is wrong, not that the data
-- is gone. Roll back and check 005/006 before anything else.

-- ---------------------------------------------------------------------------
-- ROLLBACK — the original definitions, restoring access via herd.farm_members.
--
--   create or replace function herd.is_farm_member(fid uuid)
--   returns boolean language sql stable security definer
--   set search_path = herd, public as $$
--     select exists (
--       select 1 from herd.farm_members m
--        where m.farm_id = fid and m.user_id = auth.uid()
--     );
--   $$;
--
--   create or replace function herd.can_write_farm(fid uuid)
--   returns boolean language sql stable security definer
--   set search_path = herd, public as $$
--     select exists (
--       select 1 from herd.farm_members m
--        where m.farm_id = fid and m.user_id = auth.uid()
--          and m.role in ('owner', 'admin', 'manager')
--     );
--   $$;
--
-- ⚠️ These are reconstructed from the policy behaviour described in the
-- schema dump, not copied from the live database. Dump the real ones first
-- and keep that output — it is the authoritative rollback:
--
--   select prosrc from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'herd'
--      and p.proname in ('is_farm_member', 'can_write_farm');
--
-- herd.farm_members is left in place and still populated. It stops being
-- consulted, which is what makes rollback cheap. Drop it only once the
-- standalone Herd app is retired.
-- ---------------------------------------------------------------------------
