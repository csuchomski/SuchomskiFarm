import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, GridRow, Pill, StatTile } from "../components/ui";
import { fetchStoreData, type ProductWithInventory } from "../lib/store-data";
import { fetchOrders, isOpen, type RealOrder } from "../lib/orders";
import { fetchSchedules, type Schedule } from "../lib/schedules";
import { buildForecast, summarise, weeklyCommitment, type Forecast } from "../lib/forecast";
import { useWorkspace } from "../lib/workspace";
import "./store-forecast.css";

/**
 * Will there be enough?
 *
 * A cash-flow model for product: opening stock, expected production in,
 * standing orders and reservations out, walked forward a day at a time. The
 * number worth reading is the first day the balance goes negative.
 *
 * Production is an estimate and is labelled as one. The page says which
 * basis it used — a figure you set, or the last fortnight's average — so a
 * projection built on nothing can't be mistaken for a promise.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; products: ProductWithInventory[]; schedules: Schedule[]; orders: RealOrder[] };

const RANGES = [14, 28, 56];

const COLS = "110px 90px 90px 90px 1fr 110px";
const COLS_SM = "92px 74px 1fr 84px";

export default function StoreForecast() {
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;

  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [days, setDays] = useState(28);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    (async () => {
      if (businessId === null) {
        setLoad({ state: "ok", products: [], schedules: [], orders: [] });
        return;
      }
      const [store, schedules, orders] = await Promise.all([
        fetchStoreData({ businessId, farmId }),
        fetchSchedules(businessId),
        fetchOrders(businessId),
      ]);
      if (!cancelled) setLoad({ state: "ok", products: store.products, schedules, orders });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [businessId, farmId]);

  const products = load.state === "ok" ? load.products : EMPTY_PRODUCTS;
  const schedules = load.state === "ok" ? load.schedules : EMPTY_SCHEDULES;
  const orders = load.state === "ok" ? load.orders : EMPTY_ORDERS;
  const today = todayIso();

  const product = products.find((p) => p.id === selected) ?? products[0] ?? null;

  const forecasts = useMemo(
    () =>
      products.map((p) =>
        buildForecast({
          productId: p.id,
          // What's free to promise: on hand less what's already reserved.
          openingOnHand: p.openToShop,
          batches: p.batches,
          schedules,
          // An open reservation is already held in `reserved`, so it is not
          // subtracted again here — doing so would double-count it and
          // invent a shortfall that doesn't exist.
          reservations: [],
          forecastOverride: p.forecast_override,
          todayIso: today,
          days,
        }),
      ),
    [products, schedules, today, days],
  );

  const forecast: Forecast | undefined = forecasts.find((f) => f.productId === product?.id);
  const openOrders = orders.filter(isOpen);

  return (
    <OpsShell searchPlaceholder="A product…">
      <PageHeader eyebrow={business ? `${business.name} · store` : "Store"} title="Forecast" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't load: {load.message}</p>
      )}

      {load.state === "ok" && products.length === 0 && (
        <Callout>
          This business has no products yet, so there's nothing to forecast. Add one on{" "}
          <Link to="/store/products">Products</Link>.
        </Callout>
      )}

      {load.state === "ok" && products.length > 0 && (
        <>
          {/* ── one line per product ── */}
          <div className="serif" style={{ fontSize: 21, margin: "8px 0 12px" }}>
            Every product
          </div>
          <div className="forecast-cards">
            {products.map((p) => {
              const f = forecasts.find((x) => x.productId === p.id);
              const promised = weeklyCommitment(schedules, p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`forecast-card ${product?.id === p.id ? "forecast-card--active" : ""}`}
                  onClick={() => setSelected(p.id)}
                >
                  <div className="forecast-card__name serif">{p.name}</div>
                  <div className="forecast-card__now mono">
                    {p.openToShop} {p.unit} free
                  </div>
                  <div className="forecast-card__promise">
                    {promised > 0 ? `${promised} ${p.unit} promised weekly` : "nothing promised"}
                  </div>
                  {f?.firstShortfall ? (
                    <Pill variant="outline">short {f.firstShortfall.slice(5)}</Pill>
                  ) : f?.basis === "none" ? (
                    <Pill variant="neutral">no data</Pill>
                  ) : (
                    <Pill variant="outline-green">covered</Pill>
                  )}
                </button>
              );
            })}
          </div>

          {product && forecast && (
            <>
              <div className="forecast-head">
                <div>
                  <div className="serif" style={{ fontSize: 21 }}>
                    {product.name}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: forecast.firstShortfall ? "var(--red)" : "var(--ink-muted)",
                      textWrap: "pretty",
                    }}
                  >
                    {summarise(forecast, product.unit)}
                  </div>
                </div>
                <div className="report-ranges" style={{ marginBottom: 0 }}>
                  {RANGES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`report-chip ${days === d ? "report-chip--active" : ""}`}
                      onClick={() => setDays(d)}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
              </div>

              <div className="stat-row">
                <StatTile value={forecast.opening} label="Free now" unit={product.unit} />
                <StatTile value={forecast.dailyProduction || "—"} label="Expected per day" unit={product.unit} />
                <StatTile value={forecast.totalScheduled || "—"} label={`Promised over ${days} days`} />
                <StatTile
                  value={forecast.firstShortfall ? forecast.firstShortfall.slice(5) : "—"}
                  label="First short day"
                />
              </div>

              {forecast.basis === "none" && (
                <Callout>
                  Nothing has been added to stock for {product.name} in the last fortnight, so there's no production
                  rate to project from. This shows what happens if nothing more comes in. Record milkings on{" "}
                  <Link to="/milking">Milkings</Link>, or set a weekly figure on the product.
                </Callout>
              )}

              {openOrders.filter((o) => o.product_id === product.id).length > 0 && (
                <div style={{ paddingTop: 8 }}>
                  <Callout>
                    {openOrders.filter((o) => o.product_id === product.id).length} one-off{" "}
                    {openOrders.filter((o) => o.product_id === product.id).length === 1 ? "order is" : "orders are"}{" "}
                    already reserved and taken out of "free now", so they aren't subtracted again below — counting
                    them twice would invent a shortfall that isn't there.
                  </Callout>
                </div>
              )}

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Day</span>
                <span className="text-right">In</span>
                <span className="text-right hide-sm">Out</span>
                <span className="text-right hide-sm">Net</span>
                <span />
                <span className="text-right">Balance</span>
              </GridRow>

              {forecast.days.map((d) => {
                const out = d.scheduled + d.reserved;
                const peak = Math.max(1, ...forecast.days.map((x) => Math.abs(x.balance)));
                return (
                  <GridRow key={d.date} cols={COLS} mobileCols={COLS_SM} as="body" highlight={d.short}>
                    <span className="mono" style={{ fontSize: 13 }}>
                      {d.date.slice(5)}
                      <span className="hide-sm" style={{ color: "var(--ink-muted)" }}>
                        {" "}
                        {weekdayShort(d.date)}
                      </span>
                    </span>
                    <span className="mono text-right" style={{ color: d.production ? undefined : "var(--ink-faint)" }}>
                      {d.production || "—"}
                    </span>
                    <span
                      className="mono text-right hide-sm"
                      style={{ color: out ? "var(--red)" : "var(--ink-faint)" }}
                    >
                      {out || "—"}
                    </span>
                    <span className="mono text-right hide-sm" style={{ color: "var(--ink-muted)" }}>
                      {d.net > 0 ? `+${d.net}` : d.net || "—"}
                    </span>
                    <span className="forecast-bar" aria-hidden="true">
                      <span
                        className={`forecast-bar__fill ${d.balance < 0 ? "forecast-bar__fill--short" : ""}`}
                        style={{ width: `${Math.min(100, (Math.abs(d.balance) / peak) * 100)}%` }}
                      />
                    </span>
                    <span
                      className="mono text-right"
                      style={{ fontWeight: 500, color: d.balance < 0 ? "var(--red)" : undefined }}
                    >
                      {d.balance}
                    </span>
                  </GridRow>
                );
              })}

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 16 }}>
                Production is an estimate —{" "}
                {forecast.basis === "override"
                  ? "a weekly figure set on the product, divided across the week"
                  : forecast.basis === "history"
                    ? "the average of the last fortnight's additions to stock"
                    : "nothing, because none has been recorded"}
                . Standing orders come from <Link to="/store/schedules">Schedules</Link> and only hold stock once
                they're within three days.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayShort = (iso: string) => SHORT_DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

const EMPTY_PRODUCTS: ProductWithInventory[] = [];
const EMPTY_SCHEDULES: Schedule[] = [];
const EMPTY_ORDERS: RealOrder[] = [];
