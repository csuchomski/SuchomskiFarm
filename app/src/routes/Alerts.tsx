import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { OpsShell, PageHeader } from "../components/shell/OpsShell";
import { Callout, EarTag, Pill, StatTile } from "../components/ui";
import {
  buildAlerts,
  fetchAlertInputs,
  KIND_LABEL,
  RULES,
  whenInWords,
  type Alert,
  type Urgency,
} from "../lib/alerts";
import { useWorkspace } from "../lib/workspace";
import "./alerts.css";

/**
 * Everything that needs attention, with the day it needed it.
 *
 * The rules live in lib/alerts.ts and are pure. This page is a list — the
 * only thinking it does is which heading a row goes under.
 *
 * There are no notifications behind this. It is a page that is right whenever
 * you look at it, which is the thing that has to exist before anything can be
 * worth sending.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; alerts: Alert[] };

const BANDS: { urgency: Urgency; heading: string; blurb: string }[] = [
  { urgency: "now", heading: "Now", blurb: "Past the day it should have happened, or happening this week." },
  { urgency: "soon", heading: "Soon", blurb: "Due, and worth planning the week around." },
  { urgency: "watch", heading: "Coming up", blurb: "Nothing to do today — here so it isn't a surprise." },
];

export default function Alerts() {
  const { business, farmId } = useWorkspace();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    if (!farmId) {
      setLoad({ state: "ok", alerts: [] });
      return;
    }
    const input = await fetchAlertInputs(farmId, todayIso());
    setLoad({ state: "ok", alerts: buildAlerts(input) });
  }, [farmId]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    refresh().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const alerts = load.state === "ok" ? load.alerts : EMPTY;
  const count = (u: Urgency) => alerts.filter((a) => a.urgency === u).length;

  return (
    <OpsShell searchPlaceholder="A cow, a date…">
      <PageHeader eyebrow={business ? `${business.name} · herd` : "Herd"} title="Alerts" />

      {load.state === "loading" && (
        <p style={{ fontSize: 14, color: "var(--ink-muted)", padding: "16px 8px" }}>Reading the herd…</p>
      )}
      {load.state === "error" && (
        <p style={{ fontSize: 14, color: "var(--red)", padding: "16px 8px" }}>Couldn't work these out: {load.message}</p>
      )}

      {load.state === "ok" && (
        <>
          <div className="stat-row">
            <StatTile value={count("now") || "—"} label="Now" tone={count("now") > 0 ? "red" : "ink"} />
            <StatTile value={count("soon") || "—"} label="Soon" />
            <StatTile value={count("watch") || "—"} label="Coming up" />
          </div>

          {alerts.length === 0 ? (
            <div style={{ marginTop: 24 }}>
              <Callout>
                Nothing outstanding. Every cow is either carrying, inside her waiting period, or has nothing on file
                to be late about — and a cow with nothing on file is quiet here rather than wrong. Log a service on{" "}
                <Link to="/breeding?tab=breedings">Breedings</Link> and this page starts watching it.
              </Callout>
            </div>
          ) : (
            BANDS.map((band) => {
              const mine = alerts.filter((a) => a.urgency === band.urgency);
              if (mine.length === 0) return null;
              return (
                <section key={band.urgency} className="alert-band">
                  <div className="serif alert-band__head">{band.heading}</div>
                  <p className="alert-band__blurb">{band.blurb}</p>
                  {mine.map((a) => (
                    <AlertRow key={a.id} alert={a} />
                  ))}
                </section>
              );
            })
          )}

          <p className="alert-rules">
            A service is worth checking from {RULES.checkDueDays} days and overdue at {RULES.checkLateDays}; a calving
            appears {RULES.dueSoonDays} days out. The breeding date is her calving plus the farm's voluntary waiting
            period — one setting, not a number written into the code, so changing it moves every date here.
          </p>
        </>
      )}
    </OpsShell>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <Link to={alert.href} className="alert-row">
      <EarTag tag={alert.earTag || "—"} accent="herd" />
      <span className="alert-row__body">
        <span className="serif alert-row__title">{alert.title}</span>
        <span className="alert-row__detail">{alert.detail}</span>
      </span>
      <span className="alert-row__when">
        {/* Plain, always. The pill names a category, not a severity — green
            is this system's "good", and using it for "past due" would say the
            opposite of what it means. The band heading and "11 days late"
            carry the urgency. */}
        <Pill variant="outline">{KIND_LABEL[alert.kind]}</Pill>
        <span className="mono alert-row__days">{whenInWords(alert.daysLate)}</span>
      </span>
    </Link>
  );
}

const EMPTY: Alert[] = [];
