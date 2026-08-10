import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAnimalMoney, summariseMoney, type MoneyEntry } from "../../lib/animal-money";
import { formatMoney } from "../../lib/sires";
import "./money-section.css";

/**
 * What she has cost and what she has brought in.
 *
 * Deliberately three figures rather than one: revenue, what it costs to run
 * her, and — kept apart — what she cost to buy. See lib/animal-money.ts for
 * why basis stays out of the net.
 *
 * The footnote about partial attribution is not decoration. A feed bill can be
 * 80% herd and 20% household, and the ledger lets you say so, which means a
 * total on this page is a share of some bills and all of others. A page that
 * printed it like an invoice would be claiming more than the data supports.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; entries: MoneyEntry[] };

export function MoneySection({ animalId, name }: { animalId: string; name: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    (async () => {
      const entries = await fetchAnimalMoney(animalId);
      if (!cancelled) setLoad({ state: "ok", entries });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [animalId]);

  return (
    <div style={{ marginTop: 24 }}>
      <div className="section__head" style={{ marginBottom: 12 }}>
        <div className="serif" style={{ fontSize: 21 }}>
          Costs and revenue
        </div>
        {/* Attribution happens against a transaction, not against her — so
            this points at where the work is done rather than pretending
            there's a form here. */}
        <Link to="/books/transactions" className="link-button mono">
          attribute a transaction
        </Link>
      </div>

      {load.state === "loading" && (
        <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Loading…</p>
      )}

      {load.state === "error" && (
        <p style={{ fontSize: 13, color: "var(--red)" }}>Couldn't load her figures: {load.message}</p>
      )}

      {load.state === "ok" && <Figures entries={load.entries} name={name} />}
    </div>
  );
}

function Figures({ entries, name }: { entries: MoneyEntry[]; name: string }) {
  const sum = summariseMoney(entries);

  if (entries.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
        Nothing costed against {name} yet. A ledger transaction attributed to her lands here, as does an AI
        service and a purchase price.
      </p>
    );
  }

  return (
    <>
      <div className="money-totals">
        <Total label="Revenue" cents={sum.revenueCents} />
        <Total label="Cost to run her" cents={sum.operatingCents} />
        <Total label="Net" cents={sum.netCents} accent={sum.netCents < 0 ? "down" : "up"} signed />
        {/* Only when there is one. A blank tile reading "$0.00 to buy" for a
            calf born here is a fact about the schema, not about her. */}
        {sum.basisCents > 0 && <Total label="Cost to buy" cents={sum.basisCents} muted />}
      </div>

      <div className="money-list">
        {entries.map((e) => (
          <div className="money-row" key={`${e.kind}-${e.id}`}>
            <span className="mono money-row__date">{shortDate(e.date)}</span>
            <span className="money-row__what">
              <span style={{ fontSize: 15 }}>{e.label}</span>
              <br />
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>
                {[
                  e.note,
                  e.isBasis ? "basis — what she cost to buy, not an expense" : null,
                  e.isInternalTransfer ? "internal transfer, left out of the totals" : null,
                  e.ledgerTransactionId !== null ? "from the ledger" : `recorded by ${e.source}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span
              className={`mono money-row__amount ${e.kind === "revenue" ? "money-row__amount--in" : ""}`}
            >
              {e.kind === "revenue" ? "+" : "−"}
              {formatMoney(e.amountCents)}
            </span>
          </div>
        ))}
      </div>

      <p className="money-note">
        Attribution can be partial — a bill that was four fifths herd is recorded as four fifths — so these are
        the amounts booked against {name}, not the whole of every bill she appears on.
      </p>
    </>
  );
}

function Total({
  label,
  cents,
  accent,
  muted,
  signed,
}: {
  label: string;
  cents: number;
  accent?: "up" | "down";
  muted?: boolean;
  signed?: boolean;
}) {
  const color = accent === "down" ? "var(--red)" : accent === "up" ? "var(--herd-green)" : "var(--ink)";
  return (
    <div className={`money-total ${muted ? "money-total--muted" : ""}`}>
      <div className="mono money-total__value" style={{ color: muted ? "var(--ink-muted)" : color }}>
        {signed && cents > 0 ? "+" : ""}
        {cents < 0 ? `−${formatMoney(Math.abs(cents))}` : formatMoney(cents)}
      </div>
      <div className="eyebrow money-total__label">{label}</div>
    </div>
  );
}

/** Dates here are ISO from the database; a Date built from one without a time
 * is parsed as UTC and can render as the day before. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
