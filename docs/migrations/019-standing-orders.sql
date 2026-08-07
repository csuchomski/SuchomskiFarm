-- 019 — Standing weekly orders: scoping, cancelling, and a 3-day hold.
--
-- STATUS: RUN, 2026-08-07.
-- Depends on: 010 (business scoping), 017 (reserve_product sets business_id).
--
-- Verified after running, in a transaction that rolled back and with the
-- session assuming the owner's identity (set local role authenticated plus
-- request.jwt.claims), so RLS and every security-definer guard applied as
-- they do in the app:
--
--   one signature each — no overloads created
--   a pickup 3 days out       -> holds its stock
--   a pickup 5 days out       -> holds nothing
--   skipping that week        -> releases the hold
--   fulfilling                -> order carries business_id 5, the week is
--                                marked fulfilled, stock drops by exactly 1
--   cancelling                -> releases the hold and blocks collection
--   day 'Thurs'               -> refused by the check constraint
--
-- public.schedules has existed since before this app — quantity, a weekday
-- name, start_date, and jsonb arrays of skipped and fulfilled dates — with
-- next_pickup_date() and complete_scheduled_pickup() already written against
-- it. It has no rows and no UI. Making it usable needs five changes.
--
-- ── 1. Scoping ────────────────────────────────────────────────────────
--
-- schedules has no business_id, so its RLS falls back to is_farmer(), which
-- is global: a farmer in two businesses sees both businesses' standing
-- orders with no way to tell them apart. orders solved this in 010; this
-- brings schedules in line.
--
-- ── 2. Cancelling ─────────────────────────────────────────────────────
--
-- The only way to stop a standing order today is to DELETE the row, which
-- takes its fulfilled_dates history with it — you lose the record of every
-- pickup that ever happened against it. cancelled_at makes stopping
-- reversible and keeps the history.
--
-- ── 3. The hold window: 7 days -> 3 ───────────────────────────────────
--
-- Both product_stats() and reserve_product() currently hold stock for any
-- standing order due within 7 days. A week is most of the shelf life of raw
-- milk and holds far more than it needs to: a Thursday pickup starts
-- blocking shop sales the previous Friday. Three days is the requested rule
-- and is what both now use.
--
-- ── 4. complete_scheduled_pickup leaves orders unscoped ───────────────
--
-- The same bug 017 fixed in reserve_product: the order it inserts has no
-- business_id, and is_business_member(null) is false, so a fulfilled
-- standing order would be invisible to the farmer on Store -> Orders. Fixed
-- here the same way, from the product.
--
-- ── 5. check_schedule_capacity is wrong for a subscription ────────────
--
-- The trigger refuses any standing order whose total demand exceeds stock
-- *on hand today*. That is right for a one-off reservation and wrong for a
-- subscription: signing up for 4 gallons every Thursday is a commitment to
-- future weeks, not a claim on this morning's milk. As written, nobody can
-- subscribe on a day the tank is low, which is exactly when you most want
-- the commitment on the books.
--
-- It now guards only the imminent window — the same 3 days the hold uses —
-- so it still refuses a standing order that would oversell stock already
-- promised, without refusing next month's.

begin;

-- ── 1 & 2: columns ────────────────────────────────────────────────────

