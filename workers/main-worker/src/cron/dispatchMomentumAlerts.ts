/**
 * Bloc 3 : diffuse les Alertes Momentum (signals/momentum.py) sur le canal
 * public gratuit. Ce ne sont pas des trades (pas de stop loss/take profit),
 * juste du contenu d'engagement pour garder le canal actif entre deux vrais
 * signaux ; le format (⚡, pas de BUY/SELL) évite toute confusion avec
 * cron/dispatchSignals.ts.
 *
 * Bloc 19 : en plus du canal, envoyé aussi en DM aux abonnés actifs n'ayant
 * pas désactivé "Alertes Momentum" dans /prefs (activé par défaut).
 */

import { Env, dbConfig } from "../env";
import { getUnsentMomentumAlerts, markMomentumAlertSent, MomentumAlertRecord } from "../db/momentumAlerts";
import { getActiveUsers } from "../db/users";
import { filterByPref } from "../db/userPrefs";
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
  if (due.length === 0) return;

  const activeUsers = await getActiveUsers(db);
  const recipientIds = await filterByPref(db, activeUsers.map((u) => u.telegram_id), "momentum_alerts");

  for (const alert of due) {
    const text = formatMomentumAlert(alert);
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, text, { markdown: true });
      await markMomentumAlertSent(db, alert.id);
    } catch (err) {
      console.error(`[momentum-alerts] Échec de diffusion pour l'alerte #${alert.id}:`, err);
      continue; // pas de DM pour une alerte pas marquee comme envoyee au canal (evite les doublons si retente au cycle suivant)
    }
    await Promise.all(
      recipientIds.map((id) => sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true }).catch((err) =>
        console.error(`[momentum-alerts] Échec DM à ${id}:`, err)
      ))
    );
  }
}
