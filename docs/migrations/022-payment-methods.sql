-- 022 — Payment methods become data, so "Check" is a row rather than a
--       migration.
--
-- STATUS: RUN, 2026-08-07. Verified in a rolled-back transaction with the
-- session assuming a real buyer's identity, so RLS applied throughout:
--   buyer reads all three methods
--   buyer's insert into payment_methods refused by RLS
--   buyer reserved milk and completed it themselves: Check / $5.00 / qty 1
--   'Bitcoin' refused — 'Invalid payment method: Bitcoin'
--   standing-order pickup completed by Check
--   40 against a 2-unit standing order refused
-- Depends on: nothing. Additive except for one FK on an existing column.
--
-- ── Why ───────────────────────────────────────────────────────────────
--
-- complete_pickup and complete_scheduled_pickup both carry the same literal:
--
--   if p_payment_method is not null and p_payment_method not in ('Cash','Venmo')
--     then raise exception 'Invalid payment method'; end if;
--
-- So a customer paying by cheque cannot be recorded at all — the call is
-- refused by the database, not by the form. Widening the literal to three
-- values would fix today and leave the next one (Zelle, a card reader, a
-- swap for hay) needing another migration and another deploy.
--
-- This follows 003's shape instead: a lookup table, read by the app, so a new
-- method is one insert and no code change. The seed is the three the owner
-- named — Cash, Venmo, Check. Adding a fourth:
--
--   insert into public.payment_methods (code, label, sort_order)
--   values ('Zelle', 'Zelle', 40);
--
-- and retiring one is `set active = false`, which keeps it rendering on the
-- orders that already used it. The FK below is what makes that safe: a delete
-- would be refused while history still points at the row.

begin;

create table if not exists public.payment_methods (
  code        text primary key,
  label       text        not null,
  active      boolean     not null default true,
  sort_order  integer     not null default 100,
  created_at  timestamptz not null default now()
);

comment on table public.payment_methods is
  'How a pickup was paid for. Reference data shared across businesses — a '
  'method is not owned by one of them. Retire with active = false rather '
  'than deleting, so old orders keep their label.';

insert into public.payment_methods (code, label, sort_order) values
  ('Cash',  'Cash',  10),
  ('Venmo', 'Venmo', 20),
  ('Check', 'Check', 30)
on conflict (code) do nothing;

-- Every existing value is 'Cash' (3 rows) or null (7), verified before
-- writing this, so the FK validates without normalising anything. Null stays
-- legal: four of the completed orders on file were collected by the farmer
-- and never priced, and "collected, no payment recorded" is a real state.
alter table public.orders
  add constraint orders_payment_method_fkey
  foreign key (payment_method) references public.payment_methods(code);

alter table public.payment_methods enable row level security;

-- Readable by anyone signed in: the shop's pickup form is a customer's, and
-- it has to render the list. Writable only by a farmer — a buyer inventing a
-- payment method is not a thing this should allow, which is where this
-- differs from 003's transaction_types.
create policy payment_methods_select on public.payment_methods
  for select to authenticated using (true);

create policy payment_methods_write on public.payment_methods
  for all to authenticated using (public.is_farmer()) with check (public.is_farmer());

grant select on public.payment_methods to authenticated;

-- ── the two functions ─────────────────────────────────────────────────
--
-- Bodies are the live definitions verbatim, with only the payment check
-- changed. Signatures copied from pg_get_functiondef so these replace rather
-- than overload — see the README on 011, where a different argument count
-- silently created a second candidate.
--
-- `and active` is deliberate: a retired method can stay on history but must
-- not be selectable for a new pickup.

create or replace function public.complete_pickup(
  p_order_id bigint,
  p_final_quantity numeric default null::numeric,
  p_payment_method text default null::text,
  p_amount_paid numeric default null::numeric
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
       select 1 from payment_methods where code = p_payment_method and active
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
end $function$;

create or replace function public.complete_scheduled_pickup(
  p_schedule_id bigint,
  p_quantity numeric default null::numeric,
  p_payment_method text default null::text,
  p_amount_paid numeric default null::numeric
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
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
       select 1 from payment_methods where code = p_payment_method and active
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
end $function$;

commit;

-- ── One deliberate behaviour change beyond the payment list ────────────
--
-- complete_scheduled_pickup now refuses a *customer* a quantity above the
-- standing order's own. It previously accepted any positive number and would
-- happily consume the whole shelf: the customer-facing pickup screen added in
-- this change lets the buyer type what they collected, and without this guard
-- "4" could be typed as "40" and the database would take it.
--
-- A farmer is exempt, because handing over an extra gallon at the gate is a
-- real thing that happens and the farmer is the one holding the stock.
--
-- complete_pickup already had the equivalent guard for everyone
-- (`v_final > v_order.quantity` -> 'Invalid final quantity'); a one-off order
-- has already reserved its stock, so there is nothing to over-consume there.
--
-- ── Verify after running ──────────────────────────────────────────────
--
--   select code, label, active from public.payment_methods order by sort_order;
--     -- Cash, Venmo, Check, all active
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname in ('complete_pickup','complete_scheduled_pickup');
--     -- exactly two rows; no overloads created
--
--   select count(*) from public.orders o
--    where o.payment_method is not null
--      and not exists (select 1 from public.payment_methods m where m.code = o.payment_method);
--     -- 0, or the FK would not have validated
--
-- Rollback:
--
--   alter table public.orders drop constraint orders_payment_method_fkey;
--   drop table public.payment_methods;
--   -- and restore both function bodies, replacing the `not exists (...)`
--   -- check with `p_payment_method not in ('Cash','Venmo')` and dropping the
--   -- v_qty > v_sched.quantity guard. Any order already recorded as paid by
--   -- Check keeps that value; nothing reads it as an enum.
