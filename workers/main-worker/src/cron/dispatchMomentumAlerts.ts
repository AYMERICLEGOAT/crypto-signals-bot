/**
 * Alertes Momentum (signals/momentum.py) — contexte de marché, PAS des
 * trades (ni stop loss ni take profit). Le format (⚡, pas de BUY/SELL)
 * évite toute confusion avec cron/dispatchSignals.ts.
 *
 * Diffusées sur le canal VIP uniquement depuis le 02/08/2026 : voir le
 * commentaire dans la fonction pour le raisonnement complet.
 */

import { Env, dbConfig } from "../env";
import { getUnsentMomentumAlerts, markMomentumAlertSent, countMomentumAlertsSentSince, MomentumAlertRecord } from "../db/momentumAlerts";
import { sendMessage } from "../telegram";
import { isQuietHours } from "../utils/quietHours";

/** Même contenu, sans l'appel à l'abonnement : le lecteur est déjà abonné. */
function formatVipMomentumAlert(alert: MomentumAlertRecord): string {
  return [
    `⚡ *Alerte Momentum — ${alert.pair}*`,
    alert.detail,
    "",
    "ℹ️ Dynamique de marché, PAS un signal de trading (ni stop loss ni take profit).",
    "🔑 Réservé aux abonnés : le canal public ne reçoit qu'un bilan agrégé en fin de journée.",
  ].join("\n");
}

// Surplus dirigé vers le canal VIP à chaque cycle, en plus du quota public.
// Volontairement modeste : l'objectif est de donner un avantage réel aux
// abonnés, pas de reproduire en VIP le spam qu'on vient de retirer du canal
// public.

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
const MAX_ALERTS_PER_DISPATCH = 3;

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
  // Aucune publication la nuit (voir utils/quietHours.ts).
  if (isQuietHours()) return;
  // Canal VIP UNIQUEMENT depuis le 02/08/2026. Ces alertes sont les
  // configurations que la stratégie a examinées puis ÉCARTÉES : non
  // actionnables par construction (ni entrée, ni stop, ni objectif), et
  // jusqu'à 8 par jour contre ~2,5 vrais signaux, elles noyaient le canal
  // public sous ses propres rejets. Le canal public reçoit désormais un
  // BILAN quotidien agrégé à la place (voir dispatchSelectivityDigest.ts),
  // qui transforme le même fait en preuve de sélectivité.
  //
  // Elles gardent en revanche une vraie valeur pour un abonné qui trade
  // activement : le contexte de marché en temps réel. C'est exactement le
  // type de différence qui justifie un abonnement.
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;

  const db = dbConfig(env);
  const vipChannelId = Number(env.TELEGRAM_VIP_CHANNEL_ID);

  const sentToday = await countMomentumAlertsSentSince(db, startOfTodayUtcIso());
  const remainingToday = MAX_ALERTS_PER_DAY - sentToday;
  if (remainingToday <= 0) return;

  const due = await getUnsentMomentumAlerts(db, Math.min(MAX_ALERTS_PER_DISPATCH, remainingToday));
  if (due.length === 0) return;

  for (const alert of due) {
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, vipChannelId, formatVipMomentumAlert(alert), { markdown: true });
      await markMomentumAlertSent(db, alert.id);
    } catch (err) {
      console.error(`[momentum-alerts] Échec de diffusion VIP pour l'alerte #${alert.id}:`, err);
    }
  }
}
