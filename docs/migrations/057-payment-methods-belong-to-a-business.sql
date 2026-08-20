-- 057 — Payment methods belong to a business.
--
-- `public.payment_methods` was one global list of three — Cash, Venmo, Check —
-- keyed on `code` alone, readable by everyone and writable by
-- `is_farmer()`. That is the same "is this account a farmer" grant migration
-- 056 took off `profiles`: any farmer on the instance could rename or retire
-- a method every other farm's books post against.
--
-- The reason to split it is not only the grant, though. A farm that wants to
-- take Zelle, or one that takes nothing but cash at the gate, is making a
-- decision about its own business, and a single shared row cannot hold two
-- answers.
--
-- ── Reading stays open on purpose ────────────────────────────────────────
--
-- The select policy stays `true`. What a farm accepts is the sign on its own
-- gate: the storefront shows it to a customer who is not a member of
-- anything, and to `anon` before they sign in. Writing is what narrows, to
-- the owners of that business.
--
-- ── Why the two pickup functions are reprinted here in full ──────────────
--
-- `complete_pickup` and `complete_scheduled_pickup` each validate the method
-- against this table, and "is this code active anywhere" would now accept one
-- farm's method on another farm's order. The bodies below were taken from the
-- live database and have exactly one change each — the `business_id =` line
-- in that check. Everything else is byte-for-byte what was already running.

begin;

-- ── the column, and every business's own copy of the three ───────────────

-- `orders.payment_method` references payment_methods(code), and that key is
-- about to gain a column. It comes off here and goes back composite below,
-- which is a better constraint than the one it replaces: an order can then
-- only carry a method its own business offers, enforced by the database
-- rather than by the two functions remembering to check.
alter table public.orders drop constraint if exists orders_payment_method_fkey;

alter table public.payment_methods
  add column if not exists business_id bigint references public.businesses (id) on delete cascade;

-- The old primary key is `code` alone, and it has to go *before* the copies
-- are made rather than after: four businesses each wanting a row called
-- 'Cash' is four collisions on it, and the first attempt at this migration
-- silently inserted nothing at all and then deleted the originals, leaving
-- every farm with an empty list. Dropped here, replaced below.
alter table public.payment_methods drop constraint if exists payment_methods_pkey;

-- Each existing global row becomes one row per business, keeping its label
-- and its order. Then the globals go.
insert into public.payment_methods (business_id, code, label, active, sort_order)
select b.id, m.code, m.label, m.active, m.sort_order
  from public.payment_methods m
 cross join public.businesses b
 where m.business_id is null;

delete from public.payment_methods where business_id is null;

alter table public.payment_methods alter column business_id set not null;
alter table public.payment_methods add primary key (business_id, code);

-- MATCH SIMPLE, which is the default: an order with no method recorded —
-- most of them, and every one that predates pricing — has a null in the pair
-- and skips the check exactly as it did before.
alter table public.orders
  add constraint orders_payment_method_fkey
  foreign key (business_id, payment_method)
  references public.payment_methods (business_id, code);

-- ── a new business starts with the three ─────────────────────────────────

/**
 * Seed a business's payment methods when it is created.
 *
 * Without this a farm signed up tomorrow has an empty list, and an empty list
 * is worse than a wrong one: the client falls back to offering Cash and Venmo
 * while the two pickup functions reject both, which is 'Invalid payment
 * method' with the customer standing in the yard. That exact mismatch is what
 * migration 022 existed to end.
 */
create or replace function public.seed_payment_methods()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.payment_methods (business_id, code, label, active, sort_order)
  values (new.id, 'Cash', 'Cash', true, 10),
         (new.id, 'Venmo', 'Venmo', true, 20),
         (new.id, 'Check', 'Check', true, 30)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists seed_payment_methods_on_business on public.businesses;
create trigger seed_payment_methods_on_business
  after insert on public.businesses
  for each row execute function public.seed_payment_methods();

-- ── who may change them ──────────────────────────────────────────────────

drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select
  on public.payment_methods for select
  using (true);

