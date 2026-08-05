-- 011 — Make reserving actually reserve something.
--
-- STATUS: PROPOSAL. Not run. Depends on 009.
--
-- Today an order is inserted and inventory_batches.reserved is never
-- touched, so a reservation is invisible to both the storefront's
-- "available" and Store · Products' "claimed" — both of which are summed
-- from batches. The order exists and nothing else changes.
--
-- This can't be fixed in the client. Read-available-then-insert-then-update
-- is three round trips with no lock, so two customers reserving the last
-- gallon at once both succeed. It has to be one statement in the database.

begin;

-- ---------------------------------------------------------------------------
-- Reserve: check, insert, allocate — atomically.
-- ---------------------------------------------------------------------------

create or replace function public.reserve_product(p_product_id bigint, p_quantity numeric)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available numeric;
  v_remaining numeric := p_quantity;
  v_take      numeric;
  v_price     numeric;
  v_order_id  bigint;
  r           record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  -- FOR UPDATE holds the batch rows until this transaction commits, so a
  -- concurrent reservation waits here rather than reading the same
  -- availability and overselling.
  select coalesce(sum(quantity - reserved), 0)
    into v_available
    from public.inventory_batches
   where product_id = p_product_id
     for update;

  if v_available < p_quantity then
    raise exception 'Only % available', v_available;
  end if;

  select price into v_price from public.products where id = p_product_id;

  insert into public.orders (customer_id, product_id, quantity, status, reserved_date, unit_price, total_cost)
  values (auth.uid(), p_product_id, p_quantity, 'reserved', now(), v_price,
          case when v_price is null then null else round(v_price * p_quantity, 2) end)
  returning id into v_order_id;

  -- Oldest batch first: milk should leave in the order it came in.
  for r in
    select id, quantity - reserved as free
      from public.inventory_batches
     where product_id = p_product_id and quantity > reserved
     order by produced_date, id
  loop
    exit when v_remaining <= 0;
    v_take := least(r.free, v_remaining);
    update public.inventory_batches set reserved = reserved + v_take where id = r.id;
    v_remaining := v_remaining - v_take;
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.reserve_product(bigint, numeric) from public;
grant execute on function public.reserve_product(bigint, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel: release what was held.
--
-- Releases newest-batch-first, the reverse of how it was taken. That is not
-- guaranteed to return the quantity to the same batch it came from — doing
-- that properly needs an order-to-batch allocation table, which matters for
-- beef (a cut should stay traceable to the steer) and doesn't for pooled
-- milk. The totals are always right; only the per-batch attribution is
-- approximate. Worth revisiting when meat goes through the store.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_my_order(order_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id bigint;
  v_quantity   numeric;
  v_remaining  numeric;
  v_give       numeric;
  r            record;
begin
  update public.orders
     set status = 'cancelled',
         cancelled_date = now()
   where id = order_id
     and customer_id = auth.uid()
     and picked_up_date is null
     and cancelled_date is null
  returning product_id, quantity into v_product_id, v_quantity;

  if not found then
    raise exception 'Order not found, not yours, or already collected';
  end if;

  v_remaining := v_quantity;

  for r in
    select id, reserved
      from public.inventory_batches
     where product_id = v_product_id and reserved > 0
     order by produced_date desc, id desc
     for update
  loop
    exit when v_remaining <= 0;
    v_give := least(r.reserved, v_remaining);
    update public.inventory_batches set reserved = reserved - v_give where id = r.id;
    v_remaining := v_remaining - v_give;
  end loop;
end;
$$;

revoke all on function public.cancel_my_order(bigint) from public;
grant execute on function public.cancel_my_order(bigint) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- ⚠️ Existing orders were created before any of this, so batches.reserved
-- does not currently account for them. Check the drift:
--
--   select p.name,
--          coalesce(sum(b.reserved), 0)                        as batches_say,
--          (select coalesce(sum(o.quantity), 0) from public.orders o
--            where o.product_id = p.id and o.status = 'reserved') as orders_say
--     from public.products p
--     left join public.inventory_batches b on b.product_id = p.id
--    group by p.id, p.name
--    order by p.name;
--
-- Reconcile deliberately rather than with a blanket update — an order marked
-- 'completed' has been collected and should not still be holding stock,
-- while one marked 'reserved' should:
--
--   update public.inventory_batches b
--      set reserved = 0
--    where b.product_id = <id>;
--   -- then re-run reserve_product for each genuinely outstanding order,
--   -- or set reserved by hand from the query above.
-- ---------------------------------------------------------------------------

-- Rollback:
--
--   drop function if exists public.reserve_product(bigint, numeric);
--   -- and restore the simpler cancel from 009, which only marks the order.
