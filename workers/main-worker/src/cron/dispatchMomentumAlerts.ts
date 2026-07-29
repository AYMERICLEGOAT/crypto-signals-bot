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

// Retour admin (29/07) : le canal public a déjà envoyé jusqu'à ~40 messages
// d'un coup un jour de marché agité (beaucoup de faux départs RSI/EMA sur les
// 28 paires génèrent autant d'alertes momentum le même cycle). Avec la limite
// précédente (20) une seule diffusion pouvait déjà noyer le canal ; on la
// réduit ici pour étaler tout retard sur plusieurs cycles de cron (5 min)
// plutôt que de vider toute la pile d'un coup — aucune alerte n'est perdue,
// juste diffusée plus progressivement.
const MAX_ALERTS_PER_DISPATCH = 5;

export async function dispatchMomentumAlerts(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return; // canal non configuré, rien à faire

  const db = dbConfig(env);
  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  const due = await getUnsentMomentumAlerts(db, MAX_ALERTS_PER_DISPATCH);
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
