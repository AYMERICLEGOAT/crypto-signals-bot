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

/** /check_payment — le tout dernier paiement quel que soit son statut (pending/confirmed/expired), pour distinguer "jamais tenté" de "confirmé". */
export async function getLatestPaymentAnyStatus(db: SupabaseConfig, telegramId: number): Promise<PendingPayment | null> {
  const rows = await selectRows<PendingPayment>(db, "pending_payments", {
    telegram_id: `eq.${telegramId}`,
    order: "created_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}

/**
 * Réclame ATOMIQUEMENT un paiement pending (anti-race, voir cron/pollPayments.ts) :
 * le filtre `status=eq.pending` fait que si deux invocations du Worker se
 * chevauchent (ex: un appel Monero-RPC/Blockchair qui traîne au-delà du
 * cycle de cron de 5 min), une seule des deux PATCH renvoie une ligne — la
 * seconde reçoit un tableau vide et doit s'abstenir de retraiter ce paiement
 * (double activation, double crédit de parrainage, double message).
 * Retourne true si CETTE invocation a bien gagné la réclamation.
 */
export async function markPaymentConfirmed(db: SupabaseConfig, id: number): Promise<boolean> {
  const rows = await updateRows(
    db,
    "pending_payments",
    { id: `eq.${id}`, status: "eq.pending" },
    { status: "confirmed", confirmed_at: new Date().toISOString() }
  );
  return rows.length > 0;
}

/**
 * Compense un échec APRÈS la réclamation (ex: activateSubscription lève une
 * exception) : remet le paiement en attente pour qu'il soit retenté au
 * prochain cycle plutôt que de rester bloqué en "confirmed" sans jamais
 * avoir été réellement activé (voir le fix payé/pas-activé de ce soir).
 */
export async function revertPendingPayment(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "pending_payments", { id: `eq.${id}` }, { status: "pending", confirmed_at: null });
}

/**
 * Purge (Bloc 7) : paiements jamais finalisés, abandonnés depuis
 * `olderThanDays` — sans ça, les paiements XMR/LTC (poll_Payments.ts les
 * boucle en entier à CHAQUE cycle de 5 min) s'accumuleraient indéfiniment
 * et gaspilleraient des appels blockchain sur des tentatives mortes.
 */
export async function expireStalePendingPayments(db: SupabaseConfig, olderThanDays: number): Promise<void> {
  const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  await updateRows(
    db,
    "pending_payments",
    { status: "eq.pending", created_at: `lt.${threshold}` },
    { status: "expired" }
  );
}
