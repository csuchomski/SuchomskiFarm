import { useEffect, useState } from "react";
import { Button } from "../ui";
import { herdSchema, supabase } from "../../lib/supabase";
import { signOut } from "../../lib/auth";
import "./sign-in.css";

type Result =
  | { state: "loading" }
  | { state: "error"; message: string; step: string }
  | { state: "empty" }
  | { state: "ok"; farmName: string; role: string };

/**
 * The smallest possible checkable slice: log in, then prove the RLS-gated
 * read actually works by fetching the current user's farm membership. Sits
 * in front of the existing mock-data app rather than replacing any of its
 * 5 screens yet — see IMPLEMENTATION_PLAN.md for why.
 */
export function FarmCheck({ onContinue }: { onContinue: () => void }) {
  const [result, setResult] = useState<Result>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (!cancelled) setResult({ state: "error", step: "auth.getUser()", message: userError?.message ?? "No user" });
        return;
      }

      const { data: memberRows, error: memberError } = await herdSchema()
        .from("farm_members")
        .select("farm_id, role")
        .eq("user_id", userData.user.id);

      if (memberError) {
        if (!cancelled) setResult({ state: "error", step: "herd.farm_members select", message: memberError.message });
        return;
      }
      if (!memberRows || memberRows.length === 0) {
        if (!cancelled) setResult({ state: "empty" });
        return;
      }

      const { farm_id, role } = memberRows[0];
      const { data: farm, error: farmError } = await herdSchema()
        .from("farms")
        .select("name")
        .eq("id", farm_id)
        .single();

      if (farmError) {
        if (!cancelled) setResult({ state: "error", step: "herd.farms select", message: farmError.message });
        return;
      }
      if (!cancelled) setResult({ state: "ok", farmName: farm.name, role });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="sign-in-page">
      <div className="sign-in-card" style={{ width: 420 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Supabase connection check
        </div>

        {result.state === "loading" && <p style={{ fontSize: 14 }}>Querying herd.farm_members…</p>}

        {result.state === "error" && (
          <>
            <p style={{ color: "var(--red)", fontSize: 14, marginBottom: 4 }}>
              <strong>{result.step}</strong> failed:
            </p>
            <p style={{ color: "var(--red)", fontSize: 13, fontFamily: "var(--font-mono)" }}>{result.message}</p>
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
              If this says something like "relation does not exist" or a schema/404-shaped error, check Project
              Settings → API → Exposed schemas includes <code>herd</code>.
            </p>
          </>
        )}

        {result.state === "empty" && (
          <p style={{ fontSize: 14 }}>
            Signed in, but no <code>farm_members</code> row came back for this user. RLS is working (it didn't
            error) — there's just nothing to see yet, which shouldn't happen given what you showed me in the SQL
            editor. Worth double-checking you're signed in as the right account.
          </p>
        )}

        {result.state === "ok" && (
          <>
            <p style={{ fontSize: 14, marginBottom: 4 }}>
              ✅ Read <strong>{result.farmName}</strong> as <strong>{result.role}</strong> through Row Level
              Security.
            </p>
            <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
              Auth and the herd schema are both working. The 5 screens past this point are still on mock data —
              that's the next piece.
            </p>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          <Button onClick={() => void signOut()}>Sign out</Button>
          <Button variant="filled" onClick={onContinue} style={{ flex: 1 }}>
            Continue to the app (mock data)
          </Button>
        </div>
      </div>
    </div>
  );
}
