-- 005 — Link each farm to the business it belongs to.
--
-- STATUS: PROPOSAL. Not run. Additive and reversible.
-- Depends on nothing; 007 depends on this.
--
-- The link goes farm -> business, not the other way round: the business is
-- the workspace, and the farm is what a business of type 'farm' has.
-- (Migration 001 pointed it the wrong way and is superseded.)

begin;

alter table herd.farms
  add column if not exists business_id bigint unique references public.businesses(id);

-- Backfill by name. There is exactly one farm and exactly one business of
-- type 'farm', both called 'Suchomski Family Farm', so this matches one row.
-- Verify before running:
--
--   select id, name from herd.farms;
--   select id, name, type from public.businesses where type = 'farm';
--
-- If either returns more than one row, match them explicitly by id instead
-- of trusting the name.
update herd.farms f
   set business_id = b.id
  from public.businesses b
 where b.type = 'farm'
   and lower(trim(b.name)) = lower(trim(f.name))
   and f.business_id is null;

commit;

-- Left nullable deliberately: a farm with no business yet is a recoverable
-- state, whereas a NOT NULL that fails mid-migration is not. Tighten once
-- 007 is in and verified:
--
--   alter table herd.farms alter column business_id set not null;

-- Check the backfill did what you expect before running 007 — that migration
-- makes access depend on this link, so a farm with a null business_id
-- becomes invisible to everyone:
--
--   select f.name as farm, b.name as business, b.type
--     from herd.farms f
--     left join public.businesses b on b.id = f.business_id;

-- Rollback:
--   alter table herd.farms drop column business_id;
