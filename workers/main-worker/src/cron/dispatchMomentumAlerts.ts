/**
 * Bloc 3 : diffuse les Alertes Momentum (signals/momentum.py) sur le canal
 * public gratuit UNIQUEMENT — jamais en DM aux abonnés. Ce ne sont pas des
 * trades (pas de stop loss/take profit), juste du contenu d'engagement pour
 * garder le canal actif entre deux vrais signaux ; le format (⚡, pas de
 * BUY/SELL) évite toute confusion avec cron/dispatchSignals.ts.
 */

import { Env, dbConfig } from "../env";
import { getUnsentMomentumAlerts, markMomentumAlertSent, MomentumAlertRecord } from "../db/momentumAlerts";
import { sendMessage } from "../telegram";

function formatMomentumAlert(alert: MomentumAlertRecord): string {
  return [
    `⚡ *Alerte Momentum — ${alert.pair}*`,
    alert.detail,
    "",
    "ℹ️ Information sur la dynamique du marché, PAS un signal de trading (pas de stop loss/take profit). " +
      "Signaux réels + suivi complet : /subscribe",
  ].join("\n");
}

export async function dispatchMomentumAlerts(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return; // canal non configuré, rien à faire

  const db = dbConfig(env);
  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  const due = await getUnsentMomentumAlerts(db);

  for (const alert of due) {
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatMomentumAlert(alert), { markdown: true });
      await markMomentumAlertSent(db, alert.id);
    } catch (err) {
      console.error(`[momentum-alerts] Échec de diffusion pour l'alerte #${alert.id}:`, err);
    }
  }
}
