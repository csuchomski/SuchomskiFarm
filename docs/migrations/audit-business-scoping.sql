-- Audit: security-definer functions that write unscoped rows.
--
-- Run this after any migration that adds a business_id column, or that
-- changes a policy to read one. It should return no rows.
--
-- Why it exists: migration 010 rewrote the store's policies to
-- is_business_member(business_id), and is_business_member(null) is false.
-- Any function still inserting without a business_id therefore creates rows
-- that are invisible to the very person who created them — no error, no
-- warning, just missing data.
--
-- Four separate functions were found doing exactly that, one at a time,
-- each because somebody happened to read its body:
--
--   017  public.reserve_product              orders invisible to the farmer
--   019  public.complete_scheduled_pickup    same, for a fulfilled standing order
--   020  public.discard_inventory            unscoped discards
--   021  herd.record_production              inventory nobody could see or sell
--
-- The fourth was found by this query rather than by reading. That is the
-- whole point of writing it down.
--
-- Caveat worth knowing: this matches an insert's column list textually, so
-- it will not catch an `insert ... select *`, an insert built by dynamic
-- SQL, or a column list spanning a comment. It catches the shape all four
-- real instances had. Treat a clean result as "none of the known shape",
-- not as a proof.

-- Every security-definer function that inserts into a business-scoped table
-- without naming business_id in the insert's column list.
with scoped as (
  select table_schema, table_name
    from information_schema.columns
   where column_name = 'business_id'
     and table_schema in ('public', 'herd')
),
fns as (
  select n.nspname as schema, p.proname as fn,
         p.oid::regprocedure::text as signature, p.prosrc as src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'herd')
     and p.prosecdef
)
select f.signature, s.table_name as inserts_into,
       (regexp_match(f.src, 'insert\s+into\s+(?:\w+\.)?' || s.table_name || '\s*\(([^)]*)\)', 'i'))[1] as columns
  from fns f
  join scoped s
    on f.src ~* ('insert\s+into\s+(?:\w+\.)?' || s.table_name || '\s*\(')
 where (regexp_match(f.src, 'insert\s+into\s+(?:\w+\.)?' || s.table_name || '\s*\(([^)]*)\)', 'i'))[1] !~* 'business_id'
 order by 1, 2;