alter table public.schedules
  add column if not exists business_id  bigint references public.businesses(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists note         text not null default '';

-- Backfill from the product, the same source 017 used for orders.
update public.schedules s
   set business_id = p.business_id
  from public.products p
 where p.id = s.product_id and s.business_id is null;

-- next_pickup_date() maps the day name through a fixed array and returns
-- null for anything else — which would silently make a standing order never
-- fire. Reject it at write time instead.
alter table public.schedules drop constraint if exists schedules_day_check;
alter table public.schedules add constraint schedules_day_check
  check (day in ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'));

create index if not exists schedules_product_active_idx
  on public.schedules (product_id) where cancelled_at is null;

-- ── RLS: match orders ─────────────────────────────────────────────────

drop policy if exists "own schedules or farmer" on public.schedules;
drop policy if exists "insert own or farmer" on public.schedules;
drop policy if exists "update own or farmer" on public.schedules;
drop policy if exists "delete own or farmer" on public.schedules;

create policy "read own schedules or farmer reads business"
  on public.schedules for select
  using (auth.uid() = customer_id or public.is_business_member(business_id));

create policy "insert own schedule or farmer"
  on public.schedules for insert
  with check (auth.uid() = customer_id or public.is_business_member(business_id));

create policy "update own schedule or farmer"
  on public.schedules for update
  using (auth.uid() = customer_id or public.is_business_member(business_id))
  with check (auth.uid() = customer_id or public.is_business_member(business_id));

-- No delete policy: cancelling is an update to cancelled_at, so the pickup
-- history survives. Removing the row is a data-repair job, not a feature.

-- ── 3 & 5: the 3-day hold ─────────────────────────────────────────────

create or replace function public.product_stats()
returns table(product_id bigint, on_hand numeric, active_reserved numeric,
              incoming_forecast numeric, scheduled_demand numeric, shoppable numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with base as (
    select p.id,
      coalesce((select sum(b.quantity - b.reserved) from inventory_batches b where b.product_id = p.id), 0) as on_hand,
      coalesce((select sum(b.reserved) from inventory_batches b where b.product_id = p.id), 0) as active_reserved,
      coalesce(p.forecast_override,
        coalesce((select sum(b.quantity) from inventory_batches b
          where b.product_id = p.id and b.produced_date >= current_date - 7), 0)
        + coalesce((select sum(o.quantity) from orders o
          where o.product_id = p.id and o.status = 'completed'
            and o.picked_up_date >= now() - interval '7 days'), 0)
        + coalesce((select sum(d.quantity) from discards d
          where d.product_id = p.id and d.created_at >= now() - interval '7 days'), 0)
      ) as incoming_forecast,
      -- 3 days, not 7, and cancelled standing orders hold nothing.
      coalesce((select sum(s.quantity) from schedules s
        where s.product_id = p.id
          and s.cancelled_at is null
          and next_pickup_date(s.day, s.start_date, s.skipped_dates, s.fulfilled_dates)
              <= current_date + 3), 0) as scheduled_demand
    from products p
  )
  select id, on_hand, active_reserved, incoming_forecast, scheduled_demand,
    greatest(0, on_hand - scheduled_demand)
  from base
$function$;

create or replace function public.check_schedule_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v record; v_extra numeric; v_due date;
begin
  new.quantity := round(new.quantity, 3);
  if is_farmer() then return new; end if;
  if new.cancelled_at is not null then return new; end if;

  -- A subscription is a commitment to future weeks, not a claim on today's
  -- stock. Only a pickup inside the hold window can oversell anything, so
  -- only that is checked; the forecast is what warns about later weeks.
  v_due := next_pickup_date(new.day, new.start_date, new.skipped_dates, new.fulfilled_dates);
  if v_due is null or v_due > current_date + 3 then return new; end if;

  select * into v from product_stats() where product_stats.product_id = new.product_id;
  v_extra := new.quantity;
  if tg_op = 'UPDATE' and old.product_id = new.product_id then
    v_extra := new.quantity - old.quantity;
  end if;
  if coalesce(v.scheduled_demand, 0) + v_extra > coalesce(v.on_hand, 0) then
    raise exception 'There is not enough % on hand for a pickup this soon — start it a few days later, or reduce the quantity',
      (select name from products where id = new.product_id);
  end if;
  return new;
end $function$;

-- reserve_product: same 3-day window, same exclusion of cancelled standing
-- orders. Body otherwise identical to 017, signature copied verbatim so this
-- replaces rather than overloads.
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

  select business_id into v_business from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;

  if not is_farmer() then
    select coalesce(sum(quantity - reserved), 0) into v_on_hand
    from inventory_batches where product_id = p_product_id;
    select coalesce(sum(s.quantity), 0) into v_sched
    from schedules s
    where s.product_id = p_product_id
      and s.cancelled_at is null
      and next_pickup_date(s.day, s.start_date, s.skipped_dates, s.fulfilled_dates) <= current_date + 3;
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

-- ── 4: a fulfilled standing order belongs to a business ───────────────

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
  if p_payment_method is not null and p_payment_method not in ('Cash','Venmo') then
    raise exception 'Invalid payment method'; end if;
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

-- Verify after running:
--
--   -- exactly one of each, not overloads
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('reserve_product','product_stats','complete_scheduled_pickup');
--
--   -- the hold window is 3 days
--   select prosrc like '%current_date + 3%' from pg_proc where proname = 'product_stats';
--
-- Rollback: restore the 7-day window in product_stats and reserve_product,
-- restore the unconditional check in check_schedule_capacity, and
--   alter table public.schedules
--     drop column if exists business_id,
--     drop column if exists cancelled_at,
--     drop column if exists note;
-- Dropping business_id also requires restoring the is_farmer() policies.
