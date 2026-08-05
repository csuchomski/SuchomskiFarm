-- 012 — Remove the duplicate reserve_product added by 011.
--
-- STATUS: PROPOSAL. Not run. Run after 011.
--
-- 011 added reserve_product(bigint, numeric) without checking whether the
-- name was taken. It was: reserve_product(bigint, numeric, uuid) already
-- existed and does the same job better.
--
-- CREATE OR REPLACE FUNCTION only replaces when the whole signature matches,
-- so a different argument count silently creates an overload rather than
-- erroring. PostgREST then had two candidates and resolved rpc() calls to
-- the wrong one — which is why reserving created an order and left
-- inventory_batches.reserved at zero, with no error anywhere.
--
-- The existing function is better in three ways the new one missed:
--
--   * It subtracts stock held for upcoming weekly schedules before allowing
--     a reservation ("held for weekly" in the mockups), so it won't sell
--     milk already promised to a standing order. The replacement would.
--   * A farmer can reserve on behalf of a customer via p_customer.
--   * It rounds quantity to 3 decimals, matching how milk is stored.
--
-- So: drop the duplicate, keep the original, and have the app pass the
-- third argument.

begin;

drop function if exists public.reserve_product(bigint, numeric);

commit;

-- Confirm exactly one remains — this is the check 011 should have made
-- before creating anything:
--
--   select p.oid::regprocedure as signature
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'reserve_product';
--
--   -- expect one row: reserve_product(bigint,numeric,uuid)

-- ---------------------------------------------------------------------------
-- cancel_my_order (from 009/011) has no such conflict — it was the only
-- function of that name. It stays, and it pairs correctly with the original
-- reserve_product: that function holds stock on inventory_batches, and
-- cancel_my_order releases it.
--
-- Worth confirming there isn't an existing cancellation path under another
-- name that also releases stock, or a cancellation would release twice:
--
--   select p.oid::regprocedure, obj_description(p.oid) as comment
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f'
--    order by p.proname;
-- ---------------------------------------------------------------------------

-- Rollback: re-run 011's reserve_product definition. Not recommended — it
-- reintroduces both the overload and the schedule-blind allocation.
