import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAnimalMoney, summariseMoney, type MoneyEntry } from "../../lib/animal-money";
import { fetchValuations, isHerdInventory, type Valuation } from "../../lib/depreciation";
import { formatMoney } from "../../lib/sires";
import type { RealAnimal } from "../../lib/herd";
import { pronounsFor, type Pronouns } from "../../lib/pronouns";
import "./money-section.css";

/**
 * What she has cost and what she has brought in.
 *
 * Two ledgers side by side and the answer beside them, rather than three stat
 * tiles above a dated list. The list was the ledger's own view of itself —
 * one row per attribution, in date order — which reads as a bank statement
 * when the question is "is she paying her way".
 *
 * **Rows are grouped by what they were for**, so three AI services are one
 * line saying three rather than three lines saying one. The dates and the
 * individual attributions are on the transaction they came from; this is the
 * summing-up.
 *
 * **Basis is reported, never netted.** `cost_entries.is_basis` marks what she
 * cost to acquire, which goes on no Schedule F expense line — netting a $700
 * purchase against a season's milk would say she lost money in the year she
 * was bought and never again. Same for what the herd roll carries her at:
 * that is a valuation, not something she earned.
 *
 * The footnote about partial attribution is not decoration. A feed bill can be
 * 80% herd and 20% household, and the ledger lets you say so, which means a
 * total here is a share of some bills and all of others.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; entries: MoneyEntry[]; valuations: Valuation[] };

export function MoneySection({
  animal,
  farmId,
  name,
}: {
  animal: RealAnimal;
  farmId: string | null;
  name: string;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const p = pronounsFor(animal);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    (async () => {
      const [entries, valuations] = await Promise.all([
        fetchAnimalMoney(animal.id),
        // A valuation is worth having beside the net and is not worth a
        // section of its own; a farm with no roll simply has none.
        farmId ? fetchValuations(farmId).catch(() => [] as Valuation[]) : Promise.resolve([] as Valuation[]),
      ]);
      if (!cancelled) {
        setLoad({
          state: "ok",
          entries,
          valuations: valuations.filter((v) => v.animalId === animal.id),
        });
      }
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [animal.id, farmId]);

  return (
    <>
      <div className="section__head" style={{ marginBottom: 4 }}>
        <div className="serif" style={{ fontSize: 21 }}>
          What {p.subject} {p.has} cost and earned
        </div>
        {/* Attribution happens against a transaction, not against her — so
            this points at where the work is done rather than pretending
            there's a form here. */}
        <Link to="/books/transactions" className="link-button mono">
          attribute a transaction
        </Link>
      </div>
      {/* Not "not just this lactation": a beef cow has none, and her page
          should not name something she does not have. */}
      <p className="record-section__lede">{p.Possessive} whole life on this farm, not just this year.</p>

      {load.state === "loading" && <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Loading…</p>}

      {load.state === "error" && (
        <p style={{ fontSize: 13, color: "var(--red)" }}>Couldn't load {p.possessive} figures: {load.message}</p>
      )}

      {load.state === "ok" && (
        <Figures entries={load.entries} valuations={load.valuations} animal={animal} name={name} p={p} />
      )}
    </>
  );
}

interface Line {
  label: string;
  cents: number;
  count: number;
}

