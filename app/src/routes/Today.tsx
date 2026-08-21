import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, Callout, EarTag, GridRow, StatTile } from "../components/ui";
import { fetchDashboardData, type DashboardData } from "../lib/dashboard-data";
import { useWorkspace } from "../lib/workspace";
import { animalPath, formatAge } from "../lib/herd";
import { buildAlerts, fetchAlertInputs, whenInWords, type Alert } from "../lib/alerts";
import "./today.css";

type Fetch = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; data: DashboardData };

const money = (cents: number) => {
  const sign = cents < 0 ? "−" : cents > 0 ? "+" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const dollars = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function Today() {
  const navigate = useNavigate();
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;
  const [result, setResult] = useState<Fetch>({ state: "loading" });
  // The herd's outstanding jobs, worked out from the breeding record. Kept in
  // its own state so a slow read of the whole repro history doesn't hold up
  // the figures at the top of the page.
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    if (businessId === null) return;
    let cancelled = false;
    setResult({ state: "loading" });

    fetchDashboardData(todayIso(), { businessId, farmId })
      .then((data) => !cancelled && setResult({ state: "ok", data }))
      .catch(
        (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      cancelled = true;
    };
    // Both ids matter: the ledger follows the business, the herd follows the
    // farm, and a switch changes them together.
  }, [businessId, farmId]);

  useEffect(() => {
    if (!farmId) return;
    let cancelled = false;
    fetchAlertInputs(farmId, todayIso())
      .then((input) => !cancelled && setAlerts(buildAlerts(input)))
      // A failure here leaves the list empty rather than breaking Today. It
      // is a summary of another page, and that page will say what went wrong.
      .catch(() => !cancelled && setAlerts([]));
    return () => {
      cancelled = true;
    };
  }, [farmId]);

  const data = result.state === "ok" ? result.data : null;

  return (
    <OpsShell searchPlaceholder="An animal, a product, an invoice…">
      <PageHeader
        eyebrow={longDate(todayIso())}
        title="Today"
        actions={
          <>
            {/* First, because it is the first job of the day — the mob gets
                moved before anything here gets logged. */}
            <Button onClick={() => navigate("/grazing/move")}>Cattle move</Button>
            <Button onClick={() => navigate("/milkings")}>Log milking</Button>
            <Button variant="filled" onClick={() => navigate("/books/transactions")}>
              Add entry
            </Button>
          </>
        }
      />

      {result.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {result.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load today: {result.message}</p>
      )}

      {data && (
        <>
          <div className="stat-row">
            <StatTile
              value={data.milkTodayQuantity > 0 ? data.milkTodayQuantity : "—"}
              unit={data.milkTodayQuantity > 0 ? (data.milkTodayUnit ?? undefined) : undefined}
              label="Milk today"
            />
            <StatTile value={data.animals.length} label="Head" />
            <StatTile value={data.openOrders} label="Orders open" />
            <StatTile
              value={dollars(data.monthNet).replace("$-", "−$")}
              label={`Net · ${new Date(`${data.today}T00:00:00`).toLocaleDateString(undefined, { month: "long" })}`}
              tone={data.monthNet < 0 ? "red" : "ink"}
            />
            <StatTile value={data.monthEntries} label="Entries this month" />
          </div>

          {/* The chain the whole design is built around: one milking becomes a
              batch, a claim, and a ledger line. Shown with real counts, and
              honest about the steps that have nothing in them today. */}
          <div className="section">
            <div className="section__head">
              <div className="serif" style={{ fontSize: 21 }}>
                Today, end to end
              </div>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                one entry, four places
              </span>
            </div>
            {data.milkIdentifiedByName && (
              <div style={{ marginBottom: 16 }}>
                <Callout>
                  Milk is being identified by product name, which miscounts both ways — a "milk soap" would be
                  counted, a "Raw Jersey" wouldn't. Running{" "}
                  <code>docs/migrations/008-product-types.sql</code> replaces the guess with a real type.
                </Callout>
              </div>
            )}
            <div className="chain">
              <ChainCell
                step="1 · Herd"
                title={data.milkTodayQuantity > 0 ? `${data.milkTodayQuantity} ${data.milkTodayUnit ?? ""}`.trim() : "Nothing logged"}
                detail={data.milkTodayQuantity > 0 ? "recorded per animal" : "no production today"}
                empty={data.milkTodayQuantity === 0}
              />
              <ChainCell
                step="2 · Inventory"
                title={data.batchesToday > 0 ? `${data.batchesToday} batch${data.batchesToday === 1 ? "" : "es"}` : "No batch"}
                detail={data.batchesToday > 0 ? `produced ${data.today}` : "nothing added today"}
                empty={data.batchesToday === 0}
              />
              <ChainCell
                step="3 · Store"
                title={`${data.claimed} claimed`}
                detail={`${data.openToShop} open to shop`}
                empty={data.claimed === 0 && data.openToShop === 0}
              />
              <ChainCell
                step="4 · Books"
                title={
                  data.transactionsToday.length > 0
                    ? `${data.transactionsToday.length} entr${data.transactionsToday.length === 1 ? "y" : "ies"}`
                    : "Nothing posted"
                }
                detail={data.transactionsToday.length > 0 ? "posted today" : "no entries today"}
                dark
                empty={data.transactionsToday.length === 0}
              />
            </div>
          </div>

          <div className="two-col" style={{ paddingTop: 24 }}>
            <div>
              <div className="section__head" style={{ marginBottom: 12 }}>
                <div className="serif" style={{ fontSize: 21 }}>
                  Profit per head
                </div>
                <Link to="/animals" className="mono" style={{ fontSize: 13 }}>
                  all {data.animals.length} →
                </Link>
              </div>

              {!data.hasCostData && (
                <div style={{ marginBottom: 12 }}>
                  <Callout>
                    Costs and revenue aren't attributed to animals yet, so every line below is zero. That's what
                    the migrations in <code>docs/</code> are for — until a ledger entry can point at an animal,
                    there's nothing to divide.
                  </Callout>
                </div>
              )}

              <GridRow cols="60px 1fr 92px 92px 100px" mobileCols="44px 1fr 92px" as="header">
                <span>Tag</span>
                <span>Animal</span>
                <span className="text-right hide-sm">Revenue</span>
                <span className="text-right hide-sm">Cost</span>
                <span className="text-right">Net</span>
              </GridRow>
              {data.profitPerHead.map(({ animal, costCents, revenueCents, netCents }) => (
                <Link key={animal.id} to={animalPath(animal)} style={{ color: "inherit", display: "contents" }}>
                  <GridRow cols="60px 1fr 92px 92px 100px" mobileCols="44px 1fr 92px" as="body">
                    <EarTag tag={animal.ear_tag} accent="herd" />
                    <span>
                      <span className="serif" style={{ fontSize: 17 }}>
                        {animal.barn_name ?? `Tag ${animal.ear_tag}`}
                      </span>
                      <br />
                      <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                        {animal.class} · {formatAge(animal.birth_date)}
                      </span>
                    </span>
                    <span className="mono text-right hide-sm" style={{ fontSize: 15 }}>
                      {revenueCents ? money(revenueCents) : "—"}
                    </span>
                    <span
                      className="mono text-right hide-sm"
                      style={{ fontSize: 15, color: costCents ? "var(--red)" : undefined }}
                    >
                      {costCents ? dollars(costCents / 100) : "—"}
                    </span>
                    <span
                      className="mono text-right"
                      style={{ fontSize: 15, fontWeight: 500, color: netCents < 0 ? "var(--red)" : undefined }}
                    >
                      {netCents ? money(netCents) : "—"}
                    </span>
                  </GridRow>
                </Link>
              ))}
            </div>

            <div>
              <div className="section__head" style={{ marginBottom: 12 }}>
                <div className="serif" style={{ fontSize: 21 }}>
                  Needs you
                </div>
                {alerts.length > 0 && (
                  <Link to="/alerts" className="mono" style={{ fontSize: 13 }}>
                    all {alerts.length} →
                  </Link>
                )}
              </div>
              <NeedsList data={data} alerts={alerts} />
            </div>
          </div>
        </>
      )}
    </OpsShell>
  );
}

