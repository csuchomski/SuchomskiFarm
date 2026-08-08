-- 023 — What a customer can actually sign up for, per weekday.
--
-- STATUS: RUN, 2026-08-08. Verified as a real buyer in a rolled-back
--         transaction, so RLS applied: seven rows per product, ordered by
--         pickup date from today; milk on_hand 8 with a 14/week forecast gave
--         8, 10, 12, 14, 16 across the week and 14 on Thursday, which is the
--         5-day projection less the 4-gallon standing order already due that
--         day. A product with no stock and no history returns seven zeros.
--         One signature, no overload.
-- Depends on: 019 (schedules scoped, next_pickup_date), 008 (product types).
--
-- ── Why ───────────────────────────────────────────────────────────────
--
-- The shop's "get it every week" panel asks for a quantity in a free-text
-- box. Nothing on the customer's side knows what the farm can supply, so the
-- box will happily take 40 gallons and let the insert fail — or worse,
-- succeed, because check_schedule_capacity only guards a first pickup inside
-- the three-day hold window and waves everything later through.
--
-- To offer a quantity dropdown the shop needs a number per weekday, and it
-- cannot compute one:
--
--   * production history isn't visible to a buyer, and can't be recovered
--     from inventory_batches anyway — a depleted batch is deleted;
--   * other customers' standing orders aren't visible to a buyer either,
--     and they are exactly what eats the supply.
--
-- Both live behind RLS for good reason. This returns the one aggregate the
-- shop needs instead of opening the tables: seven rows, one per weekday, for
-- a single product.
--
-- ── The arithmetic ────────────────────────────────────────────────────
--
-- Deliberately the same shape as product_stats(), which this calls rather
-- than reimplementing:
--
--   on_hand              stock now, already net of one-off reservations
--   incoming_forecast/7  a daily rate. product_stats treats the figure as a
--                        week's production — reconstructed by adding back
--                        what was picked up and discarded, since the batches
--                        themselves are gone — and forecast_override is
--                        documented as weekly too.
--   demand               every standing order for this product whose next
--                        pickup falls on or before the day in question.
--
-- Counting only each schedule's *next* pickup is right here and only here:
-- the horizon is at most six days, and a weekly order can occur only once in
-- six days. A longer horizon would need the occurrences expanded.
--
-- This is a forecast, not a promise, and the shop says so on screen. The
-- hard limit is still check_schedule_capacity, which is unchanged.

begin;

create or replace function public.schedule_capacity(p_product_id bigint)
returns table(weekday text, pickup_date date, available numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with stats as (
    select on_hand, incoming_forecast
      from product_stats()
     where product_stats.product_id = p_product_id
  ),
  days as (
    select d as weekday,
           next_pickup_date(d, null::date, '[]'::jsonb, '[]'::jsonb) as pickup_date
      from unnest(array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']) as d
  )
  select
    days.weekday,
    days.pickup_date,
    greatest(0, round(
      coalesce(stats.on_hand, 0)
      + coalesce(stats.incoming_forecast, 0) / 7.0 * (days.pickup_date - current_date)
      - coalesce((
          select sum(s.quantity)
            from schedules s
           where s.product_id = p_product_id
             and s.cancelled_at is null
             and next_pickup_date(s.day, s.start_date, s.skipped_dates, s.fulfilled_dates)
                 <= days.pickup_date
        ), 0),
      3))
  from days cross join stats
  order by days.pickup_date
$function$;

comment on function public.schedule_capacity(bigint) is
  'Forecast quantity available for a new weekly pickup, one row per weekday. '
  'Aggregates only — it exists so the shop can offer a capped quantity '
  'without exposing production history or other customers standing orders.';

-- Buyers are the callers. It is security definer and returns nothing
-- per-customer, so this grants no more than product_stats() already does.
grant execute on function public.schedule_capacity(bigint) to authenticated;

commit;

-- ── Verify after running ──────────────────────────────────────────────
--
--   select * from public.schedule_capacity(1);
--     -- 7 rows, pickup_date ascending, starting today or later
--
--   select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'schedule_capacity';
--     -- one row; no overload
--
-- And as a buyer, with RLS applied, since that is the caller that matters:
--
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<a buyer uuid>","role":"authenticated"}';
--   select * from public.schedule_capacity(1);
--
-- Rollback:
--   drop function if exists public.schedule_capacity(bigint);
