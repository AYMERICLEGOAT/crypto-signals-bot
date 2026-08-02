/**
 * Diffuse les signaux déjà envoyés aux abonnés vers le canal Telegram public
 * gratuit, avec un délai — c'est le canal "vitrine" qui sert à attirer des
 * membres vers l'abonnement payant (temps réel + VIP).
 *
 * Le délai (30 min) est volontairement supérieur à celui du palier
 * Standard/Découverte (15 min, voir cron/dispatchStandardTier.ts,
 * SNIPER_DELAY_MINUTES) : même les plans payants les moins chers gardent une
 * longueur d'avance sur le canal gratuit.
 */

import { Env, dbConfig } from "../env";
import { getSignalsDueForPublicChannel, markSentToChannel, SignalRecord } from "../db/signals";
import { sendMessage, sendPhoto } from "../telegram";
import { buildSignalMessage } from "../signalFormat";
import { isQuietHours } from "../utils/quietHours";

const CHANNEL_DELAY_MINUTES = 30;

/**
 * Le délai annoncé est CALCULÉ, pas écrit en dur (02/08/2026). Depuis
 * l'instauration des heures calmes, un signal détecté à 3 h du matin n'est
 * publié ici qu'après 7 h : annoncer « différé de 30 min » serait alors
 * faux de plusieurs heures, sur le canal même où l'on met en avant la
 * transparence. Un abonné qui compare l'horodatage à la mention aurait
 * raison de douter du reste.
 */
function formatPublicChannelMessage(signal: SignalRecord, botUsername: string): string {
  const minutes = Math.max(
    CHANNEL_DELAY_MINUTES,
    Math.round((Date.now() - new Date(signal.created_at).getTime()) / 60000)
  );
  const delayNote =
    minutes < 90
      ? `signal différé de ${minutes} min`
      : `signal différé de ${Math.round(minutes / 60)} h (détecté cette nuit, publié à la réouverture du canal)`;

  return buildSignalMessage(signal, { delayNote, ctaUsername: botUsername });
}

export async function dispatchPublicChannel(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return; // canal non configuré, rien à faire

  const db = dbConfig(env);
  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  const due = await getSignalsDueForPublicChannel(db, CHANNEL_DELAY_MINUTES);

  for (const signal of due) {
    const text = formatPublicChannelMessage(signal, env.TELEGRAM_BOT_USERNAME);
    try {
      if (signal.chart_url) {
        await sendPhoto(env.TELEGRAM_BOT_TOKEN, channelId, signal.chart_url, { caption: text, markdown: true });
      } else {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, text, { markdown: true });
      }
      await markSentToChannel(db, signal.id);
    } catch (err) {
      console.error(`[public-channel] Échec de diffusion pour le signal #${signal.id}:`, err);
    }
  }
}
