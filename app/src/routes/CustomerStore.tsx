import { useCallback, useEffect, useState } from "react";
import { CustomerShell, type CustomerTab } from "../components/shell/CustomerShell";
import { CustomerAuth } from "../components/auth/CustomerAuth";
import { Button, Callout, Pill } from "../components/ui";
import { useAuth, signOut } from "../lib/auth";
import {
  cancelOrder,
  fetchMyOrders,
  fetchProfile,
  fetchShop,
  outstanding,
  reserve,
  type CustomerOrder,
  type CustomerProfile,
  type ShopProduct,
} from "../lib/customer";
import {
  cancelSchedule,
  createSchedule,
  fetchMySchedules,
  fulfilPickup,
  isHeld,
  nextPickup,
  skipWeek,
  untilLabel,
  WEEKDAYS,
  type Schedule,
  type Weekday,
} from "../lib/schedules";
import { amountDue, completePickup, validateCollection } from "../lib/orders";
import { fetchPaymentMethods, methodCodes, type PaymentMethodOption } from "../lib/payment-methods";
import "./customer-store.css";

type Fetch =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      products: ShopProduct[];
      orders: CustomerOrder[];
      schedules: Schedule[];
      profile: CustomerProfile | null;
      methods: PaymentMethodOption[];
    };

/** Which thing on the Pickup tab is being handed over right now. Orders and
 * standing orders share the panel but not their id space, so the kind is
 * part of the key. */
type Collecting = { kind: "order" | "schedule"; id: number } | null;

const price = (n: number | null, unit: string) => (n === null ? `— per ${unit}` : `$${Number(n).toFixed(2)} per ${unit}`);

const money = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);

/** "Cash, Venmo or Check" — the payment list read as a sentence rather than
 * as a comma-separated dump. */
const orList = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

