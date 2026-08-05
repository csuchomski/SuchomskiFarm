import type {
  Animal,
  Batch,
  HealthEvent,
  LedgerEntry,
  MilkAttribution,
  MilkDestination,
  Pickup,
  Product,
  SpendCategory,
  StoreProduct,
} from "./types";

export interface SparkBar {
  h: number; // 0-100, relative height
  tone: "tint" | "green" | "ink" | "yellow" | "flat";
}

export const herd: Animal[] = [
  {
    tag: "1042",
    name: "Juniper",
    breed: "Jersey",
    lactationLabel: "L3 · d112",
    tagAccent: "herd",
    status: "in-milk",
    todayGallons: 2.6,
    freshened: "14 Apr",
    peakGallons: 3.1,
    gallonsToDate: 1918,
    costToDate: 742,
    netToDate: 1596,
    sparkline: [34, 52, 68, 80, 88, 94, 99, 96, 93, 90, 86, 83],
  },
  {
    tag: "1017",
    name: "Clover",
    breed: "Jersey",
    lactationLabel: "L4 · d208",
    tagAccent: "herd",
    status: "in-milk",
    todayGallons: 2.2,
    freshened: "8 Jan",
    peakGallons: 3.4,
    gallonsToDate: 1744,
    costToDate: 698,
    netToDate: 1394,
    sparkline: [40, 62, 78, 90, 96, 92, 84, 76, 70, 64, 58, 54],
  },
  {
    tag: "1088",
    name: "Marigold",
    breed: "Guernsey",
    lactationLabel: "L2 · d151",
    tagAccent: "guernsey",
    status: "in-milk",
    todayGallons: 1.9,
    freshened: "6 Mar",
    peakGallons: 2.7,
    gallonsToDate: 1502,
    costToDate: 651,
    netToDate: 1151,
    sparkline: [32, 50, 66, 76, 84, 88, 82, 74, 68, 62, 58, 55],
  },
  {
    tag: "1103",
    name: "Hazel",
    breed: "Jersey",
    lactationLabel: "L2 · d64",
    tagAccent: "withdrawal",
    status: "withdrawal",
    todayGallons: 1.8,
    todayNote: "discarded",
    gallonsToDate: 1190,
    costToDate: 734,
    netToDate: 456,
    note: "milk discarded",
    sparkline: [38, 58, 74, 86, 92, 88, 84, 80, 78, 76, 74, 72],
  },
  {
    tag: "1121",
    name: "Birdie",
    breed: "Jersey",
    lactationLabel: "L1 · d78",
    tagAccent: "herd",
    status: "in-milk",
    todayGallons: 1.6,
    freshened: "18 May",
    firstLactation: true,
    gallonsToDate: 908,
    costToDate: 689,
    netToDate: 219,
    sparkline: [28, 44, 58, 68, 74, 76, 72, 69, 2, 2, 2, 2],
  },
  {
    tag: "1130",
    name: "Pepper",
    breed: "Jersey",
    lactationLabel: "L1 · d96",
    tagAccent: "at-risk",
    status: "at-risk",
    todayGallons: 1.1,
    gallonsToDate: 612,
    costToDate: 705,
    netToDate: -93,
    note: "below feed cost · 3 months",
    sparkline: [24, 36, 46, 52, 56, 52, 48, 44, 41, 2, 2, 2],
  },
];

/** Bar-by-bar coloring so the sparkline component doesn't need to guess. */
export const sparkTones: Record<string, SparkBar["tone"][]> = {
  "1042": ["tint", "tint", "tint", "tint", "tint", "green", "green", "green", "green", "green", "green", "ink"],
  "1017": ["tint", "tint", "tint", "tint", "green", "green", "green", "green", "green", "green", "green", "ink"],
  "1088": ["tint", "tint", "tint", "tint", "green", "green", "green", "green", "green", "green", "ink", "ink"],
  "1103": ["tint", "tint", "tint", "tint", "green", "green", "green", "yellow", "yellow", "yellow", "flat", "flat"],
  "1121": ["tint", "tint", "tint", "green", "green", "green", "green", "ink", "flat", "flat", "flat", "flat"],
  "1130": ["tint", "tint", "tint", "green", "green", "green", "green", "ink", "ink", "flat", "flat", "flat"],
};

export const findAnimal = (tag: string) => herd.find((a) => a.tag === tag);

// ─── Store · Products (2a) ─────────────────────────────────────────────

