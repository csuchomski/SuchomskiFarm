-- 077 — seen, and back again
--
-- STATUS: run 2026-10-21
--
-- Asked for: reviewing store alerts already marked seen, and making one
-- unseen again.
--
-- Until now "Mark all as seen" kept a single moment (store_event_reads):
-- everything up to it was seen. One alert under that moment can't be made
-- unseen without unseeing every older one with it. So "seen" becomes a mark
-- per person and per alert, with when it was made:
--
--   store_event_marks   076's store_event_dismissals, renamed, with seen_at.
--                       seen_at null means "made unseen again"; the row is
--                       kept so nothing here ever needs removing.
--
-- The moments already kept are carried over as marks, dated the moment
-- itself, so nothing anyone has cleared comes back. store_event_reads is then
-- no longer read; it is left in place rather than dropped.
--
--   store_events_unseen  as before — what the list and the menu's count show
--   store_events_seen    what's been marked seen, with when, for the review

alter table public.store_event_dismissals rename to store_event_marks;
alter table public.store_event_marks add column seen_at timestamptz default now();

alter policy store_event_dismissals_own on public.store_event_marks rename to store_event_marks_own;

insert into public.store_event_marks (user_id, event_id, seen_at)
select r.user_id, e.id, r.seen_through
  from public.store_event_reads r
  join public.store_events e on e.business_id = r.business_id and e.at <= r.seen_through
on conflict (user_id, event_id) do nothing;

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
  insert into public.store_event_marks (user_id, event_id, seen_at)
  values (auth.uid(), p_event_id, now())
  on conflict (user_id, event_id) do update set seen_at = now();
end;
$$;

create or replace function public.mark_store_event_unseen(p_event_id bigint)
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
    raise exception 'Only the farm''s owner can change the store''s alerts.';
  end if;
  update public.store_event_marks
     set seen_at = null
   where user_id = auth.uid() and event_id = p_event_id;
end;
$$;

revoke execute on function public.mark_store_event_unseen(bigint) from public, anon;
grant  execute on function public.mark_store_event_unseen(bigint) to authenticated;

-- Every alert on the farm up to the moment, marked seen now — including one
-- that had been made unseen again, since it was on the list being cleared.
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
  insert into public.store_event_marks (user_id, event_id, seen_at)
  select auth.uid(), e.id, now()
    from public.store_events e
   where e.business_id = p_business_id
     and e.at <= least(coalesce(p_through, now()), now())
  on conflict (user_id, event_id)
  do update set seen_at = coalesce(public.store_event_marks.seen_at, excluded.seen_at);
end;
$$;

create or replace view public.store_events_unseen
with (security_invoker = true) as
select e.*
  from public.store_events e
 where not exists (
         select 1 from public.store_event_marks m
          where m.user_id = auth.uid() and m.event_id = e.id and m.seen_at is not null);

create view public.store_events_seen
with (security_invoker = true) as
select e.*, m.seen_at
  from public.store_events e
  join public.store_event_marks m
    on m.event_id = e.id and m.user_id = auth.uid() and m.seen_at is not null;

revoke all on public.store_events_seen from anon;
grant select on public.store_events_seen to authenticated;
