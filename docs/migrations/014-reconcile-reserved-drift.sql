-- 014 — Reconcile inventory_batches.reserved with the orders already placed.
--
-- STATUS: RUN 2026-08-06 against qpthtykkqxpujudyieyr. Data fix, no schema change.
-- Depends on: 011 (reserve_product decrements inventory) and 012 (which
-- dropped the overload PostgREST had been resolving to instead).
--
-- Orders 12 and 14 were placed while PostgREST was still resolving
-- reserve_product to the overload that created an order without touching
-- inventory. The orders exist; the reservation against stock never happened.
-- Order 15 (19:27) came after 012 and did reserve correctly.
--
-- Before this migration, for product 1 (Milk):
--
--   open orders   12 -> 2, 14 -> 3, 15 -> 4     = 9 gallons spoken for
--   batches       13 -> reserved 4 of qty 7
--                 15 -> reserved 0 of qty 1
--                 16 -> reserved 0 of qty 2     = 4 gallons reserved
--
-- So `quantity - reserved` reported 6 gallons available when 1 was. The store
-- would have let a customer reserve five gallons that were already sold.
--
-- The handoff note estimated this at 2 gallons against one order, and framed
-- the check as a join through `order_items.batch_id`. There is no order_items
-- table — an order carries a single product_id and quantity, and batches are
-- allocated inside reserve_product rather than recorded per line. The drift is
-- 5 gallons across two orders, and is only visible per product, not per batch.
--
-- Allocation below follows reserve_product's own rule verbatim: FIFO by
-- produced_date, taking least(quantity - reserved, remaining) from each batch.
-- Batches 15 and 16 share a produced_date, so the split between them is
-- arbitrary; either satisfies the invariant.

begin;

-- Guarded on the exact before-values, so this is a no-op rather than a
-- corruption if the rows have moved since.
update public.inventory_batches set reserved = 7
 where id = 13 and product_id = 1 and quantity = 7 and reserved = 4;

update public.inventory_batches set reserved = 1
 where id = 15 and product_id = 1 and quantity = 1 and reserved = 0;

update public.inventory_batches set reserved = 1
 where id = 16 and product_id = 1 and quantity = 2 and reserved = 0;

-- Self-verifying: if reserved no longer equals what open orders claim, or any
-- batch is oversubscribed, the whole transaction rolls back.
do $$
declare v_reserved numeric; v_open numeric; v_bad integer;
begin
  select coalesce(sum(reserved), 0) into v_reserved
    from public.inventory_batches where product_id = 1;

  select coalesce(sum(quantity), 0) into v_open
    from public.orders
   where product_id = 1 and picked_up_date is null and cancelled_date is null;

  if v_reserved <> v_open then
    raise exception 'reserved (%) does not match open orders (%)', v_reserved, v_open;
  end if;

  select count(*) into v_bad
    from public.inventory_batches where reserved > quantity;

  if v_bad > 0 then
    raise exception '% batch(es) reserved beyond quantity', v_bad;
  end if;
end $$;

commit;

-- Recheck at any time. Should return no rows; a row is a product whose
-- reserved total has drifted from the orders standing against it:
--
--   select p.id, p.name,
--          coalesce(b.reserved_total, 0) as batches_reserved,
--          coalesce(o.open_qty, 0)       as open_order_qty
--     from public.products p
--     left join (select product_id, sum(reserved) reserved_total
--                  from public.inventory_batches group by product_id) b
--            on b.product_id = p.id
--     left join (select product_id, sum(quantity) open_qty
--                  from public.orders
--                 where picked_up_date is null and cancelled_date is null
--                 group by product_id) o
--            on o.product_id = p.id
--    where coalesce(b.reserved_total, 0) <> coalesce(o.open_qty, 0);

-- Rollback — restores the pre-migration values exactly:
--
--   update public.inventory_batches set reserved = 4 where id = 13;
--   update public.inventory_batches set reserved = 0 where id = 15;
--   update public.inventory_batches set reserved = 0 where id = 16;
--
-- Only meaningful as an undo of this migration. The old values are the drift,
-- not a state worth returning to.