/** One line per thing the money was for, biggest first. */
function group(entries: MoneyEntry[]): Line[] {
  const by = new Map<string, Line>();
  for (const e of entries) {
    const line = by.get(e.label) ?? { label: e.label, cents: 0, count: 0 };
    line.cents += e.amountCents;
    line.count += 1;
    by.set(e.label, line);
  }
  return [...by.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
}

function Figures({
  entries,
  valuations,
  animal,
  name,
  p,
}: {
  entries: MoneyEntry[];
  valuations: Valuation[];
  animal: RealAnimal;
  name: string;
  p: Pronouns;
}) {
  const sum = summariseMoney(entries);
  const carried = valuations[0] ?? null;

  if (entries.length === 0) {
    return (
      <>
        <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
          Nothing costed against {name} yet. A ledger transaction attributed to {p.object} lands here, as does
          an AI service and a purchase price.
        </p>
        {/* Still worth saying what the roll makes of her — a cow nothing has
            been booked against is not a cow with no value. */}
        <div className="money-answer__aside" style={{ borderTop: "none", marginTop: 4, paddingTop: 0 }}>
          <CarriedAt carried={carried} animal={animal} />
        </div>
      </>
    );
  }

  const earned = group(entries.filter((e) => e.kind === "revenue" && !e.isInternalTransfer));
  // Basis is not an expense, so it is not in this column. It goes beside the
  // net, where it can be read without being subtracted.
  const spent = group(entries.filter((e) => e.kind === "cost" && !e.isBasis && !e.isInternalTransfer));
  const ahead = sum.netCents >= 0;

  return (
    <>
      <div className="money-books">
        <Column title="Earned" lines={earned} total={sum.revenueCents} empty="Nothing yet" />
        <Column title="Cost" lines={spent} total={sum.operatingCents} empty="Nothing yet" />

        <div className="money-answer">
          <div className="eyebrow">
            {p.Subject} {p.is} {ahead ? "ahead by" : "behind by"}
          </div>
          <div
            className="serif mono money-answer__value"
            style={{ color: ahead ? "var(--ink)" : "var(--red)" }}
          >
            {formatMoney(Math.abs(sum.netCents))}
          </div>
          <p className="money-answer__note">
            What {p.subject} {p.has} earned, less what it costs to run {p.object}.
          </p>

          {sum.basisCents > 0 && (
            <div className="money-answer__aside">
              <span className="eyebrow">Cost to buy</span>
              <span className="mono">{formatMoney(sum.basisCents)}</span>
              <span className="money-answer__why">not an expense, so not in the net</span>
            </div>
          )}

          <div className="money-answer__aside">
            <CarriedAt carried={carried} animal={animal} />
          </div>
        </div>
      </div>

      <p className="money-note">
        Attribution can be partial — a bill that was four fifths herd is recorded as four fifths — so these are
        the amounts booked against {name}, not the whole of every bill {p.subject} appears on.
      </p>
    </>
  );
}

/** What the herd roll makes of her. One line: the movement year on year is
 *  Depreciation's subject, not this page's. */
function CarriedAt({ carried, animal }: { carried: Valuation | null; animal: RealAnimal }) {
  return (
    <>
      <span className="eyebrow">Carried at</span>
      {carried ? (
        <>
          <span className="mono">{formatMoney(carried.valueCents)}</span>
          <span className="money-answer__why">
            in the herd roll · <Link to="/depreciation">depreciation</Link>
          </span>
        </>
      ) : (
        <span className="money-answer__why">
          {isHerdInventory(animal)
            ? "not marked yet — Herd → Depreciation rolls a value for the dairy string"
            : "the herd roll covers the dairy string; anyone else is valued by hand"}
        </span>
      )}
    </>
  );
}

function Column({
  title,
  lines,
  total,
  empty,
}: {
  title: string;
  lines: Line[];
  total: number;
  empty: string;
}) {
  return (
    <div className="money-book">
      <div className="eyebrow money-book__head">{title}</div>
      {lines.length === 0 ? (
        <div className="money-book__row">
          <span style={{ color: "var(--ink-faint)" }}>{empty}</span>
          <span className="mono" style={{ color: "var(--ink-faint)" }}>
            —
          </span>
        </div>
      ) : (
        lines.map((line) => (
          <div className="money-book__row" key={line.label}>
            <span>
              {line.label}
              {line.count > 1 && (
                <span style={{ color: "var(--ink-muted)" }}> · {line.count}</span>
              )}
            </span>
            <span className="mono">{formatMoney(line.cents)}</span>
          </div>
        ))
      )}
      <div className="money-book__total">
        <span className="eyebrow">Total</span>
        <span className="serif mono">{formatMoney(total)}</span>
      </div>
    </div>
  );
}
