-- 021 — herd.record_production must scope the batches it creates, and an
--       audit so the next one of these is found by a query rather than by
--       someone reading function bodies.
--
-- STATUS: not yet run.
-- Depends on: 010 (business scoping).
--
-- ── The fourth ────────────────────────────────────────────────────────
--
-- This is the same bug as 017 (reserve_product), 019
-- (complete_scheduled_pickup) and 020 (discard_inventory), found this time
-- by the audit query below rather than by reading code — which is the point
-- of writing the audit down.
--
-- herd.record_production has three `insert into public.inventory_batches`
-- statements and none of them set business_id. Since 010 the select policy
-- on inventory_batches is is_business_member(business_id), and
-- is_business_member(null) is false, so every batch this function creates is
-- invisible to the farmer who created it: stock on the books that nobody can
-- see, sell or reserve against.
--
-- It is currently dormant — the app records milkings through
-- app/src/lib/milkings.ts, which inserts batches directly and does pass
-- business_id. But record_production is a security-definer function with
-- EXECUTE available, so it is one rpc() call away from being live, and the
-- failure is silent when it happens.
--
-- business_id comes from the product, the same source 017, 019 and 020 used.

begin;

create or replace function herd.record_production(
  p_product_id bigint,
  p_produced_date date,
  p_entries jsonb default '[]'::jsonb,
  p_pooled boolean default true,
  p_quantity numeric default null::numeric
)
returns bigint
language plpgsql
security definer
set search_path to 'herd', 'public'
as $function$
declare
  v_farm_id   uuid;
  v_total     numeric := 0;
  v_entry     jsonb;
  v_animal    uuid;
  v_qty       numeric;
  v_batch_id  bigint;
  v_name      text;
  v_unit      text;
  v_count     integer := 0;
  v_business  bigint;
begin
  if not public.is_farmer() then
    raise exception 'Only a farmer can add inventory';
  end if;

  -- business_id read alongside the fields this already fetched, so scoping
  -- the batches below costs nothing extra.
  select name, unit, business_id into v_name, v_unit, v_business
    from public.products where id = p_product_id;
  if v_name is null then raise exception 'Product not found'; end if;

  -- Validate every entry before writing anything, so a bad row cannot leave
  -- half the day's production recorded.
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    v_animal := (v_entry ->> 'animal_id')::uuid;
    v_qty    := round((v_entry ->> 'quantity')::numeric, 3);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Every animal needs a quantity greater than zero';
    end if;
    select farm_id into v_farm_id from herd.animals where id = v_animal;
    if v_farm_id is null then
      raise exception 'Animal not found';
    end if;
    if not herd.can_write_farm(v_farm_id) then
      raise exception 'Not allowed to record production for that animal';
    end if;
    v_total := v_total + v_qty;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    v_total := round(coalesce(p_quantity, 0), 3);
    if v_total <= 0 then raise exception 'Quantity is required'; end if;
    insert into public.inventory_batches (product_id, produced_date, quantity, business_id)
    values (p_product_id, p_produced_date, v_total, v_business)
    returning id into v_batch_id;
    return v_batch_id;
  end if;

  -- A stated total that disagrees with the per-animal rows is a counting
  -- mistake, and silently trusting either one would hide it.
  if p_quantity is not null and round(p_quantity, 3) <> v_total then
    raise exception 'The per-animal amounts come to % but the total says %',
      v_total, round(p_quantity, 3);
  end if;

  if p_pooled then
    insert into public.inventory_batches (product_id, produced_date, quantity, business_id)
    values (p_product_id, p_produced_date, v_total, v_business)
    returning id into v_batch_id;

    for v_entry in select * from jsonb_array_elements(p_entries) loop
      insert into herd.production_records
        (farm_id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id)
      select a.farm_id, a.id, p_product_id, v_name,
             round((v_entry ->> 'quantity')::numeric, 3), coalesce(v_unit, ''),
             p_produced_date, v_batch_id
      from herd.animals a where a.id = (v_entry ->> 'animal_id')::uuid;
    end loop;
  else
    for v_entry in select * from jsonb_array_elements(p_entries) loop
      v_animal := (v_entry ->> 'animal_id')::uuid;
      v_qty    := round((v_entry ->> 'quantity')::numeric, 3);

      insert into public.inventory_batches
        (product_id, produced_date, quantity, herd_animal_id, business_id)
      values (p_product_id, p_produced_date, v_qty, v_animal, v_business)
      returning id into v_batch_id;

      insert into herd.production_records
        (farm_id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id)
      select a.farm_id, a.id, p_product_id, v_name, v_qty, coalesce(v_unit, ''),
             p_produced_date, v_batch_id
      from herd.animals a where a.id = v_animal;
    end loop;
  end if;

  return v_batch_id;
end;
$function$;

commit;

-- ── The audit ─────────────────────────────────────────────────────────
--
-- Run this after any migration that adds a business_id column or changes a
-- policy to read one. It returns a row for every security-definer function
-- that inserts into a business-scoped table without naming business_id in
-- the insert's column list — which is the exact shape of 017, 019, 020 and
-- this one.
--
-- It should return no rows. Each of the four was found only because somebody
-- happened to read the function; this is what finds the fifth.
--
-- Also saved at docs/migrations/audit-business-scoping.sql so it can be run
-- without opening this file.
--
--   with scoped as (
--     select table_schema, table_name
--       from information_schema.columns
--      where column_name = 'business_id'
--        and table_schema in ('public', 'herd')
--   ),
--   fns as (
--     select n.nspname as schema, p.proname as fn,
--            p.oid::regprocedure::text as signature, p.prosrc as src
--       from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname in ('public', 'herd')
--        and p.prosecdef
--   )
--   select f.signature, s.table_name as inserts_into,
--          (regexp_match(f.src, 'insert\s+into\s+(?:\w+\.)?' || s.table_name || '\s*\(([^)]*)\)', 'i'))[1] as columns
--     from fns f
--     join scoped s
--       on f.src ~* ('insert\s+into\s+(?:\w+\.)?' || s.table_name || '\s*\(')
--    where (regexp_match(f.src, 'insert\s+into\s+(?:\w+\.)?' || s.table_name || '\s*\(([^)]*)\)', 'i'))[1] !~* 'business_id'
--    order by 1, 2;
--
-- Rollback: restore the previous body, which omits business_id from all
-- three inventory_batches inserts. Doing so reintroduces invisible stock.
