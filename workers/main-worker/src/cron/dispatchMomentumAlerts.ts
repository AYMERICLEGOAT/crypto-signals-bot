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

/** Même contenu, sans l'appel à l'abonnement : le lecteur est déjà abonné. */
function formatVipMomentumAlert(alert: MomentumAlertRecord): string {
  return [
    `⚡ *Alerte Momentum — ${alert.pair}*`,
    alert.detail,
    "",
    "ℹ️ Dynamique de marché, PAS un signal de trading (ni stop loss ni take profit).",
    "🔑 Alerte réservée aux abonnés : le canal public est plafonné à 2 par cycle.",
  ].join("\n");
}

// Surplus dirigé vers le canal VIP à chaque cycle, en plus du quota public.
// Volontairement modeste : l'objectif est de donner un avantage réel aux
// abonnés, pas de reproduire en VIP le spam qu'on vient de retirer du canal
// public.
const MAX_VIP_OVERFLOW_PER_DISPATCH = 3;

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

  // On récupère AU-DELÀ du plafond public : les premières partent sur le
  // canal gratuit, le surplus va au canal VIP (voir plus bas). Sans cette
  // marge, le surplus attendait simplement le cycle suivant et les abonnés
  // payants n'avaient jamais rien de plus que les autres.
  const publicQuota = Math.min(MAX_ALERTS_PER_DISPATCH, remainingToday);
  const due = await getUnsentMomentumAlerts(db, publicQuota + MAX_VIP_OVERFLOW_PER_DISPATCH);
  if (due.length === 0) return;

  const forPublic = due.slice(0, publicQuota);
  const forVip = due.slice(publicQuota);

  for (const alert of forPublic) {
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatMomentumAlert(alert), { markdown: true });
      await markMomentumAlertSent(db, alert.id);
    } catch (err) {
      console.error(`[momentum-alerts] Échec de diffusion pour l'alerte #${alert.id}:`, err);
    }
  }

  // Surplus réservé aux abonnés payants (demande du 02/08/2026). Le canal
  // public est volontairement limité à 2 alertes par cycle pour ne pas
  // ressembler à du spam ; les alertes suivantes, plutôt que d'attendre,
  // deviennent un avantage concret du canal VIP — qui ne recevait jusqu'ici
  // QUE des messages de célébration, donc presque rien.
  if (!env.TELEGRAM_VIP_CHANNEL_ID || forVip.length === 0) return;
  const vipChannelId = Number(env.TELEGRAM_VIP_CHANNEL_ID);
  for (const alert of forVip) {
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, vipChannelId, formatVipMomentumAlert(alert), { markdown: true });
      await markMomentumAlertSent(db, alert.id);
    } catch (err) {
      console.error(`[momentum-alerts] Échec de diffusion VIP pour l'alerte #${alert.id}:`, err);
    }
  }
}
