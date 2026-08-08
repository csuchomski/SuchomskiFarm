import { supabase } from "./supabase";

/**
 * Standing weekly orders — a customer committing to the same pickup every
 * week, the way a subscription works.
 *
 * The date logic here mirrors public.next_pickup_date() deliberately, line
 * for line. The database uses that function to decide what to hold; this
 * file uses the same rule to project forward for the forecast. If the two
 * ever disagree, the forecast would promise stock the database has already
 * given away, so they are tested against the same cases.
 */

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** How close a pickup has to be before its stock is held out of the shop.
 * Matches the window in product_stats() and reserve_product(); changing it
 * here alone would make the app disagree with the database. */
export const HOLD_DAYS = 3;

export interface Schedule {
  id: number;
  customer_id: string;
  product_id: number;
  quantity: number;
  day: string;
  start_date: string | null;
  skipped_dates: string[];
  fulfilled_dates: string[];
  cancelled_at: string | null;
  business_id: number | null;
  note: string;
}

const COLUMNS =
  "id, customer_id, product_id, quantity, day, start_date, skipped_dates, fulfilled_dates, cancelled_at, business_id, note";

// ─── dates ─────────────────────────────────────────────────────────────

const MS_DAY = 86_400_000;

const parse = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const format = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, days: number): string => format(parse(iso) + days * MS_DAY);
const dayOfWeek = (iso: string): number => new Date(parse(iso)).getUTCDay();

/**
 * The next pickup on or after today, skipping any date already skipped or
 * already fulfilled.
 *
 * Mirrors public.next_pickup_date(). Null for a weekday name the database
 * wouldn't recognise either — better than silently picking Sunday.
 */
export function nextPickup(
  schedule: Pick<Schedule, "day" | "start_date" | "skipped_dates" | "fulfilled_dates">,
  todayIso: string,
): string | null {
  const target = WEEKDAYS.indexOf(schedule.day as Weekday);
  if (target < 0) return null;

  const start = schedule.start_date && schedule.start_date > todayIso ? schedule.start_date : todayIso;
  let d = start;
  // Walk forward to the right weekday…
  for (let i = 0; i < 7 && dayOfWeek(d) !== target; i++) d = addDays(d, 1);
  if (dayOfWeek(d) !== target) return null;

  // …then past any week that's been skipped or already collected.
  const blocked = new Set([...(schedule.skipped_dates ?? []), ...(schedule.fulfilled_dates ?? [])]);
  // 520 weeks is ten years; a standing order blocked past that is a data
  // problem, not something to loop forever over.
  for (let i = 0; i < 520 && blocked.has(d); i++) d = addDays(d, 7);
  return blocked.has(d) ? null : d;
}

/** Every pickup this standing order would make between two dates, inclusive
 * of both ends. What the forecast walks. */
export function occurrencesBetween(
  schedule: Pick<Schedule, "day" | "start_date" | "skipped_dates" | "fulfilled_dates" | "cancelled_at">,
  fromIso: string,
  toIso: string,
): string[] {
  if (schedule.cancelled_at) return [];
  const target = WEEKDAYS.indexOf(schedule.day as Weekday);
  if (target < 0 || fromIso > toIso) return [];

  const start = schedule.start_date && schedule.start_date > fromIso ? schedule.start_date : fromIso;
  let d = start;
  for (let i = 0; i < 7 && dayOfWeek(d) !== target; i++) d = addDays(d, 1);

  const blocked = new Set([...(schedule.skipped_dates ?? []), ...(schedule.fulfilled_dates ?? [])]);
  const out: string[] = [];
  for (let i = 0; i < 520 && d <= toIso; i++) {
    if (!blocked.has(d)) out.push(d);
    d = addDays(d, 7);
  }
  return out;
}

/** True when the next pickup is close enough that its stock is held out of
 * the shop. */
export function isHeld(schedule: Schedule, todayIso: string): boolean {
  if (schedule.cancelled_at) return false;
  const next = nextPickup(schedule, todayIso);
  return next !== null && next <= addDays(todayIso, HOLD_DAYS);
}

export const isActive = (s: Schedule): boolean => s.cancelled_at === null;

/** "in 2 days", "today", "tomorrow" — how far off the next pickup is. */
export function untilLabel(pickupIso: string | null, todayIso: string): string {
  if (!pickupIso) return "no next pickup";
  const days = Math.round((parse(pickupIso) - parse(todayIso)) / MS_DAY);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

// ─── how much can be signed up for ─────────────────────────────────────

export interface DayCapacity {
  weekday: Weekday;
  /** The next date that weekday falls on, today included. */
  pickupDate: string;
  /** Forecast quantity free that day. An estimate — the shop says so. */
  available: number;
}

/**
 * What the farm expects to have free on each of the next seven weekdays.
 *
 * Comes from public.schedule_capacity (migration 023) rather than being
 * worked out here, because the two inputs are both behind RLS for a buyer:
 * production history isn't theirs to read, and neither are other customers'
 * standing orders. The function returns the aggregate and nothing else.
 *
 * Null when the function isn't deployed — the caller falls back to what's on
 * the shelf today, which is a number the shop can see for itself.
 */
export async function fetchScheduleCapacity(productId: number): Promise<DayCapacity[] | null> {
  const { data, error } = await supabase.rpc("schedule_capacity", { p_product_id: productId });
  if (error) {
    if (/does not exist|schema cache|not find the function/i.test(error.message)) return null;
    throw new Error(`schedule_capacity: ${error.message}`);
  }
  return ((data ?? []) as { weekday: string; pickup_date: string; available: number }[]).map((row) => ({
    weekday: row.weekday as Weekday,
    pickupDate: row.pickup_date,
    available: Number(row.available),
  }));
}

/**
 * The same seven days, every one of them offering what's on the shelf right
 * now. Used only when schedule_capacity isn't there.
 *
 * Flat rather than growing with the days, deliberately: without the
 * function there is no production rate to grow by, and inventing one would
 * put quantities in the dropdown that nothing supports.
 */
export function capacityFromStock(available: number, todayIso: string): DayCapacity[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(todayIso, i);
    return { weekday: WEEKDAYS[dayOfWeek(date)], pickupDate: date, available };
  });
}

