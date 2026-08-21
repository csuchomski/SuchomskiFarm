-- 058 — Milk sold is credited to the cows that gave it.
--
-- `herd.meat_sales` had zero rows, and `herd.revenue_entries` no milk in it
-- at all, on a farm that has been selling milk since June. Two reasons, and
-- they compound:
--
-- 1. `complete_pickup` attributed a batch to `inventory_batches.herd_animal_id`,
--    which is null whenever milk is **pooled** — and pooling is how this farm
--    records it. `record_production` writes one batch for the day and a
--    production record per cow against it, so the tank is what gets sold and
--    the batch names nobody.
-- 2. `complete_scheduled_pickup` — every standing order — never attributed
--    anything to anyone, pooled or not. It had no such code.
--
-- So an animal's page could show what she gave and never what it earned.
--
-- ── How a pooled tank is split ──────────────────────────────────────────
--
-- By what each cow put in it. `herd.batch_shares` reads the production
-- records behind a batch and apportions whatever was taken from it. That is
-- an apportionment rather than a measurement — five of seven gallons hers
-- means five sevenths of that day's takings — and it is the only honest
-- answer for milk that went into a shared tank. A batch with no production
-- records behind it (stock added straight from the Store screen) attributes
-- nothing, which is right: no cow made it.
--
-- ── What the money split does that it did not before ────────────────────
--
-- It only hands out the takings that belong to milk a cow actually gave. The
-- old code gave the rounding remainder to the largest contributor, which on
-- a mixed order meant crediting her for Store-added stock as well. Now the
-- pot is scaled to the attributed share first.
--
-- ── The category ───────────────────────────────────────────────────────
--
-- Milk revenue is filed as `milk_attributed`, not `packaged_meat`. Both are
-- already in the check constraint; only one of them is true.

begin;

-- ── who filled a batch, and with how much ──────────────────────────────

create or replace function herd.batch_shares(p_batch_id bigint, p_take numeric)
returns table (animal_id uuid, quantity numeric)
language sql
stable
security definer
set search_path to 'herd', 'public'
as $$
  with pool as (
    select pr.animal_id, sum(pr.quantity) as gave
      from herd.production_records pr
     where pr.batch_id = p_batch_id
       and pr.deleted_at is null
     group by pr.animal_id
  ),
  total as (select sum(gave) as all_gave from pool)
  select p.animal_id, p_take * (p.gave / t.all_gave)
    from pool p
   cross join total t
   where t.all_gave > 0
     and p_take > 0;
$$;

grant execute on function herd.batch_shares(bigint, numeric) to authenticated;

-- ── one sale, against one animal ───────────────────────────────────────

/**
 * Like record_meat_sale, with the two things it could not say: the day the
 * sale happened, and what kind of produce it was. Milk booked as packaged
 * meat is a wrong answer on a tax line, and `current_date` is wrong for
 * anything recorded after the fact.
 */
create or replace function herd.record_product_sale(
  p_order_id bigint,
  p_animal_id uuid,
  p_product_id bigint,
  p_quantity numeric,
  p_amount_cents bigint,
  p_sold_on date
)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $$
declare
  v_farm_id  uuid;
  v_name     text;
  v_unit     text;
  v_type     text;
  v_category text;
  v_on       date := coalesce(p_sold_on, current_date);
begin
  select farm_id into v_farm_id from herd.animals where id = p_animal_id;
  if v_farm_id is null then return; end if;

  select name, unit, type_code into v_name, v_unit, v_type
    from public.products where id = p_product_id;

  v_category := case when v_type = 'milk' then 'milk_attributed' else 'packaged_meat' end;

  insert into herd.meat_sales
    (farm_id, order_id, animal_id, product_id, product_name, quantity, unit, amount_cents, sold_on)
  values
    (v_farm_id, p_order_id, p_animal_id, p_product_id, coalesce(v_name, ''),
     p_quantity, coalesce(v_unit, ''), p_amount_cents, v_on);

  insert into herd.revenue_entries
    (farm_id, animal_id, date, amount_cents, category, source, is_internal_transfer, note)
  values
    (v_farm_id, p_animal_id, v_on, p_amount_cents, v_category, 'farm_app',
     false, 'Order #' || p_order_id || ' — ' || round(p_quantity, 3) || ' ' ||
            coalesce(v_unit, '') || ' ' || coalesce(v_name, ''));
end $$;

-- The old name stays and delegates: it is what any function written before
-- today calls, and a signature that vanishes takes those with it.
create or replace function herd.record_meat_sale(
  p_order_id bigint, p_animal_id uuid, p_product_id bigint,
  p_quantity numeric, p_amount_cents bigint
)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $$
begin
  perform herd.record_product_sale(
    p_order_id, p_animal_id, p_product_id, p_quantity, p_amount_cents, current_date
  );
end $$;

-- ── the money, divided ─────────────────────────────────────────────────

/**
 * Split an order's takings across the animals that supplied it.
 *
 * Whole cents, with the remainder to the largest contributor, so the parts
 * always sum to the pot. The pot is the order's total scaled by how much of
 * the order was actually attributable: milk from a Store-added batch belongs
 * to no cow, and handing its share to whoever gave the most would credit her
 * for stock she never made.
 */
create or replace function herd.attribute_order(
  p_order_id bigint,
  p_product_id bigint,
  p_by_animal jsonb,
  p_total_cents bigint,
  p_sold_on date
)
returns void
language plpgsql
security definer
set search_path to 'herd', 'public'
as $$
declare
  v_final       numeric;
  v_attributed  numeric := 0;
  v_key         text;
  v_qty         numeric;
  v_biggest     uuid;
  v_biggest_qty numeric := -1;
  v_pot         bigint;
  v_assigned    bigint := 0;
  v_share       bigint;
