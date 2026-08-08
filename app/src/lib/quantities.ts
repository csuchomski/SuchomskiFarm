/**
 * What a customer is allowed to ask for, and in what increments.
 *
 * Milk goes by the half gallon, eggs by the dozen, meat by the pound. The
 * step comes from products.type_code, which migration 008 added — but that
 * backfill was deliberately conservative and left one product untyped, and a
 * product added since may have no type either, so the unit is the fallback
 * rather than a blanket 1.
 */

export const STEP_BY_TYPE: Record<string, number> = {
  milk: 0.5,
  eggs: 1,
  meat: 1,
  honey: 0.5,
  produce: 1,
};

const STEP_BY_UNIT: Record<string, number> = {
  gallon: 0.5,
  gallons: 0.5,
  gal: 0.5,
  quart: 1,
  dozen: 1,
  doz: 1,
  pound: 1,
  pounds: 1,
  lb: 1,
  lbs: 1,
};

export function stepFor(product: { type_code?: string | null; unit?: string | null }): number {
  const byType = product.type_code ? STEP_BY_TYPE[product.type_code] : undefined;
  if (byType) return byType;
  const byUnit = product.unit ? STEP_BY_UNIT[product.unit.trim().toLowerCase()] : undefined;
  return byUnit ?? 1;
}

/**
 * The quantities to offer: one step, two steps, and so on, stopping at the
 * last one the forecast covers.
 *
 * A cap below a single step gives an empty list rather than a zero — there
 * is no honest quantity to offer that day, and the shop says so instead of
 * putting "0" in a dropdown.
 *
 * `maxOptions` is a guard, not a rule. products.forecast_override is a
 * number a farmer types, and 500 gallons would otherwise render a thousand
 * options into a phone's picker. Anyone wanting more than the cap allows is
 * the "ask us for help" case the note on screen points at.
 */
export function quantityOptions(step: number, cap: number, maxOptions = 100): number[] {
  if (!(step > 0) || !(cap >= step)) return [];
  const count = Math.min(Math.floor(round3(cap) / step + 1e-9), maxOptions);
  return Array.from({ length: count }, (_, i) => round3(step * (i + 1)));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** "1.5 gallon", "2 dozen" — matching how the rest of the shop renders a
 * quantity, which doesn't pluralise the unit. */
export const quantityLabel = (quantity: number, unit: string): string => `${round3(quantity)} ${unit}`.trim();

/**
 * The largest quantity a day can actually be signed up for — the last option
 * the dropdown would offer, or zero when it would offer none.
 *
 * The day picker labels itself with this rather than the raw forecast, so
 * "Fridays — none expected" and "No milk that day" can't contradict each
 * other over 0.3 of a gallon.
 */
export function maxOffer(step: number, cap: number, maxOptions = 100): number {
  const options = quantityOptions(step, cap, maxOptions);
  return options.length === 0 ? 0 : options[options.length - 1];
}
