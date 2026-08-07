import { Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { SignIn } from "./SignIn";

/**
 * Gates the ops routes (Today, Animals, Store, Books) behind real sign-in.
 * The customer store (/shop) deliberately sits outside this — a customer
 * isn't a farm_members row, and the RLS policies we've seen don't have a
 * path for one yet. See IMPLEMENTATION_PLAN.md.
 *
 * Signing in lands you straight on the app. There used to be a FarmCheck
 * screen in between — a connection test that counted rows across 22 tables
 * and made you click "Continue" — which was scaffolding for wiring the app
 * up to Supabase, not something to walk past every morning. The states it
 * reported still have homes: a workspace that fails to load says so on the
 * home screen, and so does one with no business attached.
 */
export function RequireAuth() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p className="eyebrow">Loading…</p>
      </div>
    );
  }

  if (!session) return <SignIn />;

  return <Outlet />;
}
