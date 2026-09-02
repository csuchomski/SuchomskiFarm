-- 068 — the app can read the market reports
--
-- STATUS: run 2026-09-02
--
-- The `market` schema arrived with the AMS puller: `sources` (which report),
-- `pulls` (each fetch, with the raw payload), `quotes` (a row per weight class
-- per report), and the `latest_slide` view, which is the most recent report
-- from each source reshaped as weight → dollars per hundredweight. That view
-- is exactly the shape Herd → Market wants, and the page cannot see it.
--
-- ── What was actually missing ─────────────────────────────────────────────
--
-- Less than it looked. Asking PostgREST for `market.sources` as `anon` gives
--
--   401  {"code":"42501","message":"permission denied for schema market"}
--
-- rather than PGRST205 "could not find the table", which is what an unexposed
-- schema returns. So `market` is already in the project's exposed schemas —
-- what is missing is only Postgres grants. `market`'s ACL carries `usage` for
-- `authenticator` and `service_role`, and not for `authenticated`.
--
-- ── Why no RLS policy goes with this ──────────────────────────────────────
--
-- `latest_slide` is owned by `postgres` and has no `security_invoker` set, so
-- it runs with its owner's rights and the row policies on `quotes` and
-- `sources` underneath do not apply to reads through it. Granting select on
-- the view is therefore the whole of the change, and the tables stay shut:
-- `quotes`, `pulls` and `sources` remain ungranted, so nothing can read the
-- raw payloads or write anything.
--
-- **And there is no tenant dimension to enforce.** These are USDA AMS auction
-- summaries — public reports, the same figures for every farm on the system.
-- A farm_id column would be a lie about where the numbers came from, and a
-- per-farm policy would be guarding information the government publishes.
-- What the grant does is keep it behind the login, which is enough.
--
-- `authenticated` only, not `anon`. Nothing in this app is read logged out.

grant usage on schema market to authenticated;

grant select on market.latest_slide to authenticated;

-- Deliberately *not* granted: market.quotes, market.pulls, market.sources.
-- The view carries every column the page needs — including the source's label
-- and report date — so the tables have no reason to be reachable, and `pulls`
-- holds whole raw API payloads that nothing in the app should be reading.
