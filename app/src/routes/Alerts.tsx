import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Button, InfoTip, Pill } from "../components/ui";
import { buildAlerts, fetchAlertInputs, KIND_LABEL, RULES, whenInWords, type Alert, type Urgency } from "../lib/alerts";
import {
  agoInWords,
  describeStoreEvent,
  fetchSeenStoreActivity,
  fetchStoreActivity,
  markStoreActivitySeen,
  markStoreEventSeen,
  markStoreEventUnseen,
  STORE_KIND_LABEL,
  type StoreEvent,
} from "../lib/store-alerts";
import { useWorkspace } from "../lib/workspace";
import "./alerts.css";

/**
 * Everything that needs attention, in two groups that look alike: the farm
 * store's and the herd's.
 *
 * Every row says the same four things in the same places — what kind of
 * thing it is, what happened, when, and what can be done about it from here
 * — so the eye learns one row and reads the rest. The herd's rules live in
 * lib/alerts.ts and are pure; the store's events in lib/store-alerts.ts.
 *
 * The two differ in how a row goes away, and the page doesn't hide that: a
 * store row is news and stays until it's marked seen; a herd row is a
 * condition and goes when the thing is done, so it has nothing to press.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; items: T[] };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function Alerts() {
  const { business, role, modules } = useWorkspace();
  const hearsFromStore = !!business && role === "owner" && modules.includes("store");

  return (
    <OpsShell searchPlaceholder="A cow, a date…">
      <PageHeader eyebrow={business ? business.name : "Herd"} title="Alerts" />
      <div className="alerts">
        {hearsFromStore && business && <StoreAlerts businessId={business.id} />}
        <HerdAlerts />
      </div>
    </OpsShell>
  );
}

/* ── the two groups ─────────────────────────────────────────────────── */

/**
 * What customers did in the farm store since the farmer last looked: a
 * reservation, a new weekly pickup, a pickup they confirmed. These don't
 * resolve themselves, so they stay until cleared — one at a time from its
 * own row, or the lot. Cleared ones can be shown again underneath, and any
 * of them put back on the list.
 */
