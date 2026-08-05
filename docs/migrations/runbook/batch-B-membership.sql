-- ====================================================================
-- 007-switch-membership-to-business.sql
-- ====================================================================

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
-- The definitions below preserve two things from the live functions that an
-- earlier draft of this file got wrong, both caught by dumping them:
--
--   * The parameter is named `f`. CREATE OR REPLACE FUNCTION refuses to
--     change a parameter name ("cannot change name of input parameter"), so
--     a rewrite using any other name fails outright.
--
--   * can_write_farm allows ('owner', 'helper', 'vet') — not the
--     ('owner', 'admin', 'manager') that looks plausible. Guessing there
--     would have silently removed write access from every helper and vet on
--     the farm while appearing to succeed.
--
-- Before running:
--   1. Restore a backup somewhere else and run it there first. Not a
--      "backup exists" check — an actual restore you queried afterwards.
--   2. Confirm every farm has a business_id (see 005's check query).
--   3. Confirm every business has at least one member (see 006's).

begin;

-- Membership: is the caller a member of the business this farm belongs to?
create or replace function herd.is_farm_member(f uuid)
returns boolean
language sql
stable
security definer
set search_path = herd, public
as $$
  select exists (
    select 1
      from herd.farms fa
      join public.business_members m on m.business_id = fa.business_id
     where fa.id = f
       and m.user_id = auth.uid()
  );
$$;

-- Write access: same, for the roles that may write. The role list is carried
-- over verbatim from the live function — changing who can write is a
-- separate decision from changing how membership is resolved, and doing both
-- in one migration would make a permissions regression look like a tenancy
-- bug.
create or replace function herd.can_write_farm(f uuid)
returns boolean
language sql
stable
security definer
set search_path = herd, public
as $$
  select exists (
    select 1
      from herd.farms fa
      join public.business_members m on m.business_id = fa.business_id
     where fa.id = f
       and m.user_id = auth.uid()
       and m.role in ('owner', 'helper', 'vet')
  );
$$;

commit;

-- Roles carry across intact: 006's backfill copies farm_members.role, so an
-- owner stays an owner and a helper stays a helper. The 'member' default on
-- business_members only applies to rows inserted later without a role — and
-- 'member' is not in the write list above, so such a person would read and
-- not write. Worth a look either way, since after this migration these roles
-- are what govern the whole herd schema:
--
--   select b.name, m.user_id, m.role from public.business_members m
--     join public.businesses b on b.id = m.business_id order by b.name;

-- Verify immediately, signed in as a normal user (not service_role, which
-- bypasses RLS and will happily tell you everything is fine):
--
--   select count(*) from herd.animals;   -- expect 4, not 0
--   select count(*) from herd.farms;     -- expect 1, not 0
--
-- A zero means the link or the membership is wrong, not that the data is
-- gone. Roll back and check 005/006 before anything else.

-- ---------------------------------------------------------------------------
-- ROLLBACK — the live definitions as dumped from pg_proc, verbatim.
--
--   create or replace function herd.is_farm_member(f uuid)
--   returns boolean language sql stable security definer as $$
--     select exists (
--       select 1 from herd.farm_members m
--       where m.farm_id = f and m.user_id = auth.uid()
--     );
--   $$;
--
--   create or replace function herd.can_write_farm(f uuid)
--   returns boolean language sql stable security definer as $$
--     select exists (
--       select 1 from herd.farm_members m
--       where m.farm_id = f
--         and m.user_id = auth.uid()
--         and m.role in ('owner', 'helper', 'vet')
--     );
--   $$;
--
-- herd.farm_members is left in place and still populated. It stops being
-- consulted, which is what makes rollback cheap. Drop it only once the
-- standalone Herd app is retired.
-- ---------------------------------------------------------------------------
