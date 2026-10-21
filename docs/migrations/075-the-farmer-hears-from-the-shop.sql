-- 075 — the farmer hears from the shop
--
-- STATUS: run 2026-10-21
--
-- Asked for: an alert to the farmer when a customer schedules an order in
-- the farm store or picks up product.
--
-- Nothing on file says who did a thing. An order reserved by the customer
-- and one the farmer reserved on their behalf are the same row; a pickup the
-- customer confirmed at the gate and one the farmer ticked off on the Orders
-- page set the same column. An alert about every row would mostly be the
-- farmer being told about their own clicks.
--
-- So the database notes the moment itself, and who it was, as it happens:
--
--   reserved   a customer reserved an order               (orders insert)
--   scheduled  a customer started a weekly pickup         (schedules insert)
--   picked_up  a customer confirmed they collected — a one-off order
--              (orders update) or a week of a standing order, which
--              complete_scheduled_pickup writes as a new completed order
--              (orders insert)
--
-- Only when the person acting is the customer on the row. auth.uid() is the
-- caller even inside the security-definer functions the shop goes through,
-- so a customer collecting through complete_pickup is recorded and a farmer
-- completing the same order is not.
--
-- The events are the owner's to read, like the rest of the store since 071.
-- Nothing can write them but the trigger. "Seen" is kept per person and per
-- farm, so marking them read on the phone clears them on the desktop too.
--
-- Nothing is back-filled: the old rows cannot say who acted, and a first
-- visit opening on two years of "new" activity would be noise.

create table public.store_events (
  id          bigint generated always as identity primary key,
  business_id bigint not null references public.businesses(id) on delete cascade,
  kind        text   not null check (kind in ('reserved', 'scheduled', 'picked_up')),
  customer_id uuid,
  product_id  bigint,
  order_id    bigint,
  schedule_id bigint,
  quantity    numeric,
  -- the weekday of a weekly pickup; null otherwise
  weekday     text,
  at          timestamptz not null default now()
);

create index store_events_business_at on public.store_events (business_id, at desc);

alter table public.store_events enable row level security;

create policy store_events_owner_read on public.store_events
  for select to authenticated
  using (public.is_business_owner(business_id));

revoke insert, update, delete, truncate on public.store_events from anon, authenticated;

create table public.store_event_reads (
  user_id      uuid   not null references auth.users(id) on delete cascade,
  business_id  bigint not null references public.businesses(id) on delete cascade,
  seen_through timestamptz not null,
  primary key (user_id, business_id)
);

alter table public.store_event_reads enable row level security;

create policy store_event_reads_own on public.store_event_reads
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.store_event_reads from anon, authenticated;

create or replace function public.mark_store_events_seen(p_business_id bigint, p_through timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_business_id is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the farm''s owner can clear the store''s alerts.';
  end if;
  insert into public.store_event_reads (user_id, business_id, seen_through)
  values (auth.uid(), p_business_id, least(coalesce(p_through, now()), now()))
  on conflict (user_id, business_id)
  do update set seen_through = greatest(public.store_event_reads.seen_through, excluded.seen_through);
end;
$$;

revoke execute on function public.mark_store_events_seen(bigint, timestamptz) from public, anon;
grant  execute on function public.mark_store_events_seen(bigint, timestamptz) to authenticated;

create or replace function public.record_store_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  -- Only the customer's own actions. The farmer's are already known to them.
  if v_actor is null or new.customer_id is null or new.customer_id <> v_actor or new.business_id is null then
    return new;
  end if;

  if tg_table_name = 'schedules' then
    if tg_op = 'INSERT' then
      insert into public.store_events (business_id, kind, customer_id, product_id, schedule_id, quantity, weekday)
      values (new.business_id, 'scheduled', new.customer_id, new.product_id, new.id, new.quantity, new.day);
    end if;
    return new;
  end if;

  -- orders
  if tg_op = 'INSERT' then
    if new.picked_up_date is not null then
      -- a week of a standing order, collected
      insert into public.store_events (business_id, kind, customer_id, product_id, order_id, schedule_id, quantity)
      values (new.business_id, 'picked_up', new.customer_id, new.product_id, new.id, new.schedule_id, new.quantity);
    elsif new.status = 'reserved' then
      insert into public.store_events (business_id, kind, customer_id, product_id, order_id, quantity)
      values (new.business_id, 'reserved', new.customer_id, new.product_id, new.id, new.quantity);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.picked_up_date is null and new.picked_up_date is not null then
      insert into public.store_events (business_id, kind, customer_id, product_id, order_id, quantity)
      values (new.business_id, 'picked_up', new.customer_id, new.product_id, new.id, new.quantity);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.record_store_event() from public, anon, authenticated;

create trigger trg_store_event_orders
  after insert or update of picked_up_date on public.orders
  for each row execute function public.record_store_event();

create trigger trg_store_event_schedules
  after insert on public.schedules
  for each row execute function public.record_store_event();
