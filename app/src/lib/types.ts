/** Shared domain types for the mock/placeholder data layer.
 *
 * These mirror the fields the mockups actually show — this is a design
 * implementation, not a finished data model. See IMPLEMENTATION_PLAN.md.
 */

export type TagAccent = "herd" | "guernsey" | "withdrawal" | "at-risk";

export interface Animal {
  tag: string;
  name: string;
  breed: string;
  lactationLabel: string; // e.g. "L3 · d112"
  tagAccent: TagAccent;
  status: "in-milk" | "withdrawal" | "at-risk";
  todayGallons: number | null;
  todayNote?: string; // e.g. "discarded"
  freshened?: string;
  peakGallons?: number;
  firstLactation?: boolean;
  gallonsToDate: number;
  costToDate: number;
  netToDate: number;
  note?: string; // e.g. "below feed cost · 3 months"
  sparkline: number[]; // 0-1 relative bar heights
  sparklineDiscardedFrom?: number; // index at which bars turn discarded-yellow
  sparklineFlatFrom?: number; // index at which bars go flat/dry (Birdie/Pepper)
}

export interface Product {
  id: string;
  name: string;
  unitPrice: string; // "$8.00 / gallon"
  note?: string; // "from 9 cows in milk", "short by 3 dozen Friday", etc
  noteColor?: "muted" | "ochre";
  onHand: number | string;
  claimed: number | string;
  openToShop: number | string;
  heldWeekly: number | string;
  soldOut?: boolean;
}

export interface MilkAttribution {
  tag: string;
  name: string;
  gallons: number | null; // null => excluded
  tagAccent: TagAccent;
}

export interface Batch {
  produced: string;
  source: string;
  quantity: number;
  reserved: number;
  available: number;
  availableNote?: string;
}

export interface LedgerEntry {
  date: string;
  description: string;
  category: string;
  categoryPending?: boolean;
  attribution: {
    label: string;
    tag?: string;
    name?: string;
    tagAccent?: TagAccent;
    emphasis?: boolean;
  };
  account: string;
  amount: number; // signed, dollars
  highlight?: boolean;
}

export interface SpendCategory {
  label: string;
  amount: number;
  pct: number;
}

export interface MilkDestination {
  date: string;
  batch: string;
  gallons: number;
  outcome: string;
  outcomeColor: "muted" | "ochre" | "herd";
  value: string;
  excluded?: boolean;
}

export interface HealthEvent {
  date: string;
  title: string;
  detail: string;
  detailColor?: "muted" | "ochre";
}

export interface StoreProduct {
  id: string;
  name: string;
  unitPrice: string;
  quantityLeft: number | null;
  unitLabel: string;
  soldOut?: boolean;
  soldOutNote?: string;
}

export interface Pickup {
  title: string;
  schedule: string;
  amount: string;
  weekly?: boolean;
}