export const products: Product[] = [
  {
    id: "raw-milk",
    name: "Raw milk",
    unitPrice: "$8.00 / gallon",
    note: "from 9 cows in milk",
    onHand: 18.4,
    claimed: 11.0,
    openToShop: 7.4,
    heldWeekly: 4.0,
  },
  {
    id: "eggs",
    name: "Eggs",
    unitPrice: "$6.50 / dozen",
    note: "short by 3 dozen Friday",
    noteColor: "ochre",
    onHand: 14,
    claimed: 5,
    openToShop: 9,
    heldWeekly: 6,
  },
  {
    id: "ground-beef",
    name: "Ground beef",
    unitPrice: "$9.00 / lb",
    note: "traced per steer · next processing 12 Sep",
    onHand: 0,
    claimed: 0,
    openToShop: "—",
    heldWeekly: "—",
    soldOut: true,
  },
  {
    id: "honey",
    name: "Honey",
    unitPrice: "$14.00 / quart",
    onHand: 11,
    claimed: 2,
    openToShop: 9,
    heldWeekly: "—",
  },
  {
    id: "sweet-corn",
    name: "Sweet corn",
    unitPrice: "$0.75 / ear",
    note: "field crop · no animal source",
    onHand: 240,
    claimed: 96,
    openToShop: 144,
    heldWeekly: "—",
  },
];

export const milkAttributionToday: MilkAttribution[] = [
  { tag: "1042", name: "Juniper", gallons: 2.6, tagAccent: "herd" },
  { tag: "1017", name: "Clover", gallons: 2.2, tagAccent: "herd" },
  { tag: "1088", name: "Marigold", gallons: 1.9, tagAccent: "guernsey" },
  { tag: "1121", name: "Birdie", gallons: 1.6, tagAccent: "herd" },
  { tag: "1130", name: "Pepper", gallons: 1.1, tagAccent: "at-risk" },
  { tag: "1103", name: "Hazel", gallons: null, tagAccent: "withdrawal" },
];

export const batches: Batch[] = [
  { produced: "4 Aug", source: "pooled · 9 animals", quantity: 18.4, reserved: 11.0, available: 7.4 },
  { produced: "3 Aug", source: "pooled · 9 animals", quantity: 18.1, reserved: 18.1, available: 0 },
  {
    produced: "2 Aug",
    source: "pooled · 10 animals",
    quantity: 19.2,
    reserved: 18.7,
    available: 0.5,
    availableNote: "0.500 to pigs",
  },
];

// ─── Books · Transactions (2b) ─────────────────────────────────────────

export const ledger: LedgerEntry[] = [
  {
    date: "31 Jul",
    description: "Pickup · S. Mattson",
    category: "Uncategorised",
    categoryPending: true,
    attribution: { label: "Dairy herd" },
    account: "Chase Checking",
    amount: 41.0,
    highlight: true,
  },
  {
    date: "30 Jul",
    description: "Excede · metritis",
    category: "Vet & medicine",
    attribution: { label: "Hazel", tag: "1103", name: "Hazel", tagAccent: "withdrawal" },
    account: "Farm Visa",
    amount: -178.0,
  },
  {
    date: "28 Jul",
    description: "Weekly pickups · 11 customers",
    category: "Milk sales",
    attribution: { label: "Dairy herd · 9 head" },
    account: "Venmo",
    amount: 486.0,
  },
  {
    date: "24 Jul",
    description: "Vandenberg Feed · 2 ton",
    category: "Feed",
    attribution: { label: "Dairy herd · split 41", emphasis: true },
    account: "Chase Checking",
    amount: -612.0,
  },
  {
    date: "19 Jul",
    description: "Hoof trim · 6 cows",
    category: "Vet & medicine",
    attribution: { label: "6 animals →", emphasis: true },
    account: "Farm Visa",
    amount: -270.0,
  },
  {
    date: "15 Jul",
    description: "Egg sales · farm store",
    category: "Egg sales",
    attribution: { label: "Laying flock" },
    account: "Cash box",
    amount: 214.5,
  },
  {
    date: "12 Jul",
    description: "Bedding · 40 bales straw",
    category: "Bedding & supplies",
    attribution: { label: "Dairy herd · split 41", emphasis: true },
    account: "Chase Checking",
    amount: -320.0,
  },
  {
    date: "8 Jul",
    description: "Bottling supplies",
    category: "Packaging",
    attribution: { label: "Farm store" },
    account: "Farm Visa",
    amount: -96.4,
  },
];

