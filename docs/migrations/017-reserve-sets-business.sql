-- 017 — Give a new order the business it belongs to.
--
-- STATUS: RUN, 2026-08-07.
-- Depends on: 010 (orders.business_id and the policies that read it).
--
-- Verified after running, in a transaction that rolled back and with the
-- session assuming the owner's identity (set local role authenticated plus
-- request.jwt.claims), so auth.uid() and every policy applied as they do in
-- the app rather than being bypassed as superuser:
--
--   exactly one reserve_product   -> reserve_product(bigint,numeric,uuid)
--   a new reservation             -> business_id 5, not null
--   the farmer's business filter  -> the new order is visible
--
-- ── The bug ───────────────────────────────────────────────────────────
--
-- reserve_product ends with:
--
--   insert into orders (customer_id, product_id, quantity)
--   values (v_customer, p_product_id, p_quantity) returning id into v_order_id;
--
-- business_id is never set. The column is nullable with no default, so every
-- order the function creates gets null — and it is the only way an order is
-- ever created, from the shop and from the farm side alike.
--
-- Migration 010 added the column, backfilled the nine rows that existed, and
-- rewrote the policies to read it:
--
--   read:   (auth.uid() = customer_id) OR is_business_member(business_id)
--   update: is_business_member(business_id)
--
-- is_business_member(null) is false. So an order created after 010 is
-- readable only by the customer who placed it — the farmer cannot see it at
-- all, and the update policy will not let them touch it. A customer
-- reserving milk in the shop would simply never appear on the farm's Orders
-- screen, with no error anywhere to explain it.
--
-- This is the same shape as the failure 010 itself caused and the README
-- already warns about: a policy change that silently breaks a write path,
-- because is_business_member(null) is false rather than an error.
--
-- Nothing is broken *yet*: all nine orders on file carry business 5 because
-- 010 backfilled them, and no reservation has been made since. The first one
-- made after 010 would be the first invisible order.
--
-- ── The fix ───────────────────────────────────────────────────────────
--
-- Take the business from the product being reserved. products.business_id is
-- what 010 set as the source of truth for which store a thing belongs to,
-- and an order is for exactly one product, so there is no ambiguity.
--
-- CREATE OR REPLACE only replaces on an exact signature match — that is how
-- 011 created a second reserve_product that PostgREST then resolved calls
-- to, silently. The signature below is copied verbatim from pg_get_functiondef
-- of the live function, DEFAULT included. The verification at the bottom
-- checks there is still exactly one.
--
-- Everything else in the body is unchanged from the live definition.

begin;

create or replace function public.reserve_product(
  p_product_id bigint,
  p_quantity numeric,
  p_customer uuid default null::uuid
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer uuid; v_remaining numeric;
  v_batch record; v_take numeric; v_order_id bigint;
  v_on_hand numeric; v_sched numeric;
  v_business bigint;
begin
  p_quantity := round(p_quantity, 3);
  if p_quantity is null or p_quantity <= 0 then raise exception 'Invalid quantity'; end if;
  if p_customer is not null and p_customer <> auth.uid() and not is_farmer() then
    raise exception 'Only a farmer can reserve for another user';
  end if;

  -- business_id comes back from the same locked row the existence check
  -- already reads, so this costs nothing extra.
  select business_id into v_business from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  if not is_farmer() then
    select coalesce(sum(quantity - reserved), 0) into v_on_hand
    from inventory_batches where product_id = p_product_id;
    select coalesce(sum(s.quantity), 0) into v_sched
    from schedules s
    where s.product_id = p_product_id
      and next_pickup_date(s.day, s.start_date, s.skipped_dates, s.fulfilled_dates) <= current_date + 7;
    if p_quantity > greatest(0, v_on_hand - v_sched) then
      raise exception 'Not enough inventory — % of the % on hand are held for scheduled weekly pickups',
        least(v_sched, v_on_hand), v_on_hand;
    end if;
  end if;

  v_customer := coalesce(p_customer, auth.uid());
  v_remaining := p_quantity;
  for v_batch in
    select * from inventory_batches
    where inventory_batches.product_id = p_product_id and quantity > reserved
    order by produced_date for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_batch.quantity - v_batch.reserved, v_remaining);
    update inventory_batches set reserved = reserved + v_take where id = v_batch.id;
    v_remaining := v_remaining - v_take;
  end loop;
  if v_remaining > 0 then raise exception 'Not enough inventory available'; end if;

  insert into orders (customer_id, product_id, quantity, business_id)
  values (v_customer, p_product_id, p_quantity, v_business) returning id into v_order_id;
  return v_order_id;
end $function$;

commit;

-- Verify after running:
--
--   -- exactly one reserve_product, not two
--   select p.oid::regprocedure
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'reserve_product';
--
--   -- and a new order carries a business
--   select id, business_id from public.orders order by id desc limit 1;
--
-- Rollback: restore the previous body by removing v_business and putting the
-- three-column insert back. Doing so reintroduces invisible orders, so it is
-- only worth it alongside a revert of 010's policies.
