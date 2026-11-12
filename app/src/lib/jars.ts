import { supabase } from "./supabase";

/**
 * The farm's jars: who has them.
 *
 * Milk goes home in the farm's jars and the jars are meant to come back.
 * Nobody is charged for one — this is a count, so that a jar which doesn't
 * come back has a name against it.
 *
 * The count is a ledger in the database (migration 078), not something worked
 * out here: a pickup adds jars by a trigger, whoever marks it collected; a
 * return takes them off, entered by the farmer; and the farmer can set the
 * count outright. A customer sees their count and cannot change it (079) —
 * it is the farm's record of where its jars are. What this file works out
 * for itself is only what a form says before it is sent.
 */

export type JarLineKind = "pickup" | "return" | "correction";

export interface JarLine {
  id: number;
  kind: JarLineKind;
  /** Jars taken (+) or brought back (-). */
  change: number;
  at: string;
  orderId: number | null;
  /** Who wrote the line: whoever marked the pickup collected, or the farmer. */
  enteredBy: string | null;
}

/**
 * How many of the farm's jars a quantity goes home in. Rounded up: three
 * quarters of a gallon still takes two half-gallon jars. Null for a product
 * not sold in jars. Mirrors record_jars_out(), which is what actually counts.
 */
export function jarsFor(quantity: number, jarsPerUnit: number | null | undefined): number | null {
  if (jarsPerUnit == null || !(jarsPerUnit > 0)) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  // Float noise: 0.07 × 100 is 7.000000000000001, which would round up to 8.
  return Math.ceil(Math.round(quantity * jarsPerUnit * 1000) / 1000);
}

export const jarWords = (n: number): string => `${n} jar${n === 1 ? "" : "s"}`;

/** "1 jar for every half gallon" — the rule, in the product's own unit. */
export function jarRule(jarsPerUnit: number, unit: string): string {
  const each = 1 / jarsPerUnit;
  const size =
    Math.abs(each - 0.5) < 1e-9
      ? `half ${unit}`
      : Math.abs(each - 0.25) < 1e-9
        ? `quarter ${unit}`
        : Math.abs(each - 1) < 1e-9
          ? unit
          : `${Math.round(each * 100) / 100} ${unit}`;
  return `1 jar for every ${size}`;
}

/** What's wrong with a number of jars being returned, or null. */
export function validateJarReturn(raw: string, held: number): string | null {
  const text = raw.trim();
  if (text === "") return "How many jars?";
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1) return "A whole number of jars, one or more.";
  if (n > held) return `That's more than the ${jarWords(held)} on record.`;
  return null;
}

/** What's wrong with a count the farmer is setting, or null. */
export function validateJarCount(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "What should the count be?";
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) return "A whole number, zero or more.";
  if (n > 999) return "That's more jars than a count can hold.";
  return null;
}

// ─── reads ─────────────────────────────────────────────────────────────

/** A customer's own count at each farm they buy from, by business id. A farm
 *  is in the map only once something has gone on the ledger there — so "no
 *  entry" is "never had one of their jars", which is not the same as zero. */
export async function fetchMyJars(customerId: string): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from("jar_balances")
    .select("business_id, jars")
    .eq("customer_id", customerId);
  if (error) throw new Error(`jar_balances: ${error.message}`);
  return new Map(
    ((data ?? []) as { business_id: number; jars: number }[]).map((r) => [Number(r.business_id), Number(r.jars)]),
  );
}

/** Every customer's count at one farm, by customer id. The farmer's view. */
export async function fetchJarBalances(businessId: number): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("jar_balances")
    .select("customer_id, jars")
    .eq("business_id", businessId);
  if (error) throw new Error(`jar_balances: ${error.message}`);
  return new Map(((data ?? []) as { customer_id: string; jars: number }[]).map((r) => [r.customer_id, Number(r.jars)]));
}

/** One customer's lines at one farm, newest first. */
export async function fetchJarLines(businessId: number, customerId: string): Promise<JarLine[]> {
  const { data, error } = await supabase
    .from("jar_ledger")
    .select("id, kind, change, at, order_id, entered_by")
    .eq("business_id", businessId)
    .eq("customer_id", customerId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw new Error(`jar_ledger: ${error.message}`);
  return (
    (data ?? []) as { id: number; kind: JarLineKind; change: number; at: string; order_id: number | null; entered_by: string | null }[]
  ).map((r) => ({
    id: r.id,
    kind: r.kind,
    change: Number(r.change),
    at: r.at,
    orderId: r.order_id,
    enteredBy: r.entered_by,
  }));
}

// ─── writes ────────────────────────────────────────────────────────────

/** The farmer entering jars that came back. Returns what's left. */
export async function recordJarReturn(businessId: number, customerId: string, quantity: number): Promise<number> {
  const { data, error } = await supabase.rpc("record_jar_return", {
    p_business_id: businessId,
    p_customer_id: customerId,
    p_quantity: quantity,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

/** The farmer putting the count right — a starting count, or a miscount. */
export async function setJarCount(businessId: number, customerId: string, count: number): Promise<number> {
  const { data, error } = await supabase.rpc("set_jar_count", {
    p_business_id: businessId,
    p_customer_id: customerId,
    p_count: count,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}
