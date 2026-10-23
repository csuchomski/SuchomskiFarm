-- ====================================================================
-- 007-switch-membership-to-business.sql
-- ====================================================================

-- 007 — Answer herd access through business membership.
--
-- STATUS: NOT RUN. Dependencies verified against the live database 2026-08-06.
-- Depends on: 005 (farms.business_id) and 006 (business_members) — both applied.
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
--      Still not done, and still the one unmet precondition: pg_dump needs
--      raw 5432, which the agent's HTTP proxy cannot tunnel. The rollback at
--      the bottom of this file is a real recovery but not a rehearsal.
--   2. Confirm every farm has a business_id (see 005's check query).
--   3. Confirm every business has at least one member (see 006's).
--
-- 2 and 3 were checked against the live database on 2026-08-06 and both pass:
--
--   farm 309fcb68-7a38-456e-bc81-fd212ea50d10 'Suchomski Family Farm'
--     -> business 5 'Suchomski Family Farm' (type 'farm')
--   businesses 3 'Meghan's Realtor', 4 '5553 N Lydell Ave', 5 — 1 member each
--
-- The membership carries across, which is the thing that decides whether this
-- migration locks you out. The same user is present on both sides with the
-- same role:
--
--   herd.farm_members         c3bec7a2-9b0d-4ec6-8994-accd67660e1f  owner
--   public.business_members   c3bec7a2-9b0d-4ec6-8994-accd67660e1f  owner  (business 5)
--
-- 'owner' is in the write list below, so read and write both survive. Re-run
-- the two checkpoint queries in runbook/README.md before pasting this, in
-- case anything moved in between.

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
-- Re-dumped 2026-08-06 with database access. An earlier copy of this block
-- dropped the `set search_path` clause both functions carry, which would have
-- restored them subtly weakened rather than unchanged: search_path is a
-- security control on a SECURITY DEFINER function, and a rollback that
-- silently relaxes one is not a rollback. Kept exact below.
--
--   create or replace function herd.is_farm_member(f uuid)
--   returns boolean
--   language sql
--   stable
--   security definer
--   set search_path to 'herd'
--   as $$
--     select exists (
--       select 1 from herd.farm_members m
--       where m.farm_id = f and m.user_id = auth.uid()
--     );
--   $$;
--
--   create or replace function herd.can_write_farm(f uuid)
--   returns boolean
--   language sql
--   stable
--   security definer
--   set search_path to 'herd'
--   as $$
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
