-- 073 — a helper can still milk
--
-- STATUS: run 2026-09-24
--
-- 071 gave the store's stock to the owner alone, and in doing so took the
-- milking pail off the helper. Recording a milking writes two things: the
-- herd's production_records, and the day's inventory batch the shop sells
-- from. The app did the second straight against inventory_batches, from the
-- browser, which after 071 only an owner may write. A helper would fill in
-- the morning's milk and be told no.
--
-- The answer is not to give helpers the store back. It is to give milking a
-- door of its own: a function that checks what every herd write checks —
-- can this person write to this farm — and then touches exactly one batch,
-- the one this day's milkings already point at, by adding to it. It cannot
-- price anything, sell anything, or reach a batch no milking made.
--
-- Doing it in one function also makes it one transaction. The browser used
-- to move the batch and then insert the milkings as two requests; if the
-- second failed, the stock had already changed and the app could only say so.
--
-- And one quiet failure fixed on the way: a pickup that empties a batch
-- deletes it, so the next milking that day followed batch_id to a row that
-- was gone and failed on "no rows". This makes a fresh batch instead.
--
-- Also: the product list goes back to being readable by anyone on the farm.
-- A helper has to find the milk product to record milk against it, and on a
-- farm with the store switched on those names and prices are already public
-- in the shop. Changing products stays the owner's.

create or replace function herd.record_milkings(
  p_farm_id       uuid,
  p_product_id    bigint,
  p_produced_date date,
  p_entries       jsonb,
  p_note          text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = herd, public, pg_temp
as $$
declare
  v_business bigint;
  v_name     text;
  v_unit     text;
  v_added    numeric := 0;
  v_batch    bigint;
  v_qty      numeric;
  v_entry    jsonb;
  v_q        numeric;
  v_records  jsonb;
begin
  if p_farm_id is null or not can_write_farm(p_farm_id) then
    raise exception 'That is not a farm you can write to.';
  end if;

  select business_id into v_business from herd.farms where id = p_farm_id;
  select name, unit into v_name, v_unit
    from public.products where id = p_product_id and business_id = v_business;
  if v_name is null then
    raise exception 'That product is not this farm''s.';
  end if;

  if p_produced_date is null then
    raise exception 'A date is required.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'Enter a quantity for at least one animal.';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_q := (v_entry ->> 'quantity')::numeric;
    if v_q is null or v_q < 0 then
      raise exception 'A quantity can''t be negative.';
    end if;
    if not exists (
      select 1 from herd.animals where id = (v_entry ->> 'animal_id')::uuid and farm_id = p_farm_id
    ) then
      raise exception 'That animal is not on this farm.';
    end if;
    v_added := v_added + v_q;
  end loop;
  v_added := round(v_added, 3);

  -- The day's batch, found through the milkings that already point at it —
  -- never by searching batches for a matching date, which could pick one
  -- entered by hand.
  select pr.batch_id into v_batch
    from herd.production_records pr
   where pr.farm_id = p_farm_id and pr.product_id = p_product_id
     and pr.produced_date = p_produced_date
     and pr.batch_id is not null and pr.deleted_at is null
   limit 1;

  -- Added to, never recomputed: the batch may hold stock entered by hand.
  if v_batch is not null then
    update public.inventory_batches
       set quantity = round(quantity + v_added, 3)
     where id = v_batch and business_id = v_business
    returning quantity into v_qty;
    if not found then v_batch := null; end if;
  end if;

  if v_batch is null then
    insert into public.inventory_batches (business_id, product_id, produced_date, quantity, reserved)
    values (v_business, p_product_id, p_produced_date, v_added, 0)
    returning id, quantity into v_batch, v_qty;
  end if;

  with ins as (
    insert into herd.production_records
      (farm_id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id, note)
    select p_farm_id, (e ->> 'animal_id')::uuid, p_product_id, v_name,
           (e ->> 'quantity')::numeric, coalesce(v_unit, ''), p_produced_date, v_batch,
           coalesce(p_note, '')
      from jsonb_array_elements(p_entries) e
    returning id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id, note
  )
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_records from ins;

  return jsonb_build_object('batch_id', v_batch, 'batch_quantity', v_qty, 'records', v_records);
end;
$$;

revoke execute on function herd.record_milkings(uuid, bigint, date, jsonb, text) from public, anon;
grant  execute on function herd.record_milkings(uuid, bigint, date, jsonb, text) to authenticated;

alter policy products_read on public.products
  using (public.is_business_member(business_id) or public.business_has_module(business_id, 'store'::text));
