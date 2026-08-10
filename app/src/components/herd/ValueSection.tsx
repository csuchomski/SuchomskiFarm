import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatMoney } from "../../lib/sires";
import { fetchValuations, isHerdInventory, type Valuation } from "../../lib/depreciation";
import type { RealAnimal } from "../../lib/herd";

/**
 * What she is carried at, and how that has moved.
 *
 * The history is the point. A raised-breeding-stock inventory value is marked
 * and rolled each year, and the roll is what the accrual-adjusted statements
 * and the lender are reading — so this is a list of dated figures rather than
 * one number that quietly changes underneath you.
 */

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; rows: Valuation[] };

const BASIS_LABEL: Record<string, string> = {
  marked: "marked in the herd roll",
  purchase: "what she cost",
  appraisal: "appraised",
  sale: "what she sold for",
  manual: "entered by hand",
};

export function ValueSection({ animal, farmId }: { animal: RealAnimal; farmId: string | null }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    if (!farmId) return;
    let cancelled = false;
    setLoad({ state: "loading" });
    (async () => {
      const all = await fetchValuations(farmId);
      if (!cancelled) setLoad({ state: "ok", rows: all.filter((r) => r.animalId === animal.id) });
    })().catch(
      (err) => !cancelled && setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [animal.id, farmId]);

  if (!farmId) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div className="section__head" style={{ marginBottom: 12 }}>
        <div className="serif" style={{ fontSize: 21 }}>
          Value
        </div>
        <Link to="/depreciation" className="link-button mono">
          herd depreciation
        </Link>
      </div>

      {load.state === "loading" && <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Loading…</p>}
      {load.state === "error" && (
        <p style={{ fontSize: 13, color: "var(--red)" }}>Couldn't load her value: {load.message}</p>
      )}

      {load.state === "ok" && load.rows.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>
          {isHerdInventory(animal)
            ? "Not marked yet. Herd → Depreciation rolls a value for the dairy string."
            : "No value on file. The herd roll covers the dairy string; anyone else is valued by hand."}
        </p>
      )}

      {load.state === "ok" && load.rows.length > 0 && (
        <div className="money-list">
          {load.rows.map((r, i) => (
            <div className="money-row" key={r.id}>
              <span className="mono money-row__date">{shortDate(r.asOf)}</span>
              <span className="money-row__what">
                <span style={{ fontSize: 15 }}>{BASIS_LABEL[r.basis] ?? r.basis}</span>
                {r.note && (
                  <>
                    <br />
                    <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{r.note}</span>
                  </>
                )}
              </span>
              <span className="mono money-row__amount">
                {formatMoney(r.valueCents)}
                {/* The change since the row below it — the whole reason to keep
                    the history rather than one field. */}
                {i < load.rows.length - 1 && (
                  <>
                    <br />
                    <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                      {change(r.valueCents - load.rows[i + 1].valueCents)}
                    </span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function change(deltaCents: number): string {
  if (deltaCents === 0) return "no change";
  return `${deltaCents < 0 ? "−" : "+"}${formatMoney(Math.abs(deltaCents))}`;
}

function shortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
