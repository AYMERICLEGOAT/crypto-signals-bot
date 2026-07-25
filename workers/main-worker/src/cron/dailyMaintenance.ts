/**
 * Bloc 7 : archivage + purge quotidiens. Un seul créneau par jour, gaté par
 * la contrainte UNIQUE(stat_date) de daily_stats (voir db/dailyStats.ts) —
 * si l'instantané du jour existe déjà, tout le reste (purge incluse) est
 * sauté jusqu'au lendemain : pas besoin d'une table de gate séparée.
 */

import { Env, dbConfig } from "../env";
import { hasComputedStatsToday, computeAndStoreDailyStats } from "../db/dailyStats";
import { purgeOldSentMomentumAlerts } from "../db/momentumAlerts";
import { expireStalePendingPayments } from "../db/payments";

const MOMENTUM_ALERT_RETENTION_DAYS = 30;
const PENDING_PAYMENT_STALE_DAYS = 7;

export async function runDailyMaintenance(env: Env): Promise<void> {
  const db = dbConfig(env);
  if (await hasComputedStatsToday(db)) return;

  await computeAndStoreDailyStats(db);
  await purgeOldSentMomentumAlerts(db, MOMENTUM_ALERT_RETENTION_DAYS);
  await expireStalePendingPayments(db, PENDING_PAYMENT_STALE_DAYS);
}
