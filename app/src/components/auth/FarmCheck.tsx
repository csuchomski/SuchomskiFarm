import { useEffect, useState } from "react";
import { Button } from "../ui";
import { herdSchema, supabase } from "../../lib/supabase";
import { signOut } from "../../lib/auth";
import "./sign-in.css";

interface AnimalRow {
  id: string;
  barn_name: string | null;
  ear_tag: string;
  birth_date: string;
  class: string;
  status: string;
  sex: string;
}

type AnimalsResult =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; rows: AnimalRow[]; count: number };

type Result =
  | { state: "loading" }
  | { state: "error"; message: string; step: string }
  | { state: "empty" }
  | { state: "ok"; farmName: string; role: string; farmId: string; animals: AnimalsResult };

/**
 * The smallest possible checkable slice: log in, then prove the RLS-gated
 * read actually works by fetching the current user's farm membership, then
 * a raw sample of herd.animals — before mapping any real field onto a real
 * screen. Sits in front of the existing mock-data app; see
 * IMPLEMENTATION_PLAN.md for why.
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
      if (cancelled) return;

      setResult({ state: "ok", farmName: farm.name, role, farmId: farm_id, animals: { state: "loading" } });

      const { data: animalRows, error: animalError, count } = await herdSchema()
        .from("animals")
        .select("id, barn_name, ear_tag, birth_date, class, status, sex", { count: "exact" })
        .order("barn_name")
        .limit(10);

      if (cancelled) return;
      if (animalError) {
        setResult((prev) =>
          prev.state === "ok" ? { ...prev, animals: { state: "error", message: animalError.message } } : prev,
        );
        return;
      }
      setResult((prev) =>
        prev.state === "ok" ? { ...prev, animals: { state: "ok", rows: animalRows ?? [], count: count ?? 0 } } : prev,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="sign-in-page">
      <div className="sign-in-card" style={{ width: result.state === "ok" ? 640 : 420 }}>
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

            {result.animals.state === "loading" && (
              <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>Querying herd.animals…</p>
            )}

            {result.animals.state === "error" && (
              <>
                <p style={{ color: "var(--red)", fontSize: 14, marginTop: 16, marginBottom: 4 }}>
                  <strong>herd.animals select</strong> failed:
                </p>
                <p style={{ color: "var(--red)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
                  {result.animals.message}
                </p>
              </>
            )}

            {result.animals.state === "ok" && (
              <>
                <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: "12px 0 8px" }}>
                  {result.animals.count} total animal{result.animals.count === 1 ? "" : "s"} — first {result.animals.rows.length} shown:
                </p>
                <table className="mono" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--hairline)" }}>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>ear_tag</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>barn_name</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>sex</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>class</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>status</th>
                      <th style={{ textAlign: "left", padding: "4px 6px" }}>birth_date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.animals.rows.map((a) => (
                      <tr key={a.id} style={{ borderBottom: "1px solid var(--hairline)" }}>
                        <td style={{ padding: "4px 6px" }}>{a.ear_tag}</td>
                        <td style={{ padding: "4px 6px" }}>{a.barn_name ?? "—"}</td>
                        <td style={{ padding: "4px 6px" }}>{a.sex}</td>
                        <td style={{ padding: "4px 6px" }}>{a.class}</td>
                        <td style={{ padding: "4px 6px" }}>{a.status}</td>
                        <td style={{ padding: "4px 6px" }}>{a.birth_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.animals.rows.length === 0 && (
                  <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                    No rows came back — either there genuinely are no animals yet, or something's off.
                  </p>
                )}
              </>
            )}

            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 16 }}>
              The 5 screens past this point are still on mock data — this table is just to see the real shape
              before I map it onto them.
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
