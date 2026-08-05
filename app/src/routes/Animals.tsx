import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { EarTag, GridRow, Pill } from "../components/ui";
import { herd } from "../lib/mockData";

function money(n: number) {
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toLocaleString()}`;
}

export default function Animals() {
  return (
    <OpsShell>
      <PageHeader eyebrow="Herd · 41 head · 9 in milk" title="Animals" />
      <div style={{ paddingTop: 16 }}>
        <GridRow cols="60px 1fr 76px 76px 84px" as="header">
          <span>Tag</span>
          <span>Animal</span>
          <span className="text-right">Gal</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Net</span>
        </GridRow>
        {herd.map((a) => (
          <Link key={a.tag} to={`/animals/${a.tag}`} style={{ color: "inherit", display: "contents" }}>
            <GridRow cols="60px 1fr 76px 76px 84px" as="body" highlight={a.status === "withdrawal"}>
              <EarTag tag={a.tag} accent={a.tagAccent} />
              <span>
                <span className="serif" style={{ fontSize: 17 }}>
                  {a.name}
                </span>
                {a.status === "withdrawal" && (
                  <>
                    {" "}
                    <Pill variant="withdrawal">Withdrawal</Pill>
                  </>
                )}
                <br />
                <span style={{ fontSize: 13, color: a.status === "at-risk" ? "var(--red)" : "var(--ink-muted)" }}>
                  {a.note ?? `${a.breed} · ${a.lactationLabel}`}
                </span>
              </span>
              <span className="mono text-right" style={{ fontSize: 15 }}>
                {a.gallonsToDate.toLocaleString()}
              </span>
              <span className="mono text-right" style={{ fontSize: 15, color: "var(--red)" }}>
                ${a.costToDate}
              </span>
              <span
                className="mono text-right"
                style={{ fontSize: 15, fontWeight: 500, color: a.netToDate < 0 ? "var(--red)" : undefined }}
              >
                {money(a.netToDate)}
              </span>
            </GridRow>
          </Link>
        ))}
        <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 16 }}>
          Showing 6 of 41 head — the animals drawn in the mockups. The rest of the herd list isn't designed yet.
        </p>
      </div>
    </OpsShell>
  );
}
