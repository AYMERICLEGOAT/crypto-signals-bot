import { supabase } from "./supabaseClient";

export type PaymentMethod = "USDT" | "XMR" | "LTC";
export type PaymentStatus = "pending" | "confirmed" | "expired";

export interface PendingPayment {
  id: number;
  telegram_id: number;
  method: PaymentMethod;
  plan: number;
  pay_address: string | null;
  address_index: number | null;
  amount_expected: number | null;
  status: PaymentStatus;
  created_at: string;
  confirmed_at: string | null;
}

export async function createPendingPayment(params: {
  telegramId: number;
  method: PaymentMethod;
  plan: number;
  payAddress?: string;
  addressIndex?: number;
  amountExpected?: number;
}): Promise<PendingPayment> {
  const { data, error } = await supabase
    .from("pending_payments")
    .insert({
      telegram_id: params.telegramId,
      method: params.method,
      plan: params.plan,
      pay_address: params.payAddress ?? null,
      address_index: params.addressIndex ?? null,
      amount_expected: params.amountExpected ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PendingPayment;
}

/** Utilisé par les pollers Monero/Litecoin : tous les paiements en attente pour une méthode donnée. */
export async function getPendingPayments(method: PaymentMethod): Promise<PendingPayment[]> {
  const { data, error } = await supabase
    .from("pending_payments")
    .select("*")
    .eq("method", method)
    .eq("status", "pending");
  if (error) throw error;
  return (data || []) as PendingPayment[];
}

export async function getLatestPendingPayment(
  telegramId: number,
  method: PaymentMethod
): Promise<PendingPayment | null> {
  const { data, error } = await supabase
    .from("pending_payments")
    .select("*")
    .eq("telegram_id", telegramId)
    .eq("method", method)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as PendingPayment) || null;
}

export async function markPaymentConfirmed(id: number): Promise<void> {
  const { error } = await supabase
    .from("pending_payments")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
