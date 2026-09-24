-- 071 — the books and the shop are the owner's
--
-- STATUS: run 2026-09-24
--
-- Asked for: a login for a farm helper while the owner is away. The Helper
-- role existed, but it did not mean anything outside the herd:
--
--   * Every ledger, product, order, standing order, inventory and discard
--     policy asked only "is this person a member of the business?" — any
--     role, Viewer included. A helper could read the books, post to them,
--     and delete from them.
--
--   * The store and ledger functions asked "is this person a farmer?" —
--     profiles.role, which says nothing about *which* farm. Anybody who
--     signs up and starts a farm becomes a farmer, and could then cancel,
--     complete, discard, rename and delete against every other farm on the
--     instance. That was already true before any helper existed.
--
--   * A member of a farm business could promote their own profile to
--     'farmer' (prevent_role_self_change let any member do it), which put
--     a helper one update away from the paragraph above.
--
-- After this, the books and the shop answer to one question: does this
-- person own *this* business? Helpers, vets and viewers keep everything in
-- the herd schema exactly as before — can_write_farm is untouched — and a
-- shop customer keeps their own orders and standing orders.
--
-- Not covered here, and said plainly: per-animal money that lives in the
-- herd schema (purchase price, cost and revenue entries, sale details,
-- valuations) is still visible to anyone who can see the herd, because a
-- helper recording a treatment has to write some of those rows.
--
-- ── How the functions are changed ─────────────────────────────────────────
--
-- Each function is patched in place from its own live definition: find one
-- exact snippet, check it occurs the expected number of times, swap it,
-- re-create. Nothing else in the body can move, and if the live text is not
-- what this file expects the whole migration stops rather than guess.

create or replace function public.is_business_owner(bid bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.business_members m
     where m.business_id = bid and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

revoke execute on function public.is_business_owner(bigint) from public, anon;
grant execute on function public.is_business_owner(bigint) to authenticated;

create function pg_temp.patch(p_fn regprocedure, p_old text, p_new text, p_times int default 1)
returns void
language plpgsql
as $$
declare
  v_def text := pg_get_functiondef(p_fn);
  v_n   int;
begin
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> p_times then
    raise exception '%: expected % of «%», found %', p_fn, p_times, p_old, v_n;
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

-- ── Policies ──────────────────────────────────────────────────────────────

alter policy ledger_accounts_read  on public.ledger_accounts
  using (public.is_business_owner(business_id));
alter policy ledger_accounts_write on public.ledger_accounts
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));

alter policy ledger_assets_read  on public.ledger_assets
  using (public.is_business_owner(business_id));
alter policy ledger_assets_write on public.ledger_assets
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));

alter policy ledger_transactions_read  on public.ledger_transactions
  using (public.is_business_owner(business_id));
alter policy ledger_transactions_write on public.ledger_transactions
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));

-- A farm with the store switched on still shows its products and stock to
-- everyone, as a shop window does. Only managing them is the owner's.
alter policy "farmer manages products" on public.products
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));
alter policy products_read on public.products
  using (public.is_business_owner(business_id) or public.business_has_module(business_id, 'store'::text));

alter policy "farmer manages batches" on public.inventory_batches
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));
alter policy inventory_batches_read on public.inventory_batches
  using (public.is_business_owner(business_id) or public.business_has_module(business_id, 'store'::text));

alter policy "business members read discards" on public.discards
  using (public.is_business_owner(business_id));

alter policy "read own orders or farmer reads all" on public.orders
  using ((auth.uid() = customer_id) or public.is_business_owner(business_id));
alter policy "insert own orders or farmer" on public.orders
  with check ((auth.uid() = customer_id) or public.is_business_owner(business_id));
alter policy "farmer updates orders" on public.orders
  using (public.is_business_owner(business_id)) with check (public.is_business_owner(business_id));

alter policy "read own schedules or farmer reads business" on public.schedules
  using ((auth.uid() = customer_id) or public.is_business_owner(business_id));
alter policy "insert own schedule or farmer" on public.schedules
  with check ((auth.uid() = customer_id) or public.is_business_owner(business_id));
alter policy "update own schedule or farmer" on public.schedules
  using ((auth.uid() = customer_id) or public.is_business_owner(business_id))
  with check ((auth.uid() = customer_id) or public.is_business_owner(business_id));

alter policy business_customers_select on public.business_customers
  using (business_id in (select public.current_user_owned_business_ids()));
alter policy business_customers_write on public.business_customers
  using (business_id in (select public.current_user_owned_business_ids()))
  with check (business_id in (select public.current_user_owned_business_ids()));

-- ── Store functions: "a farmer" becomes "this business's owner" ───────────
--
-- The customer clause is also made null-safe: `customer_id <> auth.uid()`
-- is null, not true, when either side is null, and `null and x` never
-- raises — so an order with no customer could be cancelled by anyone.

select pg_temp.patch('public.cancel_order(bigint)',
  $o$if v_order.customer_id <> auth.uid() and not is_farmer() then raise exception 'Not allowed'; end if;$o$,
  $n$if not coalesce(v_order.customer_id = auth.uid(), false) and not public.is_business_owner(v_order.business_id) then raise exception 'Not allowed'; end if;$n$);

select pg_temp.patch('public.complete_pickup(bigint, numeric, text, numeric)',
  $o$if v_order.customer_id <> auth.uid() and not is_farmer() then raise exception 'Not allowed'; end if;$o$,
  $n$if not coalesce(v_order.customer_id = auth.uid(), false) and not public.is_business_owner(v_order.business_id) then raise exception 'Not allowed'; end if;$n$);

