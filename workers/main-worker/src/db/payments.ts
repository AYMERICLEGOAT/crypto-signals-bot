import { SupabaseConfig, selectRows, selectOne, insertRow, updateRows } from "../supabaseRest";

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

export async function createPendingPayment(
  db: SupabaseConfig,
  params: {
    telegramId: number;
    method: PaymentMethod;
    plan: number;
    payAddress?: string;
    addressIndex?: number;
    amountExpected?: number;
  }
): Promise<PendingPayment> {
  return insertRow<PendingPayment>(db, "pending_payments", {
    telegram_id: params.telegramId,
    method: params.method,
    plan: params.plan,
    pay_address: params.payAddress ?? null,
    address_index: params.addressIndex ?? null,
    amount_expected: params.amountExpected ?? null,
  });
}

export async function getPendingPayments(db: SupabaseConfig, method: PaymentMethod): Promise<PendingPayment[]> {
  return selectRows<PendingPayment>(db, "pending_payments", {
    method: `eq.${method}`,
    status: "eq.pending",
  });
}

export async function getLatestPendingPayment(
  db: SupabaseConfig,
  telegramId: number,
  method: PaymentMethod
): Promise<PendingPayment | null> {
  const rows = await selectRows<PendingPayment>(db, "pending_payments", {
    telegram_id: `eq.${telegramId}`,
    method: `eq.${method}`,
    status: "eq.pending",
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}

/** Utilisé par /pay : rappelle le paiement en cours, peu importe la méthode choisie. */
export async function getLatestPendingPaymentAnyMethod(
  db: SupabaseConfig,
  telegramId: number
): Promise<PendingPayment | null> {
  const rows = await selectRows<PendingPayment>(db, "pending_payments", {
    telegram_id: `eq.${telegramId}`,
    status: "eq.pending",
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function markPaymentConfirmed(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(
    db,
    "pending_payments",
    { id: `eq.${id}` },
    { status: "confirmed", confirmed_at: new Date().toISOString() }
  );
}
