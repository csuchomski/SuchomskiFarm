-- 078 — who has the jars
--
-- STATUS: run 2026-11-12
--
-- Asked for: keeping track of the farm's milk jars. Milk goes out in the
-- farm's jars on the understanding they come back next visit; some don't,
-- and nothing said who had them. Nobody is charged for a jar — this is a
-- count, not a deposit.
--
-- The rule given: one jar for every half gallon of milk a customer takes
-- home. So a product says how many jars one of its units goes out in
-- (products.jars_per_unit — 2 for milk sold by the gallon, null for anything
-- not sold in jars), and every pickup of it puts that many jars against the
-- customer.
--
--   jar_ledger   one line per thing that changed a customer's count:
--                  pickup      +n, written by a trigger when an order is
--                              collected — whoever marks it collected
--                  return      -n, said by the customer in the shop or
--                              entered by the farmer
--                  correction  ±n, the farmer setting the count to what is
--                              actually true (a starting count, a miscount)
--   jar_balances what each customer has now: the sum of their lines
--
-- A customer who brings their own jars says so on their weekly pickup
-- (schedules.own_jars), and its pickups then put nothing against them. The
-- flag is read at the moment of each pickup, so changing it later doesn't
-- rewrite what has already gone out.
--
-- A customer reads their own lines and the owner reads the farm's; nobody
-- writes the table directly. Nothing is back-filled: years of pickups with
-- no returns on record would open every customer on a count in the hundreds.
-- Counting starts with this migration, and the farmer can set a starting
-- count for anyone who is holding jars today.

alter table public.products
  add column jars_per_unit numeric check (jars_per_unit is null or jars_per_unit > 0);

-- Milk by the gallon: a jar per half gallon.
update public.products
   set jars_per_unit = 2
 where type_code = 'milk' and lower(unit) = 'gallon' and lower(name) like '%milk%';

alter table public.schedules
  add column own_jars boolean not null default false;

create table public.jar_ledger (
  id          bigint generated always as identity primary key,
  business_id bigint  not null references public.businesses(id) on delete cascade,
  customer_id uuid    not null references public.profiles(id) on delete cascade,
  -- jars taken (+) or brought back (-)
  change      integer not null check (change <> 0),
  kind        text    not null check (kind in ('pickup', 'return', 'correction')),
  order_id    bigint  references public.orders(id) on delete set null,
  -- who wrote the line: the customer, the farmer, or whoever collected
  entered_by  uuid,
  at          timestamptz not null default now(),
  check (kind <> 'pickup' or change > 0),
  check (kind <> 'return' or change < 0)
);

create index jar_ledger_customer on public.jar_ledger (business_id, customer_id, at desc);
-- An order's jars go out once, however many times it is touched.
create unique index jar_ledger_one_per_order on public.jar_ledger (order_id) where kind = 'pickup';

alter table public.jar_ledger enable row level security;

create policy jar_ledger_read on public.jar_ledger
  for select to authenticated
  using (customer_id = auth.uid() or public.is_business_owner(business_id));

revoke insert, update, delete, truncate on public.jar_ledger from anon, authenticated;
revoke all on public.jar_ledger from anon;

create view public.jar_balances
with (security_invoker = true) as
select business_id, customer_id, sum(change)::integer as jars
  from public.jar_ledger
 group by business_id, customer_id;

revoke all on public.jar_balances from anon;
grant select on public.jar_balances to authenticated;

-- What a customer has of this farm's jars right now. Internal: the functions
-- below have already decided the caller may know.
create or replace function public.jars_held(p_business_id bigint, p_customer_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(change), 0)::integer
    from public.jar_ledger
   where business_id = p_business_id and customer_id = p_customer_id;
$$;

revoke execute on function public.jars_held(bigint, uuid) from public, anon, authenticated;

-- A pickup puts jars against the customer. On the order, so every way of
-- collecting — the customer in the shop, the farmer on Orders or Schedules —
-- is covered by the one rule.
create or replace function public.record_jars_out()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_per      numeric;
  v_business bigint;
  v_jars     integer;