function StoreAlerts({ businessId }: { businessId: number }) {
  const [load, setLoad] = useState<Load<StoreEvent>>({ state: "loading" });
  // The seen ones are only read when asked for: most visits don't want them.
  const [showSeen, setShowSeen] = useState(false);
  const [seen, setSeen] = useState<Load<StoreEvent>>({ state: "loading" });
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The rows whose own button is on its way, so a second tap does nothing.
  const [busy, setBusy] = useState<Set<number>>(new Set());

  const loadNew = useCallback(
    () =>
      fetchStoreActivity(businessId)
        .then((a) => setLoad({ state: "ok", items: a.events }))
        .catch((err) => setLoad({ state: "error", message: message(err) })),
    [businessId],
  );
  const loadSeen = useCallback(
    () =>
      fetchSeenStoreActivity(businessId)
        .then((a) => setSeen({ state: "ok", items: a.events }))
        .catch((err) => setSeen({ state: "error", message: message(err) })),
    [businessId],
  );

  useEffect(() => {
    setLoad({ state: "loading" });
    void loadNew();
  }, [loadNew]);

  useEffect(() => {
    if (!showSeen) return;
    setSeen({ state: "loading" });
    void loadSeen();
  }, [showSeen, loadSeen]);

  const events = load.state === "ok" ? load.items : [];

  /** Do it, then read both lists again — a row moves from one to the other,
   *  and reading is the one way to be sure each says what the database does. */
  const act = async (id: number | null, change: () => Promise<void>) => {
    if (id !== null) setBusy((s) => new Set(s).add(id));
    else setClearing(true);
    setActionError(null);
    try {
      await change();
      await Promise.all([loadNew(), showSeen ? loadSeen() : null]);
    } catch (err) {
      setActionError(message(err));
    } finally {
      if (id !== null)
        setBusy((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      else setClearing(false);
    }
  };

  // Through the newest one listed, so anything arriving meanwhile stays.
  const clearAll = () => events.length > 0 && act(null, () => markStoreActivitySeen(businessId, events[0].at));

  return (
    <AlertGroup
      title="Farm store"
      load={load}
      empty="Nothing new since you last looked."
      error={actionError && `Couldn't change that: ${actionError}`}
      action={
        events.length > 0 && (
          <Button size="sm" onClick={clearAll} disabled={clearing}>
            {clearing ? "Clearing…" : "Mark all as seen"}
          </Button>
        )
      }
      footer={
        <>
          <button
            type="button"
            className="alert-group__more"
            aria-expanded={showSeen}
            onClick={() => setShowSeen((v) => !v)}
          >
            {showSeen ? "Hide seen" : "Show seen"}
          </button>
          {showSeen && (
            <div className="alert-group__seen" role="group" aria-label="Seen">
              {seen.state === "loading" && <p className="alert-group__note">Loading…</p>}
              {seen.state === "error" && (
                <p className="alert-group__note alert-group__note--error">Couldn't load these: {seen.message}</p>
              )}
              {seen.state === "ok" && seen.items.length === 0 && (
                <p className="alert-group__note">Nothing marked seen yet.</p>
              )}
              {seen.state === "ok" &&
                seen.items.map((e) => (
                  <StoreLine
                    key={e.id}
                    event={e}
                    seen
                    busy={clearing || busy.has(e.id)}
                    onPress={() => act(e.id, () => markStoreEventUnseen(e.id))}
                  />
                ))}
            </div>
          )}
        </>
      }
    >
      {events.map((e) => (
        <StoreLine
          key={e.id}
          event={e}
          busy={clearing || busy.has(e.id)}
          onPress={() => act(e.id, () => markStoreEventSeen(e.id))}
        />
      ))}
    </AlertGroup>
  );
}

/** A store alert in the shared row: "Seen" on a new one, "Unseen" on one
 *  already seen, which also says when it was. */
function StoreLine({
  event,
  seen = false,
  busy,
  onPress,
}: {
  event: StoreEvent;
  seen?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const { title, detail, href } = describeStoreEvent(event);
  return (
    <AlertLine
      kind={STORE_KIND_LABEL[event.kind]}
      title={title}
      detail={seen && event.seenAt ? `${detail} · seen ${agoInWords(event.seenAt)}` : detail}
      href={href}
      when={agoInWords(event.at)}
      tone={seen ? "muted" : "ink"}
      faded={seen}
      action={
        <Button size="sm" onClick={onPress} disabled={busy} aria-label={`${seen ? "Mark unseen" : "Mark seen"}: ${title}`}>
          {seen ? "Unseen" : "Seen"}
        </Button>
      }
    />
  );
}

/** How late a herd row is, in the colour of its "when": red for past or this
 *  week, ochre for due, quiet for coming up. One column carries the urgency
 *  that three headings and three counters used to. */
const URGENCY_TONE: Record<Urgency, Tone> = { now: "red", soon: "ochre", watch: "muted" };

function HerdAlerts() {
  const { farmId } = useWorkspace();
  const [load, setLoad] = useState<Load<Alert>>({ state: "loading" });

  const refresh = useCallback(async () => {
    if (!farmId) return setLoad({ state: "ok", items: [] });
    const input = await fetchAlertInputs(farmId, todayIso());
    setLoad({ state: "ok", items: buildAlerts(input) });
  }, [farmId]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    refresh().catch((err) => !cancelled && setLoad({ state: "error", message: message(err) }));
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return (
    <AlertGroup
      title="Herd"
      load={load}
      empty="Nothing needs doing."
      tip={
        <InfoTip label="How the herd's dates are worked out">
          A service is worth checking from {RULES.checkDueDays} days and overdue at {RULES.checkLateDays}; a calving
          appears {RULES.dueSoonDays} days out. The breeding date is her calving plus the farm's voluntary waiting
          period — one setting, not a number written into the code, so changing it moves every date here. A herd
          alert goes away when the thing is done and recorded.
        </InfoTip>
      }
    >
      {load.state === "ok" &&
        load.items.map((a) => (
          <AlertLine
            key={a.id}
            kind={KIND_LABEL[a.kind]}
            title={a.title}
            detail={a.earTag ? `Tag ${a.earTag} · ${a.detail}` : a.detail}
            href={a.href}
            when={whenInWords(a.daysLate)}
            tone={URGENCY_TONE[a.urgency]}
          />
        ))}
    </AlertGroup>
  );
}

/* ── the shared shape ───────────────────────────────────────────────── */

function AlertGroup<T>({
  title,
  load,
  empty,
  error,
  action,
  tip,
  footer,
  children,
}: {
  title: string;
  load: Load<T>;
  empty: string;
  error?: string | null;
  action?: ReactNode;
  tip?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="alert-group" aria-label={title}>
      <div className="alert-group__head">
        <h2 className="alert-group__title">{title}</h2>
        {load.state === "ok" && <span className="mono alert-group__count">{load.items.length}</span>}
        {tip}
        <span className="alert-group__action">{action}</span>
      </div>
      {load.state === "loading" && <p className="alert-group__note">Loading…</p>}
      {load.state === "error" && (
        <p className="alert-group__note alert-group__note--error">Couldn't load these: {load.message}</p>
      )}
      {error && <p className="alert-group__note alert-group__note--error">{error}</p>}
      {load.state === "ok" && load.items.length === 0 && <p className="alert-group__note">{empty}</p>}
      {children}
      {footer}
    </section>
  );
}

type Tone = "ink" | "red" | "ochre" | "muted";

/**
 * One alert, of either kind. The text is the link, stretched over the whole
 * row so a click anywhere goes where the row says; the action sits above it,
 * because a button can't sit inside a link. A row with no action keeps the
 * column, so every "when" lines up down the page.
 */
function AlertLine({
  kind,
  title,
  detail,
  href,
  when,
  tone,
  faded = false,
  action,
}: {
  kind: string;
  title: string;
  detail: string;
  href: string;
  when: string;
  tone: Tone;
  /** Already dealt with — shown for looking back over, so set back a step. */
  faded?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={`alert-row${faded ? " alert-row--faded" : ""}`}>
      {/* Plain, always. The pill names a category, not a severity — the
          "when" carries the urgency. */}
      <span className="alert-row__kind">
        <Pill variant="outline">{kind}</Pill>
      </span>
      <Link to={href} className="alert-row__body">
        <span className="alert-row__title">{title}</span>
        <span className="alert-row__detail">{detail}</span>
      </Link>
      <span className={`mono alert-row__when alert-row__when--${tone}`}>{when}</span>
      <span className="alert-row__action">{action}</span>
    </div>
  );
}
