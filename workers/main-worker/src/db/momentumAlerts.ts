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

/**
 * Fraîcheur maximale d'une alerte diffusable.
 *
 * Ces alertes décrivent l'état du marché À L'INSTANT où elles sont calculées.
 * Publier une observation de la semaine dernière sous le titre « Mouvements du
 * jour » est faux deux fois : la donnée est périmée, et le titre ment sur sa
 * date.
 */
export const FRAICHEUR_MAX_HEURES = 24;

/**
 * Alertes non encore diffusées, ET récentes.
 *
 * LE FILTRE D'ÂGE N'EXISTAIT PAS, et voici ce que ça donnait en production.
 * Le moteur EMA/RSI a été désactivé le 03/08/2026 après avoir été mesuré
 * PERDANT. Il avait produit 90 alertes ce jour-là, dont 17 seulement étaient
 * parties. Les 73 restantes sont demeurées en file, et le cron les a
 * distillées à raison de huit par jour sur le canal VIP — c'est-à-dire sur le
 * canal PAYANT.
 *
 * Le 09/08, six jours après la désactivation, les abonnés recevaient donc
 * encore « Croisement EMA baissier détecté, RSI (51) ne confirme pas encore » :
 * une analyse périmée, rédigée dans le vocabulaire de la stratégie que ce
 * projet a lui-même désavouée, et présentée comme l'actualité du jour. Sans ce
 * filtre, le goutte-à-goutte aurait duré neuf jours de plus.
 *
 * La borne d'âge est la bonne réponse plutôt qu'une purge ponctuelle : elle
 * protège aussi du cas général — une panne de diffusion de plusieurs jours
 * suivie d'un rattrapage massif de contenu obsolète.
 */
export async function getUnsentMomentumAlerts(db: SupabaseConfig, limit = 20): Promise<MomentumAlertRecord[]> {
  const depuis = new Date(Date.now() - FRAICHEUR_MAX_HEURES * 3_600_000).toISOString();
  return selectRows<MomentumAlertRecord>(db, "momentum_alerts", {
    sent_to_channel: "eq.false",
    created_at: `gte.${depuis}`,
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
