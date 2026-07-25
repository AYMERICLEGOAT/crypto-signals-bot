import { SupabaseConfig, selectRows, insertRows } from "../supabaseRest";

export type DeliveryTier = "pro" | "standard";

/**
 * Trace qui a reçu quel signal et à quelle vitesse (Bloc 2 — Effet Sniper),
 * pour deux usages : /history (db/history.ts) et le suivi post-trade
 * (cron/trackSignalOutcomes.ts, Bloc 4) qui doit notifier précisément les
 * destinataires d'UN signal donné, pas "tous les actifs au moment de la
 * clôture" (un utilisateur peut avoir changé de plan ou s'être désabonné
 * entre l'envoi et la clôture).
 */
export async function recordDeliveries(
  db: SupabaseConfig,
  signalId: number,
  telegramIds: number[],
  tier: DeliveryTier
): Promise<void> {
  if (telegramIds.length === 0) return;
  await insertRows(
    db,
    "signal_deliveries",
    telegramIds.map((telegramId) => ({ signal_id: signalId, telegram_id: telegramId, tier }))
  );
}

interface DeliveryRow {
  telegram_id: number;
}

export async function getDeliveryRecipients(db: SupabaseConfig, signalId: number): Promise<number[]> {
  const rows = await selectRows<DeliveryRow>(db, "signal_deliveries", {
    signal_id: `eq.${signalId}`,
    select: "telegram_id",
  });
  return Array.from(new Set(rows.map((r) => r.telegram_id)));
}