export default function CustomerStore() {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;

  const [result, setResult] = useState<Fetch>({ state: "loading" });
  const [qty, setQty] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Which product's "every week" panel is open, and what it's set to.
  const [subscribing, setSubscribing] = useState<number | null>(null);
  const [subDay, setSubDay] = useState<string>("Thursday");
  const [subQty, setSubQty] = useState("");
  const [tab, setTab] = useState<CustomerTab>("Store");
  // Confirming a collection: what's being handed over, how much of it, and
  // how it was paid for.
  const [collecting, setCollecting] = useState<Collecting>(null);
  const [collectQty, setCollectQty] = useState("");
  const [collectMethod, setCollectMethod] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    const [products, orders, schedules, profile, methods] = await Promise.all([
      fetchShop(),
      fetchMyOrders(userId),
      fetchMySchedules(userId),
      // The account tab needs a name to show. A missing profile is not an
      // error — the row is created by a trigger and may lag a fresh signup.
      fetchProfile(userId).catch(() => null),
      fetchPaymentMethods(),
    ]);
    setResult({ state: "ok", products, orders, schedules, profile, methods });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    load().catch(
      (err) => !cancelled && setResult({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [userId, load]);

  if (authLoading) {
    return (
      <CustomerShell>
        <p style={{ padding: 24, fontSize: 14, color: "var(--ink-muted)" }}>Loading…</p>
      </CustomerShell>
    );
  }

  // The storefront needs to know who's collecting, so it asks before showing
  // anything rather than letting someone fill a basket and hit a wall.
  if (!session) return <CustomerAuth />;

  const handleSubscribe = async (product: ShopProduct) => {
    if (!userId) return;
    const quantity = Number(subQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setActionError("How much do you want every week?");
      return;
    }
    setBusyId(product.id);
    setActionError(null);
    try {
      await createSchedule({
        // business_id comes off the product, matching how the database
        // scopes a one-off order.
        businessId: product.business_id,
        customerId: userId,
        productId: product.id,
        quantity,
        day: subDay as Weekday,
        startDate: null,
      });
      await load();
      setSubscribing(null);
      setSubQty("");
      setNotice(`Every ${subDay}: ${quantity} ${product.unit} of ${product.name.toLowerCase()}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleSkip = async (schedule: Schedule, date: string) => {
    setBusyId(schedule.id);
    setActionError(null);
    try {
      await skipWeek(schedule, date);
      await load();
      setNotice(`Skipped ${date}. The week after is unchanged.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleStopSchedule = async (schedule: Schedule) => {
    setBusyId(schedule.id);
    setActionError(null);
    try {
      await cancelSchedule(schedule.id);
      await load();
      setNotice("Weekly pickup stopped.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReserve = async (product: ShopProduct) => {
    if (!userId) return;
    const raw = qty[product.id];
    const quantity = raw ? Number(raw) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    setBusyId(product.id);
    setActionError(null);
    setNotice(null);
    try {
      await reserve({ productId: product.id, quantity });
      setQty((q) => ({ ...q, [product.id]: "" }));
      await load();
      setNotice(`Reserved ${quantity} ${product.unit} of ${product.name}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (order: CustomerOrder) => {
    setBusyId(order.id);
    setActionError(null);
    setNotice(null);
    try {
      await cancelOrder(order.id);
      await load();
      setNotice("Reservation cancelled.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const products = result.state === "ok" ? result.products : [];
  const methods = result.state === "ok" ? result.methods : [];
  const orders = result.state === "ok" ? result.orders : [];
  const open = orders.filter((o) => !o.cancelled_date && !o.picked_up_date);
  const schedules = result.state === "ok" ? result.schedules : [];
  const activeSchedules = schedules.filter((s) => s.cancelled_at === null);
  const today = new Date().toISOString().slice(0, 10);
  const past = orders.filter((o) => o.cancelled_date || o.picked_up_date);
  const profile = result.state === "ok" ? result.profile : null;
  const profileName =
    `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() ||
    profile?.email ||
    session?.user.email ||
    "Your account";
  const collected = orders.filter((o) => o.picked_up_date);
  const spent = Math.round(collected.reduce((sum, o) => sum + Number(o.total_cost ?? 0), 0) * 100) / 100;

  const productName = (id: number) => products.find((p) => p.id === id)?.name ?? "Item";
  const productUnit = (id: number) => products.find((p) => p.id === id)?.unit ?? "";
  const productPrice = (id: number) => products.find((p) => p.id === id)?.price ?? null;

  const startCollect = (target: NonNullable<Collecting>, quantity: number) => {
    setCollecting(target);
    // Pre-filled with the whole thing — taking less is the correction, not
    // the normal case.
    setCollectQty(String(quantity));
    // The method deliberately isn't. A default here is a default answer to
    // "how did you pay", and the books would carry it as though someone had
    // said so.
    setCollectMethod("");
    setActionError(null);
    setNotice(null);
  };

  const collectProblem = (ordered: number) =>
    validateCollection({
      ordered,
      quantity: collectQty,
      paymentMethod: collectMethod,
      allowed: methodCodes(methods),
    });

  /**
   * Hand-over, from the customer's side. The two paths write the same row in
   * the end — complete_scheduled_pickup creates a completed order — so the
   * form and its rules are shared and only the call differs.
   */
  const handleCollect = async (input: {
    target: NonNullable<Collecting>;
    productId: number;
    ordered: number;
  }) => {
    if (collectProblem(input.ordered)) return;
    const quantity = Number(collectQty);
    const paid = amountDue(productPrice(input.productId), quantity);

    setBusyId(input.target.id);
    setActionError(null);
    try {
      if (input.target.kind === "order") {
        await completePickup({
          orderId: input.target.id,
          finalQuantity: quantity,
          paymentMethod: collectMethod,
          amountPaid: paid,
        });
      } else {
        await fulfilPickup({
          scheduleId: input.target.id,
          quantity,
          paymentMethod: collectMethod,
          amountPaid: paid,
        });
      }
      await load();
      setCollecting(null);
      setNotice(
        `Collected ${quantity} ${productUnit(input.productId)} of ${productName(input.productId).toLowerCase()}${
          paid === null ? "" : ` — ${money(paid)} by ${collectMethod.toLowerCase()}`
        }.`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <CustomerShell
      activeTab={tab}
      onTabChange={setTab}
      counts={{ Pickup: open.length + activeSchedules.length }}
    >
      {tab === "Store" && (
        <>
      <div className="shop-hero">
        <div className="eyebrow">
          {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        </div>
        <div className="serif shop-hero__title">Fresh today</div>
        {/* The methods come off the table rather than being written into the
            sentence, so adding one doesn't leave this line lying. */}
        <p className="shop-hero__lede text-wrap-pretty">
          Reserve what you want and pick it up at the farm.
          {methods.length > 0 && ` Pay by ${orList(methods.map((m) => m.label))} when you collect.`}
        </p>
      </div>

      {result.state === "loading" && (
        <p style={{ padding: 24, fontSize: 14, color: "var(--ink-muted)" }}>Loading the store…</p>
      )}
      {result.state === "error" && (
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 14, color: "var(--red)" }}>Couldn't load the store: {result.message}</p>
        </div>
      )}

      {(notice || actionError) && (
        <div style={{ padding: "16px 16px 0" }}>
          {notice && <p style={{ fontSize: 13, color: "var(--herd-green)" }}>{notice}</p>}
          {actionError && (
            <>
              <p style={{ fontSize: 13, color: "var(--red)" }}>{actionError}</p>
            </>
          )}
        </div>
      )}

      {result.state === "ok" &&
        products.map((p) => {
          const soldOut = p.available <= 0;
          return (
            <div className={`shop-product ${soldOut ? "shop-product--muted" : ""}`} key={p.id}>
              <div className="shop-product__top">
                <div>
                  <div className="serif shop-product__name" style={soldOut ? { color: "var(--ink-muted)" } : undefined}>
                    {p.name}
                  </div>
                  <div className="mono shop-product__price">{price(p.price, p.unit)}</div>
                </div>
                {soldOut ? (
                  <Pill variant="outline">Sold out</Pill>
                ) : (
                  <div className="mono shop-product__qty">
                    <div className="shop-product__qty-num">{p.available}</div>
                    <div className="shop-product__qty-label">{p.unit} left</div>
                  </div>
                )}
              </div>

              {soldOut ? (
                <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 12 }}>
                  Nothing on hand right now — check back after the next batch.
                </p>
              ) : (
                <div className="shop-product__actions">
                  <input
                    className="shop-qty-field"
                    type="number"
                    min="1"
                    max={p.available}
                    placeholder="Qty"
                    value={qty[p.id] ?? ""}
                    onChange={(e) => setQty((q) => ({ ...q, [p.id]: e.target.value }))}
                    aria-label={`Quantity of ${p.name}`}
                  />
                  <button className="shop-reserve-btn" onClick={() => void handleReserve(p)} disabled={busyId === p.id}>
                    {busyId === p.id ? "Reserving…" : "Reserve"}
                  </button>
                </div>
              )}

              {/* Every week, rather than once. Offered even when the shelf is
                  empty today: a standing order is a commitment to future
                  weeks, and the weeks you most want to lock in are the ones
                  where stock is tight. */}
              {subscribing === p.id ? (
                <div className="shop-subscribe">
                  <div className="shop-subscribe__row">
                    <input
                      className="shop-qty-field"
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="Qty"
                      value={subQty}
                      onChange={(e) => setSubQty(e.target.value)}
                      aria-label={`Weekly quantity of ${p.name}`}
                    />
                    <select
                      className="shop-qty-field"
                      value={subDay}
                      onChange={(e) => setSubDay(e.target.value)}
                      aria-label="Pickup day"
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {d}s
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="shop-subscribe__row">
                    <button
                      className="shop-reserve-btn"
                      onClick={() => void handleSubscribe(p)}
                      disabled={busyId === p.id}
                    >
                      {busyId === p.id ? "Starting…" : "Start weekly pickup"}
                    </button>
                    <Button onClick={() => setSubscribing(null)}>Cancel</Button>
                  </div>
                  <p className="shop-subscribe__note">
                    Same pickup every week until you stop it. You can skip any week.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  className="shop-subscribe-link"
                  onClick={() => {
                    setSubscribing(p.id);
                    setSubQty("");
                    setActionError(null);
                  }}
                >
                  or get it every week →
                </button>
              )}
            </div>
          );
        })}

      {result.state === "ok" && products.length === 0 && (
        <p style={{ padding: 24, fontSize: 14, color: "var(--ink-muted)" }}>Nothing in the store just now.</p>
      )}
        </>
      )}

      {tab === "Pickup" && (
        <>
      {(notice || actionError) && (
        <div style={{ padding: "16px 16px 0" }}>
          {notice && <p style={{ fontSize: 13, color: "var(--herd-green)" }}>{notice}</p>}
          {actionError && <p style={{ fontSize: 13, color: "var(--red)" }}>{actionError}</p>}
        </div>
      )}

      {open.length === 0 && activeSchedules.length === 0 && (
        <div className="shop-empty">
          <div className="serif" style={{ fontSize: 21, marginBottom: 6 }}>
            Nothing waiting
          </div>
          <p className="text-wrap-pretty">
            Anything you reserve, and any weekly pickup you start, shows up here.
          </p>
        </div>
      )}

      {activeSchedules.length > 0 && (
        <>
          <div className="shop-pickups-title serif">Every week</div>
          {activeSchedules.map((sch) => {
            const next = nextPickup(sch, today);
            // Collectable once the stock is being held for it — the same
            // three-day window the shop stops selling it in, so what's on the
            // shelf and what this offers can't disagree.
            const due = isHeld(sch, today);
            const isCollecting = collecting?.kind === "schedule" && collecting.id === sch.id;
            return (
              <div className="shop-pickup" key={`sched-${sch.id}`}>
                <div className="shop-product__top">
                  <div>
                    <div className="serif shop-product__name">
                      {sch.quantity} {productUnit(sch.product_id)} {productName(sch.product_id).toLowerCase()}
                    </div>
                    <div className="mono shop-product__price">
                      Every {sch.day} · next {next ?? "—"} ({untilLabel(next, today)})
                    </div>
                  </div>
                  <Pill variant="outline-green">weekly</Pill>
                </div>
                {isCollecting ? (
                  <CollectForm
                    name={productName(sch.product_id)}
                    unit={productUnit(sch.product_id)}
                    ordered={sch.quantity}
                    price={productPrice(sch.product_id)}
                    methods={methods}
                    quantity={collectQty}
                    onQuantity={setCollectQty}
                    method={collectMethod}
                    onMethod={setCollectMethod}
                    problem={collectProblem(sch.quantity)}
                    busy={busyId === sch.id}
                    onConfirm={() =>
                      void handleCollect({
                        target: { kind: "schedule", id: sch.id },
                        productId: sch.product_id,
                        ordered: sch.quantity,
                      })
                    }
                    onCancel={() => setCollecting(null)}
                  />
                ) : (
                  <>
                    {due && (
                      <div className="shop-product__actions">
                        <button
                          className="shop-reserve-btn"
                          onClick={() => startCollect({ kind: "schedule", id: sch.id }, sch.quantity)}
                        >
                          I've picked this up
                        </button>
                      </div>
                    )}
                    <div className="shop-product__actions">
                      <Button
                        onClick={() => next && void handleSkip(sch, next)}
                        disabled={busyId === sch.id || !next}
                        style={{ flex: 1 }}
                      >
                        Skip {next ? next.slice(5) : "next"}
                      </Button>
                      <Button
                        onClick={() => void handleStopSchedule(sch)}
                        disabled={busyId === sch.id}
                        style={{ flex: 1 }}
                      >
                        Stop
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}

      <div className="shop-pickups-title serif">Your pickups</div>
      {open.length === 0 && (
        <p style={{ padding: "0 16px 16px", fontSize: 14, color: "var(--ink-muted)" }}>
          Nothing reserved yet.
        </p>
      )}
      {open.map((o) => {
        const isCollecting = collecting?.kind === "order" && collecting.id === o.id;
        return (
          <div className="shop-pickup" key={o.id}>
            <div className="shop-product__top">
              <div>
                <div className="serif shop-product__name">
                  {o.quantity} {productUnit(o.product_id)} {productName(o.product_id).toLowerCase()}
                </div>
                <div className="mono shop-product__price">
                  {o.reserved_date ? `Reserved ${new Date(o.reserved_date).toLocaleDateString()}` : o.status} · pay at
                  pickup
                </div>
              </div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 500, flex: "none" }}>
                {money(o.total_cost === null ? amountDue(productPrice(o.product_id), o.quantity) : Number(o.total_cost))}
              </div>
            </div>
            {isCollecting ? (
              <CollectForm
                name={productName(o.product_id)}
                unit={productUnit(o.product_id)}
                ordered={o.quantity}
                price={productPrice(o.product_id)}
                methods={methods}
                quantity={collectQty}
                onQuantity={setCollectQty}
                method={collectMethod}
                onMethod={setCollectMethod}
                problem={collectProblem(o.quantity)}
                busy={busyId === o.id}
                onConfirm={() =>
                  void handleCollect({
                    target: { kind: "order", id: o.id },
                    productId: o.product_id,
                    ordered: o.quantity,
                  })
                }
                onCancel={() => setCollecting(null)}
              />
            ) : (
              <div className="shop-product__actions">
                <button
                  className="shop-reserve-btn"
                  onClick={() => startCollect({ kind: "order", id: o.id }, o.quantity)}
                >
                  I've picked this up
                </button>
                <Button onClick={() => void handleCancel(o)} disabled={busyId === o.id} style={{ flex: 1 }}>
                  {busyId === o.id ? "Cancelling…" : "Cancel"}
                </Button>
              </div>
            )}
          </div>
        );
      })}

        </>
      )}

      {tab === "Account" && (
        <>
      <div className="shop-account">
        <div className="serif" style={{ fontSize: 21, marginBottom: 4 }}>
          {profileName}
        </div>
        <div className="shop-account__rows">
          {profile?.email && (
            <div className="shop-account__row">
              <span className="eyebrow">Email</span>
              <span>{profile.email}</span>
            </div>
          )}
          {profile?.phone && (
            <div className="shop-account__row">
              <span className="eyebrow">Phone</span>
              <span>{profile.phone}</span>
            </div>
          )}
          <div className="shop-account__row">
            <span className="eyebrow">Collected</span>
            <span>
              {collected.length} order{collected.length === 1 ? "" : "s"}
              {spent > 0 && ` · $${spent.toFixed(2)}`}
            </span>
          </div>
        </div>
      </div>

      {past.length > 0 && (
        <>
          <div className="shop-pickups-title serif" style={{ fontSize: 21 }}>
            History
          </div>
          {past.map((o) => {
            const gap = outstanding(o);
            return (
              <div className="shop-pickup" key={o.id}>
                <div className="shop-product__top">
                  <div>
                    <div className="serif shop-product__name" style={{ color: "var(--ink-muted)" }}>
                      {o.quantity} {productUnit(o.product_id)} {productName(o.product_id).toLowerCase()}
                    </div>
                    <div className="mono shop-product__price">
                      {o.cancelled_date
                        ? "Cancelled"
                        : `Collected ${new Date(o.picked_up_date!).toLocaleDateString()}`}
                      {o.payment_method && ` · ${o.payment_method}`}
                    </div>
                  </div>
                  {/* Only on a collected order. A cancellation cost nothing,
                      and an unpriced one shows a dash rather than $0.00 —
                      four of the completed orders on this farm have no price
                      at all, and calling those free would be a claim. */}
                  {o.picked_up_date && (
                    <div className="mono shop-history__cost">
                      {money(o.total_cost === null ? null : Number(o.total_cost))}
                      {gap !== null && gap !== 0 && (
                        <div className="shop-history__gap">
                          {gap > 0 ? `$${gap.toFixed(2)} still owed` : `$${Math.abs(gap).toFixed(2)} over`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div className="shop-note">
        <Callout>
          Nothing from an animal under treatment ever reaches a bottle.
        </Callout>
        <button
          onClick={() => void signOut()}
          style={{
            background: "none",
            border: "none",
            color: "var(--herd-green)",
            fontSize: 13,
            marginTop: 16,
            padding: 0,
          }}
        >
          Sign out
        </button>
      </div>
        </>
      )}
    </CustomerShell>
  );
}

/**
 * Confirming a hand-over: what it was, how much of it, and how it was paid
 * for. Shared by a one-off reservation and a week of a standing order,
 * because from the database's side they finish as the same completed order.
 *
 * The product is shown, not chosen — a customer confirms what they came for
 * rather than picking from a list, and the amount follows from the price
 * rather than being typed, so the two things they can actually get wrong are
 * the quantity and the payment method.
 */
function CollectForm({
  name,
  unit,
  ordered,
  price,
  methods,
  quantity,
  onQuantity,
  method,
  onMethod,
  problem,
  busy,
  onConfirm,
  onCancel,
}: {
  name: string;
  unit: string;
  ordered: number;
  price: number | null;
  methods: PaymentMethodOption[];
  quantity: string;
  onQuantity: (v: string) => void;
  method: string;
  onMethod: (v: string) => void;
  problem: string | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const typed = Number(quantity);
  const due = Number.isFinite(typed) && typed > 0 ? amountDue(price, typed) : null;
  const short = Number.isFinite(typed) && typed > 0 && typed < ordered;

  return (
    <div className="shop-collect">
      <div className="shop-collect__what serif">
        {name}
        <span className="mono shop-collect__ordered"> · {ordered} {unit} due</span>
      </div>

      <div className="shop-subscribe__row">
        <label className="shop-collect__field">
          <span className="eyebrow">Picked up</span>
          <input
            className="shop-qty-field"
            type="number"
            min="0"
            max={ordered}
            step="0.001"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => onQuantity(e.target.value)}
            aria-label={`Quantity of ${name} picked up`}
          />
        </label>
        <label className="shop-collect__field">
          <span className="eyebrow">Paid by</span>
          <select
            className="shop-qty-field"
            value={method}
            onChange={(e) => onMethod(e.target.value)}
            aria-label="How you paid"
          >
            <option value="">Choose…</option>
            {methods.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Both facts on one line, and not in the message below: that one is
          taken over by whatever is wrong, and "the rest goes back on the
          shelf" is exactly the thing you'd want to still be able to see
          while you fix something else. */}
      <div className="shop-collect__due mono">
        {due === null ? "No price set — the farm will sort this out." : `That's $${due.toFixed(2)}.`}
        {short && ` ${Math.round((ordered - typed) * 1000) / 1000} ${unit} goes back on the shelf.`}
      </div>

      <div className="shop-subscribe__row">
        <button className="shop-reserve-btn" onClick={onConfirm} disabled={busy || problem !== null}>
          {busy ? "Saving…" : "Confirm pickup"}
        </button>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      <p className="shop-subscribe__note" style={problem ? { color: "var(--red)" } : undefined}>
        {problem ?? "Confirm this once you've actually got it and paid."}
      </p>
    </div>
  );
}
