import { SupabaseConfig, selectRows, updateRows, deleteRows } from "../supabaseRest";

export type MomentumAlertKind = "rsi_neutral_exit" | "ema_cross_unconfirmed" | "atr_spike";

export interface MomentumAlertRecord {
  id: number;
  pair: string;
  kind: MomentumAlertKind;
  detail: string;
  created_at: string;
  sent_to_channel: boolean;
}

export async function getUnsentMomentumAlerts(db: SupabaseConfig, limit = 20): Promise<MomentumAlertRecord[]> {
  return selectRows<MomentumAlertRecord>(db, "momentum_alerts", {
    sent_to_channel: "eq.false",
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markMomentumAlertSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "momentum_alerts", { id: `eq.${id}` }, { sent_to_channel: true });
}

/** Bloc 12.3 — récap hebdomadaire : alertes momentum envoyées depuis `sinceIso`. */
export async function getMomentumAlertsSince(db: SupabaseConfig, sinceIso: string): Promise<{ id: number }[]> {
  return selectRows<{ id: number }>(db, "momentum_alerts", { created_at: `gte.${sinceIso}`, select: "id" });
}

/** Purge (Bloc 7) : alertes déjà diffusées, sans valeur une fois postées — évite une croissance illimitée de la table. */
export async function purgeOldSentMomentumAlerts(db: SupabaseConfig, olderThanDays: number): Promise<void> {
  const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  await deleteRows(db, "momentum_alerts", { sent_to_channel: "eq.true", created_at: `lt.${threshold}` });
}
