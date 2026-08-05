import { Link, useNavigate } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, EarTag, GridRow, Pill, StatTile, WithdrawalBanner } from "../components/ui";
import { herd } from "../lib/mockData";
import { TODAY_LABEL, monthTotals, useAppState } from "../lib/store";
import "./today.css";

function money(n: number) {
  const sign = n < 0 ? "−" : n > 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function Today() {
  const navigate = useNavigate();
  const state = useAppState();
  const totals = monthTotals(state);
  const rawMilk = state.products.find((p) => p.id === "raw-milk");

  const todaysBatches = state.batches.filter((b) => b.produced === TODAY_LABEL);
  const milkToday = todaysBatches.reduce((s, b) => s + b.quantity, 0);

  const chain = [
    { step: "1 · Herd", title: "9 cows milked", detail: `${milkToday.toFixed(1)} gal, per animal`, dark: false },
    {
      step: "2 · Inventory",
      title: todaysBatches.length > 1 ? `${todaysBatches.length} batches · ${TODAY_LABEL}` : `Batch ${TODAY_LABEL}`,
      detail: "pooled · raw milk",
      dark: false,
    },
    {
      step: "3 · Store",
      title: `${typeof rawMilk?.claimed === "number" ? rawMilk.claimed.toFixed(1) : rawMilk?.claimed} gal claimed`,
      detail: `${typeof rawMilk?.openToShop === "number" ? rawMilk.openToShop.toFixed(1) : rawMilk?.openToShop} open to shop`,
      dark: false,
    },
    { step: "4 · Books", title: "+$88.00 posted", detail: "Milk sales · Dairy", dark: true },
  ];

  return (
    <OpsShell searchPlaceholder="Juniper, raw milk, feed invoice…">
      <PageHeader
        eyebrow="Wednesday 4 August 2026"
        title="Today"
        actions={
          <>
            <Button onClick={() => navigate("/store/products")}>Log milking</Button>
            <Button variant="filled" onClick={() => navigate("/books/transactions")}>
              Record pickup
            </Button>
          </>
        }
      />

      <div style={{ margin: "16px 0" }}>
        <Callout>
          <strong style={{ fontWeight: 500 }}>These numbers are still placeholders.</strong> Animals and Store read
          the real database now, so the milk and money figures below won't match what those screens show.
        </Callout>
      </div>

      <div className="stat-row">
        <StatTile value={milkToday.toFixed(1)} unit="gal" label="Milk today" />
        <StatTile value="9" unit="/ 41" label="Cows in milk" />
        <StatTile value="6" label="Pickups due" />
        <StatTile value={money(totals.net)} label="Net · July" />
        <StatTile value="$41.90" label="Cost / cow · MTD" />
      </div>

      <div className="section">
        <div className="section__head">
          <div className="serif" style={{ fontSize: 21 }}>
            This morning, end to end
          </div>
          <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
            one entry, four places
          </span>
        </div>
        <div className="chain">
          {chain.map((c) => (
            <div key={c.step} className={`chain__cell ${c.dark ? "chain__cell--dark" : ""}`}>
              <div className="eyebrow chain__step">{c.step}</div>
              <div className="serif chain__title">{c.title}</div>
              <div className="mono chain__detail">{c.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col" style={{ paddingTop: 24 }}>
        <div>
          <div className="section__head" style={{ marginBottom: 12 }}>
            <div className="serif" style={{ fontSize: 21 }}>
              Profit per head
            </div>
            <Link to="/animals" className="mono" style={{ fontSize: 13 }}>
              all 41 →
            </Link>
          </div>
          <GridRow cols="60px 1fr 76px 76px 84px" as="header">
            <span>Tag</span>
            <span>Animal</span>
            <span className="text-right">Gal</span>
            <span className="text-right">Cost</span>
            <span className="text-right">Net</span>
          </GridRow>
          {herd.map((a) => (
            <GridRow
              cols="60px 1fr 76px 76px 84px"
              as="body"
              key={a.tag}
              highlight={a.status === "withdrawal"}
            >
              <EarTag tag={a.tag} accent={a.tagAccent} />
              <span>
                <Link to={`/animals/${a.tag}`} className="serif" style={{ fontSize: 17, color: "var(--ink)" }}>
                  {a.name}
                </Link>
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
          ))}
        </div>

        <div>
          <div className="serif" style={{ fontSize: 21, marginBottom: 12 }}>
            Needs you
          </div>

          <WithdrawalBanner
            eyebrow="Withdrawal · until 9 Aug"
            title="Hazel · 1103"
            facts={["Excede · 5 days left", "Milk excluded from batches"]}
          />

          <div style={{ marginBottom: 16 }}>
            <Callout>
              <strong style={{ fontWeight: 500 }}>4 pickups are uncategorised.</strong> $164.50 is sitting in the
              store, waiting for a category before it reaches the books.
            </Callout>
          </div>

          <NeedsRow dot="ochre" title="Eggs short by 3 dozen Friday" detail="Weekly pickups exceed forecast supply" />
          <NeedsRow dot="red" title="Pepper is below feed cost" detail="Third month running · review or cull" />
          <NeedsRow
            dot="herd"
            title="Feed invoice unallocated"
            detail="$612 · split across 41 head?"
            border="both"
          />
        </div>
      </div>
    </OpsShell>
  );
}

function NeedsRow({
  dot,
  title,
  detail,
  border = "top",
}: {
  dot: "ochre" | "red" | "herd";
  title: string;
  detail: string;
  border?: "top" | "both";
}) {
  const dotColor = dot === "ochre" ? "var(--ochre)" : dot === "red" ? "var(--red)" : "var(--herd-green)";
  return (
    <div
      style={{
        borderTop: "1px solid var(--hairline)",
        borderBottom: border === "both" ? "1px solid var(--hairline)" : undefined,
        padding: "12px 8px",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <span style={{ width: 9, height: 9, background: dotColor, marginTop: 6, flex: "none" }} />
      <div>
        <div style={{ fontSize: 15 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>{detail}</div>
      </div>
    </div>
  );
}
