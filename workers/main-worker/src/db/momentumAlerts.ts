import { SupabaseConfig, selectRows, updateRows, deleteRows } from "../supabaseRest";

export type MomentumAlertKind = "rsi_neutral_exit" | "ema_cross_unconfirmed" | "atr_spike";

export interface MomentumAlertRecord {
  id: number;
  pair: string;
  kind: MomentumAlertKind;
  detail: string;
  created_at: string;
  sent_to_channel: boolean;
  sent_at: string | null;
}

export async function getUnsentMomentumAlerts(db: SupabaseConfig, limit = 20): Promise<MomentumAlertRecord[]> {
  return selectRows<MomentumAlertRecord>(db, "momentum_alerts", {
    sent_to_channel: "eq.false",
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markMomentumAlertSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "momentum_alerts", { id: `eq.${id}` }, { sent_to_channel: true, sent_at: new Date().toISOString() });
}

/** Bloc 12.3 — récap hebdomadaire : alertes momentum envoyées depuis `sinceIso`. */
/**
 * Comme getMomentumAlertsSince mais avec le contenu, pour le bilan de
 * sélectivité (voir cron/dispatchSelectivityDigest.ts). Fonction distincte :
 * celle ci-dessus ne sert qu'à compter et ne doit pas rapatrier plus que
 * nécessaire.
 */
export async function getMomentumAlertDetailsSince(db: SupabaseConfig, sinceIso: string): Promise<MomentumAlertRecord[]> {
  return selectRows<MomentumAlertRecord>(db, "momentum_alerts", {
    created_at: `gte.${sinceIso}`,
    order: "created_at.desc",
  });
}

export async function getMomentumAlertsSince(db: SupabaseConfig, sinceIso: string): Promise<{ id: number }[]> {
  return selectRows<{ id: number }>(db, "momentum_alerts", { created_at: `gte.${sinceIso}`, select: "id" });
}

/** Retour terrain (29/07) : plafond quotidien (pas seulement par cycle de cron) — voir dispatchMomentumAlerts.ts. */
/**
 * Correctif 30/07 : filtrait sur `created_at` (date de DÉTECTION), pas la
 * date d'envoi réelle -- un stock d'anciennes alertes en retard (accumulé
 * pendant un ralentissement du cron signals.yml) se drainait alors SANS
 * jamais compter contre ce plafond, cycle de 5 min après cycle de 5 min,
 * jusqu'à épuisement complet du stock (retour admin : "120 messages d'un
 * coup"). `sent_at` (voir markMomentumAlertSent) compte par date d'ENVOI.
 */
export async function countMomentumAlertsSentSince(db: SupabaseConfig, sinceIso: string): Promise<number> {
  const rows = await selectRows<{ id: number }>(db, "momentum_alerts", {
    sent_at: `gte.${sinceIso}`,
    select: "id",
  });
  return rows.length;
}

/** Purge (Bloc 7) : alertes déjà diffusées, sans valeur une fois postées — évite une croissance illimitée de la table. */
export async function purgeOldSentMomentumAlerts(db: SupabaseConfig, olderThanDays: number): Promise<void> {
  const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  await deleteRows(db, "momentum_alerts", { sent_to_channel: "eq.true", created_at: `lt.${threshold}` });
}