select pg_temp.patch('public.complete_scheduled_pickup(bigint, numeric, text, numeric)',
  $o$if v_sched.customer_id <> auth.uid() and not is_farmer() then raise exception 'Not allowed'; end if;$o$,
  $n$if not coalesce(v_sched.customer_id = auth.uid(), false) and not public.is_business_owner(v_sched.business_id) then raise exception 'Not allowed'; end if;$n$);
select pg_temp.patch('public.complete_scheduled_pickup(bigint, numeric, text, numeric)',
  $o$if v_qty > v_sched.quantity and not is_farmer() then$o$,
  $n$if v_qty > v_sched.quantity and not public.is_business_owner(v_sched.business_id) then$n$);

-- reserve_product checked "reserving for somebody else" before it knew
-- whose product it was. The check moves below the product lookup.
select pg_temp.patch('public.reserve_product(bigint, numeric, uuid)',
  E'  if p_customer is not null and p_customer <> auth.uid() and not is_farmer() then\n    raise exception ''Only a farmer can reserve for another user'';\n  end if;\n\n',
  '');
select pg_temp.patch('public.reserve_product(bigint, numeric, uuid)',
  E'  if not found then raise exception ''Product not found''; end if;\n',
  E'  if not found then raise exception ''Product not found''; end if;\n'
  || E'  if p_customer is not null and p_customer is distinct from auth.uid()\n'
  || E'     and not public.is_business_owner(v_business) then\n'
  || E'    raise exception ''Only the farm''''s owner can reserve for somebody else'';\n'
  || E'  end if;\n');
select pg_temp.patch('public.reserve_product(bigint, numeric, uuid)',
  'if not is_farmer() then',
  'if not public.is_business_owner(v_business) then');

select pg_temp.patch('public.discard_inventory(bigint, numeric, text, bigint)',
  $o$if not is_farmer() then raise exception 'Only a farmer can discard inventory'; end if;$o$,
  $n$if not public.is_business_owner((select business_id from public.products where id = p_product_id)) then raise exception 'Only the farm''s owner can discard inventory'; end if;$n$);

select pg_temp.patch('herd.record_production(bigint, date, jsonb, boolean, numeric)',
  E'  if not public.is_farmer() then\n    raise exception ''Only a farmer can add inventory'';\n  end if;',
  E'  if not public.is_business_owner((select business_id from public.products where id = p_product_id)) then\n    raise exception ''Only the farm''''s owner can add inventory'';\n  end if;');

-- Before a standing order is saved: the owner may book past what is on
-- hand; a customer may not. "The owner" is now the owner of this one.
select pg_temp.patch('public.check_schedule_capacity()',
  'if is_farmer() then return new; end if;',
  'if public.is_business_owner(new.business_id) then return new; end if;');

-- ── Ledger accounts ───────────────────────────────────────────────────────

select pg_temp.patch('public.delete_ledger_account(bigint, text)',
  E'  if not is_farmer() then\n    raise exception ''Only a farmer can remove an account'';\n  end if;',
  E'  if not public.is_business_owner((select business_id from public.ledger_accounts where id = p_id)) then\n    raise exception ''Only the farm''''s owner can remove an account'';\n  end if;');
-- Entries could be moved onto another farm's account, since names are
-- unique across the whole instance. Only this business's accounts now.
select pg_temp.patch('public.delete_ledger_account(bigint, text)',
  'if not exists (select 1 from ledger_accounts where name = v_target) then',
  'if not exists (select 1 from ledger_accounts where name = v_target'
  || ' and business_id = (select business_id from ledger_accounts where id = p_id)) then');

select pg_temp.patch('public.rename_ledger_account(bigint, text)',
  E'  if not is_farmer() then\n    raise exception ''Only a farmer can change an account'';\n  end if;',
  E'  if not public.is_business_owner((select business_id from public.ledger_accounts where id = p_id)) then\n    raise exception ''Only the farm''''s owner can change an account'';\n  end if;');

-- ── Customers ─────────────────────────────────────────────────────────────
--
-- Customer names, emails and phone numbers are the shop's, so they follow
-- it. current_user_customer_ids also feeds the profiles read policy: a
-- helper stops seeing the customer list, and still sees their colleagues.

select pg_temp.patch('public.add_customer(bigint, text, text, text, text)',
  'or p_business_id not in (select public.current_user_business_ids()) then',
  'or not public.is_business_owner(p_business_id) then');
select pg_temp.patch('public.delete_customer(uuid, bigint)',
  'or p_business_id not in (select public.current_user_business_ids()) then',
  'or not public.is_business_owner(p_business_id) then');
select pg_temp.patch('public.customer_ids_of(bigint)',
  'p_business_id in (select public.current_user_business_ids())',
  'public.is_business_owner(p_business_id)', 3);
select pg_temp.patch('public.current_user_customer_ids()',
  'in (select public.current_user_business_ids())',
  'in (select public.current_user_owned_business_ids())', 3);

-- ── Nobody but an owner turns themselves into a farmer ────────────────────

select pg_temp.patch('public.prevent_role_self_change()',
  $o$where m.user_id = new.id and b.type = 'farm'$o$,
  $n$where m.user_id = new.id and m.role = 'owner' and b.type = 'farm'$n$);
