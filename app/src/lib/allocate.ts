/**
 * Splitting a cost across animals without losing a cent.
 *
 * $612 of feed across 41 head is 1493.9024… cents each. Rounding every
 * share independently either loses money or invents it, and an allocation
 * that doesn't reconcile to its ledger transaction is worse than no
 * allocation at all.
 *
 * Rule: largest remainder. Give everyone their floored share, then hand the
 * leftover cents out one at a time, largest fractional remainder first.
 * Ties break on the caller's order (which is stable), so the same input
 * always produces the same split.
 *
 * Guarantee: the returned amounts always sum to exactly `totalCents`.
 */
export interface AllocationTarget {
  /** Opaque to this function — animal id, tag, whatever the caller keys on. */
  id: string;
  /** Relative share. Equal weights = split evenly; production lb = weight by
   * output. Must be >= 0. */
  weight: number;
}

export interface AllocationResult {
  id: string;
  amountCents: number;
}

export function allocateCents(totalCents: number, targets: AllocationTarget[]): AllocationResult[] {
  if (targets.length === 0) return [];
  if (!Number.isInteger(totalCents)) {
    throw new Error(`allocateCents needs whole cents, got ${totalCents}`);
  }

  const totalWeight = targets.reduce((sum, t) => sum + t.weight, 0);

  // No weights to divide by (all zero, or a dry herd) — fall back to an even
  // split rather than dividing by zero or silently returning nothing.
  const effective =
    totalWeight > 0 ? targets : targets.map((t) => ({ ...t, weight: 1 }));
  const effectiveTotal = totalWeight > 0 ? totalWeight : targets.length;

  const negative = totalCents < 0;
  const magnitude = Math.abs(totalCents);

  const exact = effective.map((t) => (magnitude * t.weight) / effectiveTotal);
  const floored = exact.map((v) => Math.floor(v));
  let remaining = magnitude - floored.reduce((sum, v) => sum + v, 0);

  // Hand out the leftover cents, biggest fractional part first. Index is the
  // tiebreak so equal remainders resolve in the caller's order.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const amounts = [...floored];
  for (const { i } of order) {
    if (remaining <= 0) break;
    amounts[i] += 1;
    remaining -= 1;
  }

  return effective.map((t, i) => ({ id: t.id, amountCents: negative ? -amounts[i] : amounts[i] }));
}

/** Dollars-as-numeric (the ledger side) to whole cents (the herd side). */
export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}
