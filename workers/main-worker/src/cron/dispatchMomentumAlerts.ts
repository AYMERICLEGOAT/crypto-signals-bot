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
import { getUnsentMomentumAlerts, markMomentumAlertSent, countMomentumAlertsSentSince, MomentumAlertRecord } from "../db/momentumAlerts";
import { sendMessage } from "../telegram";
import { isQuietHours } from "../utils/quietHours";

function formatMomentumAlert(alert: MomentumAlertRecord): string {
  return [
    `⚡ *Alerte Momentum — ${alert.pair}*`,
    alert.detail,
    "",
    "ℹ️ Information sur la dynamique du marché, PAS un signal de trading (pas de stop loss/take profit). " +
      "Signaux réels + suivi complet : /subscribe",
  ].join("\n");
}

// Retour admin (29/07 puis 30/07, "120 messages d'un coup") : le vrai bug
// n'était pas cette limite mais countMomentumAlertsSentSince (voir
// db/momentumAlerts.ts) qui comptait par date de DÉTECTION au lieu de date
// d'ENVOI -- un stock d'alertes en retard se drainait alors sans jamais
// compter contre le plafond quotidien, cycle de 5 min après cycle de 5 min.
// Corrigé (sent_at). Abaissée à 3 en plus (30/07) pour étaler davantage tout
// pic ponctuel : aucune alerte n'est perdue, juste diffusée plus lentement.
// Ramené de 3 à 2 le 02/08/2026 : le canal public recevait des rafales
// d'alertes perçues comme du spam. Le surplus n'est pas perdu -- il reste
// en base non envoyé et part au cycle suivant, étalé dans le temps.
const MAX_ALERTS_PER_DISPATCH = 2;

// Retour admin (29/07) : étaler sur plusieurs cycles de 5 min ne suffisait pas
// -- avec 28 paires et le cron toutes les 5 min, la pile peut se reconstituer
// aussi vite qu'elle se vide un jour de marché agité, et le total sur une
// journée entière restait perçu comme du spam (30+ alertes/jour). Plafond
// quotidien réel, distinct du plafond par cycle ci-dessus : au-delà, les
// alertes restent en attente (rien n'est perdu) mais ne sont plus diffusées
// avant le lendemain -- mieux vaut un canal qui garde de la valeur perçue
// qu'un canal qui rattrape coûte que coûte tout son retard.
const MAX_ALERTS_PER_DAY = 8;

function startOfTodayUtcIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function dispatchMomentumAlerts(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return; // canal non configuré, rien à faire

  const db = dbConfig(env);
  const channelId = Number(env.TELEGRAM_CHANNEL_ID);

  const sentToday = await countMomentumAlertsSentSince(db, startOfTodayUtcIso());
  const remainingToday = MAX_ALERTS_PER_DAY - sentToday;
  if (remainingToday <= 0) return;

  const due = await getUnsentMomentumAlerts(db, Math.min(MAX_ALERTS_PER_DISPATCH, remainingToday));
  if (due.length === 0) return;

  // Les alertes de contexte restent sur le canal : seuls les vrais signaux
  // et leurs suivis méritent une notification privée.
  const recipientIds: number[] = [];

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
