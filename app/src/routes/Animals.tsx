import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { EarTag, GridRow, Pill } from "../components/ui";
import { fetchAnimals, formatAge, type RealAnimal } from "../lib/herd";

type Fetch = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; rows: RealAnimal[] };

export default function Animals() {
  const [result, setResult] = useState<Fetch>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchAnimals()
      .then((rows) => !cancelled && setResult({ state: "ok", rows }))
      .catch((err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const count = result.state === "ok" ? result.rows.length : undefined;

  return (
    <OpsShell>
      <PageHeader eyebrow={count !== undefined ? `Herd · ${count} head` : "Herd"} title="Animals" />
      <div style={{ paddingTop: 16 }}>
        {result.state === "loading" && (
          <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading herd…</p>
        )}

        {result.state === "error" && (
          <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load the herd: {result.message}</p>
        )}

        {result.state === "ok" && (
          <>
            <GridRow cols="60px 1fr 120px 100px" as="header">
              <span>Tag</span>
              <span>Animal</span>
              <span>Status</span>
              <span className="text-right">Age</span>
            </GridRow>
            {result.rows.map((a) => (
              <Link key={a.id} to={`/animals/${a.ear_tag}`} style={{ color: "inherit", display: "contents" }}>
                <GridRow cols="60px 1fr 120px 100px" as="body">
                  {/* Withdrawal/at-risk accent colors need herd.treatments, not wired yet — every
                      real animal shows as plain "herd" green until that's in. */}
                  <EarTag tag={a.ear_tag} accent="herd" />
                  <span>
                    <span className="serif" style={{ fontSize: 17 }}>
                      {a.barn_name ?? `Tag ${a.ear_tag}`}
                    </span>
                    <br />
                    <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                      {a.sex} · {a.class}
                    </span>
                  </span>
                  <span>
                    <Pill variant={a.status === "active" ? "outline-green" : "outline"}>{a.status}</Pill>
                  </span>
                  <span className="mono text-right" style={{ fontSize: 15 }}>
                    {formatAge(a.birth_date)}
                  </span>
                </GridRow>
              </Link>
            ))}
            {result.rows.length === 0 && (
              <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>No animals recorded yet.</p>
            )}
          </>
        )}

        <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 16 }}>
          Real herd data. Gal/Cost/Net aren't shown yet — those need lactations and cost/revenue entries, which
          aren't wired up on this screen yet.
        </p>
      </div>
    </OpsShell>
  );
}
