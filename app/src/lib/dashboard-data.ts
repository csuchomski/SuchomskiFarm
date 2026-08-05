import { supabase } from "./supabase";
import { summarise, typeMap, FALLBACK_TYPES, type RealTransaction, type TransactionType } from "./books-data";
import type { RealAnimal } from "./herd";

/**
 * Everything the Today screen needs, in one round trip's worth of parallel
 * queries.
 *
 * Some of the mockup's figures aren't here at all. "Cows in milk" needs
 * herd.lactations, which has no rows, so the screen shows total head
 * instead of a number that would look precise and mean nothing. A dashboard
 * that quietly invents its headline figure is worse than one that admits a
 * gap.
 */

export interface ProfitPerHead {
  animal: RealAnimal;
  costCents: number;
  revenueCents: number;
  netCents: number;
}

export interface DashboardData {
  today: string;
  animals: RealAnimal[];
  milkTodayQuantity: number;
  milkTodayUnit: string | null;
  batchesToday: number;
  claimed: number;
  openToShop: number;
  openOrders: number;
  monthIncome: number;
  monthExpenses: number;
  monthNet: number;
  monthEntries: number;
  transactionsToday: RealTransaction[];
  profitPerHead: ProfitPerHead[];
  hasCostData: boolean;
}

const MILK_MATCH = /milk/i;

export async function fetchDashboardData(todayIso: string): Promise<DashboardData> {
  const monthStart = `${todayIso.slice(0, 7)}-01`;

  const [animalsRes, productionRes, batchesRes, productsRes, ordersRes, txnRes, typesRes, costRes, revenueRes] =
    await Promise.all([
      supabase
        .schema("herd")
        .from("animals")
        .select("id, ear_tag, barn_name, sex, class, status, birth_date")
        .order("barn_name"),
      supabase
        .schema("herd")
        .from("production_records")
        .select("id, animal_id, product_id, product_name, quantity, unit, produced_date, batch_id")
        .eq("produced_date", todayIso),
      supabase.from("inventory_batches").select("id, product_id, produced_date, quantity, reserved"),
      supabase.from("products").select("id, name, unit, price"),
      supabase.from("orders").select("id, status, picked_up_date, cancelled_date"),
      supabase
        .from("ledger_transactions")
        .select("id, business_id, date, type, category, amount, note, payer, account")
        .gte("date", monthStart)
        .lte("date", todayIso),
      supabase.from("transaction_types").select("code, label, direction, active, sort_order"),
      supabase.schema("herd").from("cost_entries").select("animal_id, amount_cents").is("deleted_at", null),
      supabase.schema("herd").from("revenue_entries").select("animal_id, amount_cents").is("deleted_at", null),
    ]);

  for (const [label, res] of [
    ["herd.animals", animalsRes],
    ["herd.production_records", productionRes],
    ["inventory_batches", batchesRes],
    ["products", productsRes],
    ["orders", ordersRes],
    ["ledger_transactions", txnRes],
    ["herd.cost_entries", costRes],
    ["herd.revenue_entries", revenueRes],
  ] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  const animals = (animalsRes.data ?? []) as RealAnimal[];
  const production = (productionRes.data ?? []) as { product_id: number; quantity: number; unit: string }[];
  const batches = (batchesRes.data ?? []) as { product_id: number; produced_date: string; quantity: number; reserved: number }[];
  const products = (productsRes.data ?? []) as { id: number; name: string; unit: string }[];
  const orders = (ordersRes.data ?? []) as { status: string; picked_up_date: string | null; cancelled_date: string | null }[];
  const transactions = (txnRes.data ?? []) as RealTransaction[];

  const types: TransactionType[] = typesRes.error ? FALLBACK_TYPES : ((typesRes.data ?? []) as TransactionType[]);
  const monthTotals = summarise(transactions, typeMap(types));

  // Milk-ish products, so "milk today" doesn't silently include eggs.
  const milkProductIds = new Set(products.filter((p) => MILK_MATCH.test(p.name)).map((p) => p.id));
  const milkProduction = production.filter((r) => milkProductIds.has(r.product_id));
  const milkTodayQuantity = round3(milkProduction.reduce((s, r) => s + Number(r.quantity), 0));
  const milkTodayUnit = milkProduction[0]?.unit ?? products.find((p) => milkProductIds.has(p.id))?.unit ?? null;

  const milkBatches = batches.filter((b) => milkProductIds.has(b.product_id));
  const claimed = round3(milkBatches.reduce((s, b) => s + Number(b.reserved), 0));
  const onHand = round3(milkBatches.reduce((s, b) => s + Number(b.quantity), 0));

  const costByAnimal = tally((costRes.data ?? []) as { animal_id: string; amount_cents: number }[]);
  const revenueByAnimal = tally((revenueRes.data ?? []) as { animal_id: string; amount_cents: number }[]);

  const profitPerHead: ProfitPerHead[] = animals
    .map((animal) => {
      const costCents = costByAnimal.get(animal.id) ?? 0;
      const revenueCents = revenueByAnimal.get(animal.id) ?? 0;
      return { animal, costCents, revenueCents, netCents: revenueCents - costCents };
    })
    .sort((a, b) => b.netCents - a.netCents);

  return {
    today: todayIso,
    animals,
    milkTodayQuantity,
    milkTodayUnit,
    batchesToday: batches.filter((b) => b.produced_date === todayIso).length,
    claimed,
    openToShop: round3(onHand - claimed),
    openOrders: orders.filter((o) => !o.picked_up_date && !o.cancelled_date).length,
    monthIncome: monthTotals.income,
    monthExpenses: monthTotals.expenses,
    monthNet: monthTotals.net,
    monthEntries: transactions.length,
    transactionsToday: transactions.filter((t) => t.date === todayIso),
    profitPerHead,
    hasCostData: costByAnimal.size > 0 || revenueByAnimal.size > 0,
  };
}

function tally(rows: { animal_id: string; amount_cents: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.animal_id) continue;
    out.set(r.animal_id, (out.get(r.animal_id) ?? 0) + Number(r.amount_cents));
  }
  return out;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

