import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, GridRow, StatTile } from "../components/ui";
import { fetchBooksData, typeMap, type BooksData } from "../lib/books-data";
import { accountBalances } from "../lib/books-report";
import { buildForecast } from "../lib/forecast";
import { fetchOrders, type RealOrder } from "../lib/orders";
import { fetchSchedules, type Schedule } from "../lib/schedules";
import { fetchStoreData, type ProductWithInventory } from "../lib/store-data";
import {
  averageWeeklyPayments,
  orderReceipts,
  projectCash,
  summariseCash,
  weekLabel,
} from "../lib/cash-forecast";
import { useWorkspace } from "../lib/workspace";
import "./books-reports.css";

/**
 * Books → Cash flow: the thirteen-week rolling forecast.
 *
 * The report a business is actually managed from. Not the accountant's
 * statement — the question here is *which week do I run out*, and it is
 * answered by walking cash forward: what is in the bank, plus what is
 * coming in, less what goes out.
 *
 * Weekly rather than monthly because a monthly grid hides a mid-month
 * trough, and the trough is the point. It is also the grain this farm's
 * income arrives on: a standing order is a weekday.
 *
 * ── Where the money comes from ─────────────────────────────────────────
 *
 * Cash on hand is the ledger's, via `accountBalances` — the same figure the
 * Balance sheet reads, so the two cannot disagree. What is coming in is the
 * store's: standing orders priced out, and the unpaid balance of orders
 * somebody has reserved. What is going out is an average of what has
 * actually been spent, because there is no scheduled-cost data on this farm
 * and an average from history is right on the first day rather than after
 * somebody fills in a form.
 *
 * ── Committed and expected are not the same money ──────────────────────
 *
 * The running balance counts committed receipts only. Forecast production
 * beyond what is promised is real product but not a sale, so it is carried
 * beside the row and never inside the balance. See `projectCash`, which is
 * pure and unit-tested.
 */

