-- 069 — the reports have a history, and a commodity
--
-- STATUS: not yet run
--
-- Two things the app cannot see about the market reports.
--
-- ── One: there is no way to read anything but the newest report ───────────
--
-- `market.latest_slide` is `distinct on (source_id) … order by report_date
-- desc`: exactly one report per source, by construction. Everything the
-- Classes tab wants — a class's price over time, a rolling average through
-- it, the same weight priced week after week — needs the reports the view
-- throws away.
--
-- `market.quotes` holds them all and stays ungranted, for the reason 068
-- gave: `pulls` and the raw payloads are not the app's business, and a table
-- grant is a standing invitation to widen. So this adds a second view, the
-- same shape as the first without the `distinct on`.
--
-- ── Two: a "Steers" is two completely different animals ───────────────────
--
-- The AMS rows carry a `commodity` — "Feeder Cattle" or "Slaughter Cattle" —
-- and neither `quotes` nor `latest_slide` projects it. On the 2026-08-24
-- Iowa report that leaves two series both labelled Steers:
--
--   Feeder Cattle    · Steers · grade 1     472–1165 lb   $250–456/cwt
--   Slaughter Cattle · Steers               1102–1774 lb  $186–230/cwt
--
-- They are told apart today only by a grade of "1" against none, which is
-- not something a label says out loud. A farmer pricing a draft of feeders
-- who picks the wrong one is out better than a hundred dollars a
-- hundredweight and has nothing on screen to catch it.
--
-- `sources.commodity` is no help: it says "Feeder Cattle" for both sources,
-- while the rows underneath are more than half slaughter cattle. The per-row
-- value in `raw` is the true one, so that is what both views now project,
-- falling back to the source's only when a row has none.
--
-- Appending a column is all `create or replace view` allows, and all this
-- needs — `latest_slide`'s existing columns keep their names, types and
-- order, so nothing already reading it notices.

create or replace view market.latest_slide as
with latest as (
  select distinct on (source_id) source_id, report_date
    from market.quotes
   order by source_id, report_date desc
)
select q.source_id,
       s.label,
       s.is_local,
       q.report_date,
       q.class,
       q.grade,
       coalesce(q.avg_wt, (q.wt_low + q.wt_high) / 2.0) as wt,
       q.avg_price as cwt,
       q.head,
       coalesce(q.raw ->> 'commodity', s.commodity) as commodity
  from market.quotes q
  join latest l on l.source_id = q.source_id and l.report_date = q.report_date
  join market.sources s on s.id = q.source_id
 where q.avg_price is not null
 order by q.class, coalesce(q.avg_wt, (q.wt_low + q.wt_high) / 2.0);

-- Every report, not just the newest. A row is one weight rung of one class on
-- one report date — the grain the quotes table already keeps.
create or replace view market.quote_history as
select q.report_date,
       q.source_id,
       s.label,
       s.is_local,
       coalesce(q.raw ->> 'commodity', s.commodity) as commodity,
       q.class,
       q.grade,
       coalesce(q.avg_wt, (q.wt_low + q.wt_high) / 2.0) as wt,
       q.avg_price as cwt,
       q.head
  from market.quotes q
  join market.sources s on s.id = q.source_id
 where q.avg_price is not null
   and coalesce(q.avg_wt, (q.wt_low + q.wt_high) / 2.0) is not null
 order by q.report_date, q.class, coalesce(q.avg_wt, (q.wt_low + q.wt_high) / 2.0);

grant select on market.quote_history to authenticated;

-- Same reasoning as 068, unchanged: owned by `postgres` with no
-- `security_invoker`, so it reads with its owner's rights and the tables
-- underneath stay unreachable. These are USDA AMS auction summaries — public
-- reports, identical for every farm on the system — so there is no tenant
-- dimension to enforce and no RLS policy to write. The grant keeps them
-- behind the login, which is what it is for.
--
-- Still deliberately not granted: market.quotes, market.pulls, market.sources.
