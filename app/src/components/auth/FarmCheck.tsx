import { useEffect, useState } from "react";
import { Button } from "../ui";
import { supabase } from "../../lib/supabase";
import { signOut } from "../../lib/auth";
import "./sign-in.css";

/** Tables worth knowing the size of before building UI against them.
 * Counted with head:true so this pulls counts, not rows. */
const HERD_TABLES = [
  "animals",
  "lactations",
  "test_days",
  "production_records",
  "treatments",
  "vaccinations",
  "calvings",
  "cost_entries",
  "revenue_entries",
  "breeds",
  "breed_composition",
  "animal_photos",
  "meat_sales",
];

const PUBLIC_TABLES = [
  "products",
  "inventory_batches",
  "orders",
  "schedules",
  "discards",
  "ledger_transactions",
  "ledger_accounts",
  "businesses",
  "profiles",
];

interface TableCount {
  schema: "herd" | "public";
  table: string;
  count: number | null;
  error: string | null;
}

type Result =
  | { state: "loading"; note: string }
  | { state: "error"; message: string; step: string }
  | { state: "empty" }
  | { state: "ok"; farmName: string; role: string; counts: TableCount[] };

async function countTable(schema: "herd" | "public", table: string): Promise<TableCount> {
  const client = schema === "herd" ? supabase.schema("herd") : supabase;
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  return { schema, table, count: count ?? null, error: error?.message ?? null };
}

/**
 * Connection check plus a data inventory: which tables actually have rows.
 * Building screens against empty tables wastes a round trip each time
 * (this sandbox has no network path to Supabase, so every query has to be
 * verified by the user by hand) — one inventory up front is cheaper.
 */
export function FarmCheck({ onContinue }: { onContinue: () => void }) {
  const [result, setResult] = useState<Result>({ state: "loading", note: "Querying herd.farm_members…" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (!cancelled) setResult({ state: "error", step: "auth.getUser()", message: userError?.message ?? "No user" });
        return;
      }

      const { data: memberRows, error: memberError } = await supabase
        .schema("herd")
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
      const { data: farm, error: farmError } = await supabase
        .schema("herd")
        .from("farms")
        .select("name")
        .eq("id", farm_id)
        .single();

      if (farmError) {
        if (!cancelled) setResult({ state: "error", step: "herd.farms select", message: farmError.message });
        return;
      }
      if (cancelled) return;

      setResult({ state: "loading", note: "Counting rows across the schema…" });

      const counts = await Promise.all([
        ...HERD_TABLES.map((t) => countTable("herd", t)),
        ...PUBLIC_TABLES.map((t) => countTable("public", t)),
      ]);

      if (!cancelled) setResult({ state: "ok", farmName: farm.name, role, counts });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const wide = result.state === "ok";

  return (
    <div className="sign-in-page">
      <div className="sign-in-card" style={{ width: wide ? 620 : 420, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Supabase connection check
        </div>

        {result.state === "loading" && <p style={{ fontSize: 14 }}>{result.note}</p>}

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
            error) — there's just nothing to see yet.
          </p>
        )}

        {result.state === "ok" && (
          <>
            <p style={{ fontSize: 14, marginBottom: 16 }}>
              ✅ Read <strong>{result.farmName}</strong> as <strong>{result.role}</strong> through Row Level
              Security.
            </p>

            <div className="eyebrow" style={{ marginBottom: 8 }}>
              What's actually populated
            </div>
            <table className="mono" style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <tbody>
                {result.counts.map((c) => (
                  <tr key={`${c.schema}.${c.table}`} style={{ borderBottom: "1px solid var(--hairline)" }}>
                    <td style={{ padding: "3px 6px", color: "var(--ink-muted)" }}>{c.schema}</td>
                    <td style={{ padding: "3px 6px" }}>{c.table}</td>
                    <td
                      style={{
                        padding: "3px 6px",
                        textAlign: "right",
                        fontWeight: c.count ? 500 : 400,
                        color: c.error ? "var(--red)" : c.count ? "var(--ink)" : "var(--ink-faint)",
                      }}
                    >
                      {c.error ? "error" : c.count === 0 ? "—" : c.count}
                    </td>
                    <td style={{ padding: "3px 6px", color: "var(--red)", fontSize: 11 }}>{c.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
              Animals and the animal record read real data now. Everything else is still mock — this inventory is
              to decide what's worth wiring next.
            </p>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          <Button onClick={() => void signOut()}>Sign out</Button>
          <Button variant="filled" onClick={onContinue} style={{ flex: 1 }}>
            Continue to the app
          </Button>
        </div>
      </div>
    </div>
  );
}