// ─── validation ────────────────────────────────────────────────────────

export function validateSchedule(input: {
  productId: string;
  customerId: string;
  quantity: string;
  day: string;
  startDate: string;
  todayIso: string;
}): string | null {
  if (!input.customerId) return "Who is this standing order for?";
  if (!input.productId) return "Pick a product.";
  if (!WEEKDAYS.includes(input.day as Weekday)) return "Pick a day of the week.";

  const raw = input.quantity.trim();
  if (raw === "") return "How much every week?";
  const qty = Number(raw);
  if (!Number.isFinite(qty)) return "The quantity has to be a number.";
  // The column is `check (quantity > 0)`, so zero fails at the database.
  if (qty <= 0) return "A standing order needs a quantity above zero.";

  if (input.startDate && input.startDate < input.todayIso) return "The start date is in the past.";
  return null;
}

// ─── reads ─────────────────────────────────────────────────────────────

export async function fetchSchedules(businessId: number): Promise<Schedule[]> {
  const { data, error } = await supabase
    .from("schedules")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("day");
  if (error) throw new Error(`schedules: ${error.message}`);
  return normalise(data);
}

/** A customer's own standing orders, across every business they buy from. */
export async function fetchMySchedules(customerId: string): Promise<Schedule[]> {
  const { data, error } = await supabase.from("schedules").select(COLUMNS).eq("customer_id", customerId);
  if (error) throw new Error(`schedules: ${error.message}`);
  return normalise(data);
}

/** jsonb comes back as whatever was stored; a null or a non-array would
 * crash the date walk, so it's flattened to [] here rather than guarded at
 * every use. */
function normalise(data: unknown): Schedule[] {
  return ((data ?? []) as Schedule[]).map((s) => ({
    ...s,
    quantity: Number(s.quantity),
    skipped_dates: Array.isArray(s.skipped_dates) ? s.skipped_dates : [],
    fulfilled_dates: Array.isArray(s.fulfilled_dates) ? s.fulfilled_dates : [],
    note: s.note ?? "",
  }));
}

// ─── writes ────────────────────────────────────────────────────────────

export async function createSchedule(input: {
  businessId: number;
  customerId: string;
  productId: number;
  quantity: number;
  day: Weekday;
  startDate: string | null;
  note?: string;
}): Promise<Schedule> {
  const { data, error } = await supabase
    .from("schedules")
    .insert({
      business_id: input.businessId,
      customer_id: input.customerId,
      product_id: input.productId,
      quantity: input.quantity,
      day: input.day,
      start_date: input.startDate,
      note: input.note?.trim() ?? "",
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return normalise([data])[0];
}

/**
 * Skipping a week. The date is added to skipped_dates, which both
 * next_pickup_date() and the forecast walk past — so the stock stops being
 * held immediately and the following week becomes the next pickup.
 */
export async function skipWeek(schedule: Schedule, dateIso: string): Promise<Schedule> {
  if (schedule.skipped_dates.includes(dateIso)) return schedule;
  const { data, error } = await supabase
    .from("schedules")
    .update({ skipped_dates: [...schedule.skipped_dates, dateIso] })
    .eq("id", schedule.id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return normalise([data])[0];
}

export async function unskipWeek(schedule: Schedule, dateIso: string): Promise<Schedule> {
  const { data, error } = await supabase
    .from("schedules")
    .update({ skipped_dates: schedule.skipped_dates.filter((d) => d !== dateIso) })
    .eq("id", schedule.id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return normalise([data])[0];
}

/**
 * Cancelling sets a date rather than deleting the row: fulfilled_dates is
 * the record of every pickup ever made against this standing order, and
 * deleting takes that with it. There is no delete policy on the table for
 * the same reason.
 */
export async function cancelSchedule(id: number): Promise<Schedule> {
  const { data, error } = await supabase
    .from("schedules")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return normalise([data])[0];
}

export async function resumeSchedule(id: number): Promise<Schedule> {
  const { data, error } = await supabase
    .from("schedules")
    .update({ cancelled_at: null })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return normalise([data])[0];
}

export async function updateSchedule(
  id: number,
  patch: { quantity: number; day: Weekday; note: string },
): Promise<Schedule> {
  const { data, error } = await supabase
    .from("schedules")
    .update({ quantity: patch.quantity, day: patch.day, note: patch.note.trim() })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return normalise([data])[0];
}

/**
 * Hands over this week's pickup. Consumes stock, writes a completed order
 * and marks the date fulfilled — all in one database function, so the three
 * can't come apart.
 *
 * Since migration 022 the function refuses a customer more than the standing
 * order is for, so a mistyped quantity can't empty the shelf. A farmer is
 * exempt — handing over an extra gallon at the gate is a real thing.
 */
export async function fulfilPickup(input: {
  scheduleId: number;
  quantity?: number | null;
  /** A code from public.payment_methods, checked against that table. */
  paymentMethod?: string | null;
  amountPaid?: number | null;
}): Promise<number> {
  const { data, error } = await supabase.rpc("complete_scheduled_pickup", {
    p_schedule_id: input.scheduleId,
    p_quantity: input.quantity ?? null,
    p_payment_method: input.paymentMethod ?? null,
    p_amount_paid: input.amountPaid ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}