begin
  if new.picked_up_date is null or (tg_op = 'UPDATE' and old.picked_up_date is not null) then
    return new;
  end if;

  select jars_per_unit, business_id into v_per, v_business from public.products where id = new.product_id;
  if v_per is null then
    return new;
  end if;

  -- Their own jars: nothing of the farm's went out.
  if new.schedule_id is not null
     and exists (select 1 from public.schedules where id = new.schedule_id and own_jars) then
    return new;
  end if;

  v_jars := ceil(new.quantity * v_per);
  if v_jars > 0 then
    insert into public.jar_ledger (business_id, customer_id, change, kind, order_id, entered_by)
    values (coalesce(new.business_id, v_business), new.customer_id, v_jars, 'pickup', new.id, auth.uid())
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.record_jars_out() from public, anon, authenticated;

create trigger trg_jars_out
  after insert or update of picked_up_date on public.orders
  for each row execute function public.record_jars_out();

-- The customer, in the shop: "I'm bringing back this many."
create or replace function public.return_jars(p_business_id bigint, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_held integer;
begin
  if v_me is null then
    raise exception 'Sign in to return jars.';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'How many jars are you returning?';
  end if;
  v_held := public.jars_held(p_business_id, v_me);
  if p_quantity > v_held then
    raise exception 'You have % of our jars on record, so % is more than there is to return.', v_held, p_quantity;
  end if;
  insert into public.jar_ledger (business_id, customer_id, change, kind, entered_by)
  values (p_business_id, v_me, -p_quantity, 'return', v_me);
  return v_held - p_quantity;
end;
$$;

revoke execute on function public.return_jars(bigint, integer) from public, anon;
grant  execute on function public.return_jars(bigint, integer) to authenticated;

-- The farmer, for jars that came back without the customer saying so.
create or replace function public.record_jar_return(p_business_id bigint, p_customer_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_held integer;
begin
  if p_business_id is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the farm''s owner can record jars.';
  end if;
  if not exists (select 1 from public.customer_ids_of(p_business_id) c where c = p_customer_id) then
    raise exception 'That is not one of this farm''s customers.';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'How many jars came back?';
  end if;
  v_held := public.jars_held(p_business_id, p_customer_id);
  if p_quantity > v_held then
    raise exception 'They have % of your jars on record. If that number is wrong, set the count instead.', v_held;
  end if;
  insert into public.jar_ledger (business_id, customer_id, change, kind, entered_by)
  values (p_business_id, p_customer_id, -p_quantity, 'return', auth.uid());
  return v_held - p_quantity;
end;
$$;

revoke execute on function public.record_jar_return(bigint, uuid, integer) from public, anon;
grant  execute on function public.record_jar_return(bigint, uuid, integer) to authenticated;

-- The farmer, putting the count right: a starting count for someone already
-- holding jars, or a miscount.
create or replace function public.set_jar_count(p_business_id bigint, p_customer_id uuid, p_count integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_held integer;
begin
  if p_business_id is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the farm''s owner can record jars.';
  end if;
  if not exists (select 1 from public.customer_ids_of(p_business_id) c where c = p_customer_id) then
    raise exception 'That is not one of this farm''s customers.';
  end if;
  if p_count is null or p_count < 0 or p_count > 999 then
    raise exception 'The count has to be a whole number, zero or more.';
  end if;
  v_held := public.jars_held(p_business_id, p_customer_id);
  if p_count <> v_held then
    insert into public.jar_ledger (business_id, customer_id, change, kind, entered_by)
    values (p_business_id, p_customer_id, p_count - v_held, 'correction', auth.uid());
  end if;
  return p_count;
end;
$$;

revoke execute on function public.set_jar_count(bigint, uuid, integer) from public, anon;
grant  execute on function public.set_jar_count(bigint, uuid, integer) to authenticated;