const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whole dollars, for the asides where cents are noise. */
const dollars = (n: number) => `${n < 0 ? "−" : ""}$${Math.round(Math.abs(n)).toLocaleString()}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      books: BooksData;
      products: ProductWithInventory[];
      schedules: Schedule[];
      orders: RealOrder[];
    };

const HORIZONS = [
  { weeks: 4, label: "4 weeks" },
  { weeks: 8, label: "8 weeks" },
  { weeks: 13, label: "13 weeks" },
];

const COLS = "1fr 100px 100px 100px 110px 120px";
// Three cells fit a phone. Net and the balance survive: the breakdown is in
// the aside under the week, and the balance is the reason the page exists.
const COLS_SM = "1fr 100px 110px";

const ACC_COLS = "1fr 140px";

const EMPTY_PRODUCTS: ProductWithInventory[] = [];
const EMPTY_SCHEDULES: Schedule[] = [];
const EMPTY_ORDERS: RealOrder[] = [];

export default function BooksCashFlow() {
  const { business, farmId } = useWorkspace();
  const businessId = business?.id ?? null;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [weeks, setWeeks] = useState(13);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    (async () => {
      const books = await fetchBooksData();
      if (businessId === null) {
        if (!cancelled) {
          setLoad({ state: "ok", books, products: [], schedules: [], orders: [] });
        }
        return;
      }
      const [store, schedules, orders] = await Promise.all([
        fetchStoreData({ businessId, farmId }),
        fetchSchedules(businessId),
        fetchOrders(businessId),
      ]);
      if (!cancelled) setLoad({ state: "ok", books, products: store.products, schedules, orders });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [businessId, farmId]);

  const books = load.state === "ok" ? load.books : null;
  const products = load.state === "ok" ? load.products : EMPTY_PRODUCTS;
  const schedules = load.state === "ok" ? load.schedules : EMPTY_SCHEDULES;
  const orders = load.state === "ok" ? load.orders : EMPTY_ORDERS;
  const types = useMemo(() => typeMap(books?.types ?? []), [books?.types]);
  const today = todayIso();

  const mine = useMemo(
    () => (books ? books.transactions.filter((t) => t.business_id === businessId) : []),
    [books, businessId],
  );

  /** Cash on hand, per account. The Balance sheet's own figures. */
  const balances = useMemo(() => {
    if (!books) return [];
    return accountBalances(books.accounts.filter((a) => a.business_id === businessId), mine, types);
  }, [books, businessId, mine, types]);

  const cashNow = useMemo(() => balances.reduce((sum, b) => sum + b.balance, 0), [balances]);

  /**
   * The production walk, per product — the same one the Store forecast
   * draws, so the two pages cannot disagree about what is coming.
   *
   * `reservations: []` for the same reason it is empty there: an open
   * reservation is already held out of `openToShop`, and subtracting it
   * again would invent a shortfall.
   */
  const forecasts = useMemo(
    () =>
      products.map((p) =>
        buildForecast({
          productId: p.id,
          openingOnHand: p.openToShop,
          batches: p.batches,
          schedules,
          reservations: [],
          forecastOverride: p.forecast_override,
          todayIso: today,
          days: weeks * 7,
        }),
      ),
    [products, schedules, today, weeks],
  );

  const priceOf = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p.price === null ? null : Number(p.price)]));
    return (id: number) => byId.get(id) ?? null;
  }, [products]);

  const { receipts, unpriced } = useMemo(() => orderReceipts(orders, today), [orders, today]);

  const weeklyPayments = useMemo(
    () => averageWeeklyPayments(mine, types, today, 13),
    [mine, types, today],
  );

  const forecast = useMemo(
    () =>
      projectCash({
        todayIso: today,
        openingCash: cashNow,
        forecasts,
        priceOf,
        schedules,
        receipts,
        unpricedOrders: unpriced,
        weeklyPayments,
        weeks,
      }),
    [today, cashNow, forecasts, priceOf, schedules, receipts, unpriced, weeklyPayments, weeks],
  );

  const committedIn = forecast.totalStanding + forecast.totalReserved;
  const closing = forecast.weeks.length ? forecast.weeks[forecast.weeks.length - 1].closing : cashNow;
  const nothingComing = committedIn === 0 && forecast.totalExpected === 0;

  return (
    <OpsShell searchPlaceholder="A week…">
      <PageHeader eyebrow={business ? `${business.name} · books` : "Books"} title="Cash flow" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Loading…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>
          Couldn't load: {load.message}
        </p>
      )}

      {load.state === "ok" && (
        <>
          <div className="report-ranges">
            {HORIZONS.map((h) => (
              <button
                key={h.label}
                type="button"
                className={`report-chip ${weeks === h.weeks ? "report-chip--active" : ""}`}
                onClick={() => setWeeks(h.weeks)}
              >
                {h.label}
              </button>
            ))}
          </div>

          {/* The warning first, in a sentence, because a shortfall is the
              most urgent thing this page can say and a reader should not
              have to find it in a column. */}
          <p className={forecast.firstShortWeek !== null ? "cash-verdict cash-verdict--short" : "cash-verdict"}>
            {summariseCash(forecast)}
          </p>

          <div className="stat-row">
            <StatTile value={money(cashNow)} label="Cash on hand" />
            <StatTile value={committedIn ? money(committedIn) : "—"} label={`Committed in, ${weeks} weeks`} />
            <StatTile
              value={forecast.totalPayments ? money(forecast.totalPayments) : "—"}
              label={`Going out, ${weeks} weeks`}
            />
            <StatTile value={money(closing)} label="Ends at" />
          </div>

          {nothingComing ? (
            <Callout>
              Nothing is committed and nothing is forecast to be produced, so there is no money coming in to
              project. Standing orders are set on <Link to="/store/customers">Customers</Link>, and production
              feeds in from <Link to="/store/products">Products</Link>.
            </Callout>
          ) : (
            <>
              <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                Week by week
              </div>

              <p className="cash-carried">
                Opening on <strong className="mono">{money(cashNow)}</strong> — what is in the accounts today. The
                balance below counts <strong>committed</strong> money only: standing orders on the books and
                what is owed on reserved orders.
              </p>

              <GridRow cols={COLS} mobileCols={COLS_SM} as="header">
                <span>Week</span>
                <span className="text-right hide-sm">Standing</span>
                <span className="text-right hide-sm">Orders</span>
                <span className="text-right hide-sm">Out</span>
                <span className="text-right">Net</span>
                <span className="text-right">Cash after</span>
              </GridRow>

              {forecast.weeks.map((w) => (
                /* Only the week it *first* goes under is marked. Tinting
                   every negative week turns thirteen rows into one block and
                   hides the one you can still do something about. */
                <GridRow
                  key={w.start}
                  cols={COLS}
                  mobileCols={COLS_SM}
                  as="body"
                  highlight={w.start === forecast.firstShortWeek}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 15 }}>{weekLabel(w.start, w.end)}</span>
                    {/* Expected sales sit here and never in the balance: real
                        product, but it assumes a buyer. */}
                    {w.expected > 0 && (
                      <div className="cash-spare">
                        spare could add {dollars(w.expected)} → {dollars(w.closingWithExpected)}
                      </div>
                    )}
                  </span>
                  <span className="mono text-right hide-sm">{w.standing ? money(w.standing) : "—"}</span>
                  <span className="mono text-right hide-sm">{w.reserved ? money(w.reserved) : "—"}</span>
                  <span
                    className="mono text-right hide-sm"
                    style={{ color: w.payments ? "var(--red)" : undefined }}
                  >
                    {w.payments ? money(w.payments) : "—"}
                  </span>
                  <span className="mono text-right">{money(w.net)}</span>
                  <span
                    className="mono text-right"
                    style={{ fontWeight: 500, color: w.closing < 0 ? "var(--red)" : undefined }}
                  >
                    {money(w.closing)}
                  </span>
                </GridRow>
              ))}

              {/* ── what the figures rest on ── */}
              <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                What this rests on
              </div>

              <ul className="cash-basis">
                <li>
                  <strong>Cash on hand</strong> is the ledger's, across{" "}
                  {balances.length === 1 ? "one account" : `${balances.length} accounts`} — the same figure the{" "}
                  <Link to="/books/balance-sheet">Balance sheet</Link> reads.
                </li>
                <li>
                  <strong>Standing orders</strong> are priced from each product's current price. A product with no
                  price contributes nothing rather than a zero that looks like a decision.
                </li>
                <li>
                  <strong>Orders</strong> counts what is still owed on reserved orders only. Completed ones are
                  settled and cancelled ones are not coming.
                  {forecast.unpricedOrders > 0 && (
                    <>
                      {" "}
                      {forecast.unpricedOrders === 1
                        ? "One reserved order carries no price"
                        : `${forecast.unpricedOrders} reserved orders carry no price`}{" "}
                      at all, so {forecast.unpricedOrders === 1 ? "it is" : "they are"} not counted — that money is
                      real and this forecast cannot see it.
                    </>
                  )}
                </li>
                <li>
                  <strong>Out</strong> is{" "}
                  {forecast.paymentsBasis === "history" ? (
                    <>
                      an average of what has actually been spent over the last 13 weeks, not a schedule of known
                      bills. There is no scheduled-cost data on this farm, so this is a rate rather than a
                      commitment.
                    </>
                  ) : (
                    <>
                      nothing, because nothing has been spent in the last 13 weeks. Until there is history to
                      average, this page counts money coming in and nothing going out — treat the balance as a
                      ceiling.
                    </>
                  )}
                </li>
                <li>
                  <strong>Spare</strong> is production beyond what is already promised, at price. It is never in
                  the balance: it is product, not a sale, and counting it would tell you that you are fine when
                  you are only fine if every unit finds a buyer.
                </li>
              </ul>

              {/* ── where it sits now ── */}
              <div className="serif" style={{ fontSize: 21, margin: "32px 0 12px" }}>
                Where it sits today
              </div>

              <GridRow cols={ACC_COLS} as="header">
                <span>Account</span>
                <span className="text-right">Balance</span>
              </GridRow>

              {balances.map((b) => (
                <GridRow key={b.account} cols={ACC_COLS} as="body">
                  <span style={{ minWidth: 0, fontSize: 15 }}>
                    {b.account}
                    {b.unlisted && (
                      <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                        {" "}
                        · named by entries, not on the account list
                      </span>
                    )}
                  </span>
                  <span className="mono text-right" style={{ color: b.balance < 0 ? "var(--red)" : undefined }}>
                    {money(b.balance)}
                  </span>
                </GridRow>
              ))}

              <GridRow cols={ACC_COLS} as="body">
                <span style={{ fontSize: 15, fontWeight: 500 }}>Cash on hand</span>
                <span className="mono text-right" style={{ fontWeight: 500 }}>
                  {money(cashNow)}
                </span>
              </GridRow>

              <p style={{ fontSize: 13, color: "var(--ink-muted)", paddingTop: 24 }}>
                A forecast, not a measurement. For what has already happened, see{" "}
                <Link to="/books/reports">Reports</Link>.
              </p>
            </>
          )}
        </>
      )}
    </OpsShell>
  );
}