function ChainCell({
  step,
  title,
  detail,
  dark,
  empty,
}: {
  step: string;
  title: string;
  detail: string;
  dark?: boolean;
  empty?: boolean;
}) {
  return (
    <div className={`chain__cell ${dark ? "chain__cell--dark" : ""}`}>
      <div className="eyebrow chain__step">{step}</div>
      <div className="serif chain__title" style={empty && !dark ? { color: "var(--ink-faint)" } : undefined}>
        {title}
      </div>
      <div className="mono chain__detail">{detail}</div>
    </div>
  );
}

/** Alerts derived from what's actually in the database, rather than a fixed
 * list. An empty list here is a real answer — nothing needs attention. */
function NeedsList({ data, alerts }: { data: DashboardData; alerts: Alert[] }) {
  const items: { tone: "ochre" | "red" | "herd"; title: string; detail: string; to?: string }[] = [];

  // The herd's own jobs first — a cow past her due date outranks an order
  // nobody has collected. Only the urgent ones; the rest are on /alerts, and
  // a panel that lists everything is a panel nobody reads.
  for (const alert of alerts.filter((a) => a.urgency === "now").slice(0, 4)) {
    items.push({
      tone: "red",
      title: alert.title,
      detail: `${alert.detail.split(". ")[0]} · ${whenInWords(alert.daysLate)}`,
      to: alert.href,
    });
  }

  if (data.openOrders > 0) {
    items.push({
      tone: "herd",
      title: `${data.openOrders} order${data.openOrders === 1 ? "" : "s"} not picked up`,
      detail: "Neither collected nor cancelled",
      to: "/store/orders",
    });
  }

  if (data.openToShop <= 0 && data.claimed > 0) {
    items.push({
      tone: "ochre",
      title: "Nothing open to shop",
      detail: "Every batch on hand is already claimed",
      to: "/store/products",
    });
  }

  if (data.milkTodayQuantity === 0) {
    items.push({
      tone: "ochre",
      title: "No milking logged today",
      detail: "Nothing recorded against any animal",
      to: "/milkings",
    });
  }

  if (!data.hasCostData) {
    items.push({
      tone: "herd",
      title: "No costs attributed to animals",
      detail: "Cost per head can't be calculated yet",
    });
  }

  if (items.length === 0) {
    return (
      <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "12px 8px", borderTop: "1px solid var(--hairline)" }}>
        Nothing needs your attention.
      </p>
    );
  }

  return (
    <>
      {items.map((item, i) => {
        const dotColor =
          item.tone === "ochre" ? "var(--ochre)" : item.tone === "red" ? "var(--red)" : "var(--herd-green)";
        const body = (
          <div
            style={{
              borderTop: "1px solid var(--hairline)",
              borderBottom: i === items.length - 1 ? "1px solid var(--hairline)" : undefined,
              padding: "12px 8px",
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
            }}
          >
            <span style={{ width: 9, height: 9, background: dotColor, marginTop: 6, flex: "none" }} />
            <div>
              <div style={{ fontSize: 15 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>{item.detail}</div>
            </div>
          </div>
        );
        return item.to ? (
          <Link key={item.title} to={item.to} style={{ color: "inherit", display: "block" }}>
            {body}
          </Link>
        ) : (
          <div key={item.title}>{body}</div>
        );
      })}
    </>
  );
}
