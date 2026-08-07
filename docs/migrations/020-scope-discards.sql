-- 020 — Scope discards to a business, and stop discard_inventory writing
--       rows that belong to nobody.
--
-- STATUS: RUN, 2026-08-07. Verified in a rolled-back transaction with the
-- session assuming the owner's identity, so RLS applied:
--   both existing rows backfilled; 0 discards left unscoped
--   one discard_inventory signature — no overload created
--   a new discard carries business_id 5 and stock drops by exactly 1
--   the business-scoped read policy still returns it to its owner
--   an invalid reason is still refused
-- Depends on: 010 (business scoping).
--
-- discards is the one table in the store that migration 010 missed. It has
-- no business_id, so:
--
--   * its RLS is still `is_farmer()`, which is global — a farmer in two
--     businesses sees both businesses' discards with no way to tell them
--     apart;
--   * app/src/lib/store-data.ts has to narrow them client-side by matching
--     product ids, which works only because the products themselves are
--     scoped. That is a filter the database should be doing.
--
-- And discard_inventory() inserts into discards without a business_id — the
-- same bug 017 fixed in reserve_product and 019 fixed in
-- complete_scheduled_pickup. Adding the column without fixing the function
-- would mean every new discard is created unscoped, which is how the other
-- two got into trouble.
--
-- Both existing rows can be backfilled from their product.

begin;

alter table public.discards
  add column if not exists business_id bigint references public.businesses(id);

update public.discards d
   set business_id = p.business_id
  from public.products p
 where p.id = d.product_id and d.business_id is null;

create index if not exists discards_business_idx on public.discards (business_id);

-- ── RLS: match the rest of the store ──────────────────────────────────

drop policy if exists "farmer reads discards" on public.discards;

create policy "business members read discards"
  on public.discards for select
  using (public.is_business_member(business_id));

-- No insert policy: discards are only ever written by discard_inventory(),
-- which is security definer and does its own is_farmer() check. A direct
-- insert would bypass the inventory decrement that makes a discard mean
-- anything, so there is deliberately no way to write one by hand.

-- ── the function ──────────────────────────────────────────────────────
--
-- Body identical to the live definition except for the business_id it now
-- records. Signature copied verbatim so this replaces rather than overloads.

create or replace function public.discard_inventory(
  p_product_id bigint,
  p_quantity numeric,
  p_reason text,
  p_batch_id bigint default null::bigint
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_remaining numeric; v_batch record; v_take numeric; v_name text;
        v_added_from date; v_added_to date; v_business bigint;
begin
  if not is_farmer() then raise exception 'Only a farmer can discard inventory'; end if;
  if p_reason not in ('Fed to Pigs', 'Poured out') then raise exception 'A valid reason is required'; end if;
  p_quantity := round(p_quantity, 3);
  if p_quantity is null or p_quantity <= 0 then raise exception 'Invalid quantity'; end if;

  if p_batch_id is not null then
    select * into v_batch from inventory_batches where id = p_batch_id and inventory_batches.product_id = p_product_id for update;
    if not found then raise exception 'Batch not found'; end if;
    if p_quantity > v_batch.quantity - v_batch.reserved then raise exception 'Not enough unreserved inventory in that batch'; end if;
    update inventory_batches set quantity = quantity - p_quantity where id = p_batch_id;
    v_added_from := v_batch.produced_date; v_added_to := v_batch.produced_date;
  else
    v_remaining := p_quantity;
    for v_batch in
      select * from inventory_batches where inventory_batches.product_id = p_product_id and quantity > reserved
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
    if v_remaining > 0 then raise exception 'Not enough unreserved inventory'; end if;
  end if;

  delete from inventory_batches where inventory_batches.product_id = p_product_id and quantity = 0;

  select name, business_id into v_name, v_business from products where id = p_product_id;

  insert into discards (product_id, product_name, quantity, reason, batch_produced_date, added_from, added_to, business_id)
  values (p_product_id, v_name, p_quantity, p_reason, v_added_from, v_added_from, v_added_to, v_business);
end $function$;

commit;

-- Verify after running:
--
--   select count(*) filter (where business_id is null) from public.discards;  -- 0
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'discard_inventory';          -- one row
--
-- Rollback:
--   drop policy if exists "business members read discards" on public.discards;
--   create policy "farmer reads discards" on public.discards for select using (public.is_farmer());
--   alter table public.discards drop column if exists business_id;
--   -- and restore the previous function body, which omits business_id.