drop policy if exists payment_methods_write on public.payment_methods;
create policy payment_methods_write
  on public.payment_methods for all to authenticated
  using (business_id in (select public.current_user_owned_business_ids()))
  with check (business_id in (select public.current_user_owned_business_ids()));

-- The table was created with the default blanket grants, so `anon` held
-- INSERT, UPDATE, DELETE and TRUNCATE on it. The policy above refuses them
-- all, but a grant nobody wants is a grant to take away.
revoke all on public.payment_methods from anon;
grant select on public.payment_methods to anon;
revoke truncate on public.payment_methods from authenticated;

-- ── the two functions that validate a method ─────────────────────────────

CREATE OR REPLACE FUNCTION public.complete_pickup(p_order_id bigint, p_final_quantity numeric DEFAULT NULL::numeric, p_payment_method text DEFAULT NULL::text, p_amount_paid numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_order orders%rowtype; v_final numeric; v_release numeric; v_consume numeric;
        v_batch record; v_take numeric; v_price numeric; v_added_from date; v_added_to date;
        v_by_animal jsonb := '{}'::jsonb;
        v_key text; v_animal uuid; v_qty numeric; v_total_cost numeric;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.customer_id <> auth.uid() and not is_farmer() then raise exception 'Not allowed'; end if;
  if v_order.status <> 'reserved' then raise exception 'Order is not active'; end if;
  v_final := round(coalesce(p_final_quantity, v_order.quantity), 3);
  if v_final < 0 or v_final > v_order.quantity then raise exception 'Invalid final quantity'; end if;
  if p_payment_method is not null and not exists (
       select 1 from payment_methods
        where code = p_payment_method and active
          and business_id = v_order.business_id
     ) then
    raise exception 'Invalid payment method: %', p_payment_method; end if;

  v_release := v_order.quantity - v_final;
  for v_batch in
    select * from inventory_batches where inventory_batches.product_id = v_order.product_id and reserved > 0
    order by produced_date for update
  loop
    exit when v_release <= 0;
    v_take := least(v_batch.reserved, v_release);
    update inventory_batches set reserved = reserved - v_take where id = v_batch.id;
    v_release := v_release - v_take;
  end loop;

  v_consume := v_final;
  for v_batch in
    select * from inventory_batches where inventory_batches.product_id = v_order.product_id and reserved > 0
    order by produced_date for update
  loop
    exit when v_consume <= 0;
    v_take := least(v_batch.reserved, v_consume);
    if v_take > 0 then
      v_added_from := least(coalesce(v_added_from, v_batch.produced_date), v_batch.produced_date);
      v_added_to   := greatest(coalesce(v_added_to, v_batch.produced_date), v_batch.produced_date);
      -- remember which animal supplied this much, before the batch is
      -- decremented and possibly deleted below
      if v_batch.herd_animal_id is not null then
        v_key := v_batch.herd_animal_id::text;
        v_by_animal := jsonb_set(
          v_by_animal, array[v_key],
          to_jsonb(coalesce((v_by_animal ->> v_key)::numeric, 0) + v_take)
        );
      end if;
    end if;
    update inventory_batches set quantity = quantity - v_take, reserved = reserved - v_take where id = v_batch.id;
    v_consume := v_consume - v_take;
  end loop;
  delete from inventory_batches where inventory_batches.product_id = v_order.product_id and quantity = 0;

  select price into v_price from products where id = v_order.product_id;
  v_total_cost := round(coalesce(v_price,0) * v_final, 2);

  update orders set status='completed', picked_up_date=now(), quantity=v_final,
    unit_price = v_price, total_cost = v_total_cost,
    payment_method = p_payment_method, amount_paid = p_amount_paid,
    added_from = v_added_from, added_to = v_added_to
  where id = p_order_id;

  -- split the proceeds across the animals that actually supplied this order,
  -- in proportion to quantity. Rounds to whole cents and gives any remainder
  -- to the largest contributor, so the parts always sum to the total.
  if v_final > 0 and v_by_animal <> '{}'::jsonb then
    declare
      v_assigned bigint := 0;
      v_total_cents bigint := round(v_total_cost * 100);
      v_biggest uuid; v_biggest_qty numeric := -1;
      v_share bigint;
    begin
      for v_key, v_qty in select * from jsonb_each_text(v_by_animal) loop
        if v_qty > v_biggest_qty then v_biggest_qty := v_qty; v_biggest := v_key::uuid; end if;
      end loop;

      for v_key, v_qty in select * from jsonb_each_text(v_by_animal) loop
        v_animal := v_key::uuid;
        if v_animal = v_biggest then continue; end if;
        v_share := round(v_total_cents * (v_qty / v_final));
        v_assigned := v_assigned + v_share;
        perform herd.record_meat_sale(p_order_id, v_animal, v_order.product_id, v_qty, v_share);
      end loop;

      perform herd.record_meat_sale(
        p_order_id, v_biggest, v_order.product_id, v_biggest_qty, v_total_cents - v_assigned
      );
    end;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.complete_scheduled_pickup(p_schedule_id bigint, p_quantity numeric DEFAULT NULL::numeric, p_payment_method text DEFAULT NULL::text, p_amount_paid numeric DEFAULT NULL::numeric)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sched schedules%rowtype; v_qty numeric; v_pickup_date date; v_remaining numeric;
        v_batch record; v_take numeric; v_order_id bigint; v_price numeric;
        v_added_from date; v_added_to date; v_business bigint;
begin
  select * into v_sched from schedules where id = p_schedule_id for update;
  if not found then raise exception 'Schedule not found'; end if;
  if v_sched.customer_id <> auth.uid() and not is_farmer() then raise exception 'Not allowed'; end if;
  if v_sched.cancelled_at is not null then raise exception 'That standing order was cancelled'; end if;
  v_qty := round(coalesce(p_quantity, v_sched.quantity), 3);
  if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
  if v_qty > v_sched.quantity and not is_farmer() then
    raise exception 'This week is for % — collecting more than that needs a separate order', v_sched.quantity;
  end if;
  if p_payment_method is not null and not exists (
       select 1 from payment_methods
        where code = p_payment_method and active
          and business_id = v_sched.business_id
     ) then
    raise exception 'Invalid payment method: %', p_payment_method; end if;
  v_pickup_date := next_pickup_date(v_sched.day, v_sched.start_date, v_sched.skipped_dates, v_sched.fulfilled_dates);
  if v_pickup_date is null then raise exception 'That standing order has no next pickup'; end if;

  select business_id, price into v_business, v_price from products where id = v_sched.product_id;

  v_remaining := v_qty;
  for v_batch in
    select * from inventory_batches where inventory_batches.product_id = v_sched.product_id and quantity > reserved
    order by produced_date for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_batch.quantity - v_batch.reserved, v_remaining);
    if v_take > 0 then
      v_added_from := least(coalesce(v_added_from, v_batch.produced_date), v_batch.produced_date);
      v_added_to   := greatest(coalesce(v_added_to, v_batch.produced_date), v_batch.produced_date);
    end if;
    update inventory_batches set quantity = quantity - v_take where id = v_batch.id;
    v_remaining := v_remaining - v_take;
  end loop;
  if v_remaining > 0 then raise exception 'Not enough inventory on hand for this pickup'; end if;
  delete from inventory_batches where inventory_batches.product_id = v_sched.product_id and quantity = 0;

  insert into orders (customer_id, product_id, quantity, status, reserved_date, picked_up_date, schedule_id,
                      unit_price, total_cost, payment_method, amount_paid, added_from, added_to, business_id)
  values (v_sched.customer_id, v_sched.product_id, v_qty, 'completed', now(), now(), p_schedule_id,
          v_price, round(coalesce(v_price,0) * v_qty, 2), p_payment_method, p_amount_paid,
          v_added_from, v_added_to, v_business)
  returning id into v_order_id;

  update schedules
  set fulfilled_dates = coalesce(fulfilled_dates, '[]'::jsonb) || to_jsonb(to_char(v_pickup_date, 'YYYY-MM-DD'))
  where id = p_schedule_id;
  return v_order_id;
end $function$
;

commit;