export const spendBreakdown: SpendCategory[] = [
  { label: "Feed", amount: 1224, pct: 32 },
  { label: "Vet & medicine", amount: 904, pct: 24 },
  { label: "Bedding & supplies", amount: 640, pct: 17 },
  { label: "Everything else", amount: 1002, pct: 27 },
];

// ─── Animal record (1c) ────────────────────────────────────────────────

import type { CurvePoint } from "../components/ui/Sparkline";

export const hazelCurve: CurvePoint[] = [
  { prior: 26, current: 30, tone: "green" },
  { prior: 40, current: 46, tone: "green" },
  { prior: 54, current: 62, tone: "green" },
  { prior: 64, current: 74, tone: "green" },
  { prior: 72, current: 84, tone: "green" },
  { prior: 76, current: 92, tone: "green" },
  { prior: 78, current: 96, tone: "green" },
  { prior: 75, current: 93, tone: "green" },
  { prior: 72, current: 90, tone: "green" },
  { prior: 69, current: 87, tone: "yellow" },
  { prior: 66, current: 85, tone: "yellow" },
  { prior: 63, current: 83, tone: "yellow" },
  { prior: 60, current: 2, tone: "flat" },
  { prior: 56, current: 2, tone: "flat" },
  { prior: 52, current: 2, tone: "flat" },
  { prior: 47, current: 2, tone: "flat" },
  { prior: 42, current: 2, tone: "flat" },
  { prior: 36, current: 2, tone: "flat" },
];

export const hazelProfile = {
  bornDate: "11 February 2023",
  ageLabel: "3 years 5 months",
  healthCount: 6,
  lactationCount: 2,
  calvesCount: 1,
  dam: { name: "Willow", tag: "0921", breed: "Jersey" },
  sire: { name: "Unknown", tag: "AI · no record" },
  peakGalDay: 2.9,
  daysInMilk: 64,
  costPerGallon: 0.62,
};

export const hazelMilkDestinations: MilkDestination[] = [
  { date: "4 Aug", batch: "excluded", gallons: 1.8, outcome: "Fed to pigs", outcomeColor: "ochre", value: "—", excluded: true },
  { date: "3 Aug", batch: "excluded", gallons: 1.9, outcome: "Fed to pigs", outcomeColor: "ochre", value: "—", excluded: true },
  { date: "29 Jul", batch: "Raw milk · pooled", gallons: 2.4, outcome: "Sold · 3 pickups", outcomeColor: "herd", value: "$19.20" },
  { date: "28 Jul", batch: "Raw milk · pooled", gallons: 2.5, outcome: "Sold · 4 pickups", outcomeColor: "herd", value: "$20.00" },
];

export const hazelMilkDestinationsSummary = {
  date: "7 days",
  batch: "3 sold · 4 discarded",
  gallons: 14.6,
  outcome: "7.4 unsellable",
  value: "$57.60",
};

export const hazelCosts = [
  { label: "Feed · share of herd", amount: 498, pct: 68 },
  { label: "Vet & medicine", amount: 178, pct: 24 },
  { label: "Bedding & supplies", amount: 58, pct: 8 },
];

export const hazelHealthTimeline: HealthEvent[] = [
  { date: "30 Jul", title: "Excede · metritis", detail: "withdrawal 10 days · vet $178", detailColor: "ochre" },
  { date: "2 Jun", title: "Hoof trim", detail: "routine · $45" },
  { date: "1 Jun", title: "Freshened · L2", detail: "bull calf · tag 1141" },
];

// ─── Customer store (1d) ───────────────────────────────────────────────

export const storeProducts: StoreProduct[] = [
  { id: "raw-milk", name: "Raw milk", unitPrice: "$8.00 per gallon", quantityLeft: 7.4, unitLabel: "gallons left" },
  { id: "eggs", name: "Eggs", unitPrice: "$6.50 per dozen", quantityLeft: 9, unitLabel: "dozen left" },
  {
    id: "ground-beef",
    name: "Ground beef",
    unitPrice: "$9.00 per pound",
    quantityLeft: null,
    unitLabel: "",
    soldOut: true,
    soldOutNote: "Back in September, after the next processing date.",
  },
];

export const customerPickups: Pickup[] = [
  { title: "2 gal raw milk", schedule: "Every Friday · next 7 August", amount: "$16.00", weekly: true },
  { title: "1 dozen eggs", schedule: "Reserved 3 August · pay at pickup", amount: "$6.50" },
];
