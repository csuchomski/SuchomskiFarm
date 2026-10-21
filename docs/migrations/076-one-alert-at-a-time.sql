-- 076 — one alert at a time
--
-- STATUS: run 2026-10-21
--
-- Asked for: the farmer marking a single store alert as seen, not only the
-- whole list.
--
-- 075 kept "seen" as one moment per person and farm — everything up to it
-- is seen. A single alert can't be cleared that way without clearing every
-- older one with it, so the ones cleared one at a time are listed by id.
-- "Mark all as seen" still moves the moment; a listed one older than the
-- moment is simply covered twice over, and costs a row.
--
-- What's unseen — newer than the moment and not listed — is worked out in
-- one view, run as the caller, so the app asks one question for the list and
-- the count alike, and RLS on the events still decides whose they are.

create table public.store_event_dismissals (
  user_id  uuid   not null references auth.users(id) on delete cascade,
  event_id bigint not null references public.store_events(id) on delete cascade,
  primary key (user_id, event_id)
);

alter table public.store_event_dismissals enable row level security;

create policy store_event_dismissals_own on public.store_event_dismissals
  for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.store_event_dismissals from anon, authenticated;

create or replace function public.mark_store_event_seen(p_event_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business bigint;
begin
  select business_id into v_business from public.store_events where id = p_event_id;
  if v_business is null or not public.is_business_owner(v_business) then
    raise exception 'Only the farm''s owner can clear the store''s alerts.';
  end if;
  insert into public.store_event_dismissals (user_id, event_id)
  values (auth.uid(), p_event_id)
  on conflict do nothing;
end;
$$;

revoke execute on function public.mark_store_event_seen(bigint) from public, anon;
grant  execute on function public.mark_store_event_seen(bigint) to authenticated;

create view public.store_events_unseen
with (security_invoker = true) as
select e.*
  from public.store_events e
 where not exists (
         select 1 from public.store_event_reads r
          where r.user_id = auth.uid() and r.business_id = e.business_id and e.at <= r.seen_through)
   and not exists (
         select 1 from public.store_event_dismissals d
          where d.user_id = auth.uid() and d.event_id = e.id);

revoke all on public.store_events_unseen from anon;
grant select on public.store_events_unseen to authenticated;
