import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { SignIn } from "./SignIn";
import { FarmCheck } from "./FarmCheck";

/**
 * Gates the ops routes (Today, Animals, Store, Books) behind real sign-in.
 * The customer store (/shop) deliberately sits outside this — a customer
 * isn't a farm_members row, and the RLS policies we've seen don't have a
 * path for one yet. See IMPLEMENTATION_PLAN.md.
 */
export function RequireAuth() {
  const { session, loading } = useAuth();
  const [checked, setChecked] = useState(false);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p className="eyebrow">Loading…</p>
      </div>
    );
  }

  if (!session) return <SignIn />;
  if (!checked) return <FarmCheck onContinue={() => setChecked(true)} />;

  return <Outlet />;
}
