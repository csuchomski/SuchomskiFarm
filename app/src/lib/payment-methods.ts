import { supabase } from "./supabase";

/**
 * How a pickup was paid for.
 *
 * This is a lookup table rather than a constant because the database is the
 * one enforcing it: complete_pickup and complete_scheduled_pickup both refuse
 * a method they don't recognise. Keeping a hard-coded list in the app that
 * drifted from the table would mean a dropdown offering something the server
 * then rejects — which is exactly what happened with "Check" before migration
 * 022, only in the other direction.
 *
 * See docs/migrations/022-payment-methods.sql. Adding a method there needs no
 * change here.
 */

export interface PaymentMethodOption {
  code: string;
  label: string;
  active: boolean;
  sort_order: number;
}

/**
 * What the two database functions accepted before 022. Used only when
 * public.payment_methods isn't there — offering Check against the old
 * hard-coded check would produce 'Invalid payment method' at the moment of
 * collection, with the customer standing in the yard.
 */
export const FALLBACK_PAYMENT_METHODS: PaymentMethodOption[] = [
  { code: "Cash", label: "Cash", active: true, sort_order: 10 },
  { code: "Venmo", label: "Venmo", active: true, sort_order: 20 },
];

const missingTable = (message: string) => /does not exist|schema cache|not find the table/i.test(message);

export async function fetchPaymentMethods(): Promise<PaymentMethodOption[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("code, label, active, sort_order")
    .order("sort_order");

  if (error) {
    if (missingTable(error.message)) return FALLBACK_PAYMENT_METHODS;
    throw new Error(`payment_methods: ${error.message}`);
  }

  // Retired methods stay in the table so old orders keep their label, but
  // they aren't on offer for a new pickup — same rule the functions apply.
  const active = ((data ?? []) as PaymentMethodOption[]).filter((m) => m.active);
  return active.length > 0 ? active : FALLBACK_PAYMENT_METHODS;
}

export const methodCodes = (methods: PaymentMethodOption[]): string[] => methods.map((m) => m.code);
