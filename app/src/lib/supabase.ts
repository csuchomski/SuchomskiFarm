import { createClient } from "@supabase/supabase-js";

/**
 * The `anon` key is meant to be public — it's what every Supabase JS client
 * ships with in its bundle, and access is governed by Row Level Security on
 * the database side, not by keeping this value secret. (The service_role
 * key is the one that must never appear here — see IMPLEMENTATION_PLAN.md.)
 */
const SUPABASE_URL = "https://qpthtykkqxpujudyieyr.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwdGh0eWtrcXhwdWp1ZHlpZXlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMDgzODEsImV4cCI6MjA5NjY4NDM4MX0.VXgzPAvIYUCae8KT4t9Xbt60SdsdC_QHwBN9RwlQQ1A";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Most of the schema this app needs (animals, lactations, treatments,
 * cost_entries, …) lives in a non-default `herd` Postgres schema rather
 * than `public`. PostgREST only serves schemas explicitly exposed in
 * Project Settings -> API -> Exposed schemas — if that doesn't include
 * `herd`, every query built with this client will 404 regardless of
 * auth/RLS correctness. */
export const herdSchema = () => supabase.schema("herd");