begin
  if p_by_animal is null or p_by_animal = '{}'::jsonb or coalesce(p_total_cents, 0) <= 0 then
    return;
  end if;

  select quantity into v_final from public.orders where id = p_order_id;
  if v_final is null or v_final <= 0 then return; end if;

  for v_key, v_qty in select * from jsonb_each_text(p_by_animal) loop
    v_attributed := v_attributed + v_qty;
    if v_qty > v_biggest_qty then
      v_biggest_qty := v_qty;
      v_biggest := v_key::uuid;
    end if;
  end loop;
  if v_attributed <= 0 then return; end if;

  v_pot := round(p_total_cents * least(1, v_attributed / v_final));

  for v_key, v_qty in select * from jsonb_each_text(p_by_animal) loop
    if v_key::uuid = v_biggest then continue; end if;
    v_share := round(v_pot * (v_qty / v_attributed));
    v_assigned := v_assigned + v_share;
    perform herd.record_product_sale(p_order_id, v_key::uuid, p_product_id, v_qty, v_share, p_sold_on);
  end loop;

  perform herd.record_product_sale(
    p_order_id, v_biggest, p_product_id, v_biggest_qty, v_pot - v_assigned, p_sold_on
  );
end $$;

-- ── the two pickup paths ───────────────────────────────────────────────

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
      -- Remember which animals supplied this much, before the batch is
      -- decremented and possibly deleted below.
      --
      -- This used to read herd_animal_id off the batch, which is null on a
      -- pooled batch — one tank, several cows — so a farm that pools its milk
      -- attributed nothing to anybody, ever. batch_shares splits what was
      -- taken across the milkings that filled it, and answers for a batch
      -- that names one animal too.
      for v_animal, v_qty in
        select animal_id, quantity from herd.batch_shares(v_batch.id, v_take)
      loop
        v_key := v_animal::text;
        v_by_animal := jsonb_set(
          v_by_animal, array[v_key],
          to_jsonb(coalesce((v_by_animal ->> v_key)::numeric, 0) + v_qty)
        );
      end loop;
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

  -- Split the proceeds across the animals that actually supplied this order.
  -- The arithmetic moved to herd.attribute_order, which the standing-order
  -- path now shares — it had none of its own and credited nobody.
  if v_final > 0 and v_by_animal <> '{}'::jsonb then
    perform herd.attribute_order(
      p_order_id, v_order.product_id, v_by_animal, round(v_total_cost * 100)::bigint, current_date
    );
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
        -- Who filled the tank this pickup drew from, and how much of it was
        -- theirs. Nothing here tracked that before, so a standing order sold
        -- milk that no cow was ever credited for.
        v_by_animal jsonb := '{}'::jsonb;
        v_key text; v_animal uuid; v_part numeric;
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
    for v_animal, v_part in
      select animal_id, quantity from herd.batch_shares(v_batch.id, v_take)
    loop
      v_key := v_animal::text;
      v_by_animal := jsonb_set(
        v_by_animal, array[v_key],
        to_jsonb(coalesce((v_by_animal ->> v_key)::numeric, 0) + v_part)
      );
    end loop;
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

  if v_by_animal <> '{}'::jsonb then
    perform herd.attribute_order(
      v_order_id, v_sched.product_id, v_by_animal,
      round(round(coalesce(v_price, 0) * v_qty, 2) * 100)::bigint, current_date
    );
  end if;

  update schedules
  set fulfilled_dates = coalesce(fulfilled_dates, '[]'::jsonb) || to_jsonb(to_char(v_pickup_date, 'YYYY-MM-DD'))
  where id = p_schedule_id;
  return v_order_id;
end $function$
;

-- ── what has already been sold ─────────────────────────────────────────
--
-- Only where it is exact. An order stamped with a single produced date drew
-- from that day alone, and the production records for that day say who gave
-- it — so the split is a fact, not a reconstruction. An order that drew
-- across a range (10–24 Jun, on this farm) cannot be pinned to anybody and
-- is left alone rather than guessed at.

do $backfill$
declare
  r       record;
  v_total numeric;
  v_by    jsonb;
begin
  for r in
    select o.id, o.product_id, o.added_from, o.quantity,
           coalesce(o.picked_up_date::date, o.added_from) as sold_on,
           round(coalesce(o.total_cost, 0) * 100)::bigint as cents
      from public.orders o
     where o.status = 'completed'
       and o.added_from is not null
       and o.added_from = o.added_to
       and coalesce(o.total_cost, 0) > 0
       and not exists (select 1 from herd.meat_sales m where m.order_id = o.id)
  loop
    select coalesce(sum(pr.quantity), 0) into v_total
      from herd.production_records pr
     where pr.deleted_at is null
       and pr.product_id = r.product_id
       and pr.produced_date = r.added_from;
    if v_total <= 0 then continue; end if;

    select jsonb_object_agg(x.animal_id::text, to_jsonb(r.quantity * (x.gave / v_total)))
      into v_by
      from (
        select pr.animal_id, sum(pr.quantity) as gave
          from herd.production_records pr
         where pr.deleted_at is null
           and pr.product_id = r.product_id
           and pr.produced_date = r.added_from
         group by pr.animal_id
      ) x;

    perform herd.attribute_order(r.id, r.product_id, v_by, r.cents, r.sold_on);
  end loop;
end $backfill$;

commit;
