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

const CHANNEL_DELAY_MINUTES = 30;

function formatPublicChannelMessage(signal: SignalRecord, botUsername: string): string {
  const emoji = signal.type === "BUY" ? "🟢" : "🔴";
  // Le parse_mode "Markdown" de Telegram traite "_" comme un marqueur d'italique
  // non échappé : un nom d'utilisateur contenant "_" (ex. ProVIPSignals_bot) fait
  // échouer l'envoi ("can't parse entities") s'il n'est pas échappé.
  const escapedUsername = botUsername.replace(/_/g, "\\_");
  return [
    `${emoji} *${signal.type} ${signal.pair}* _(signal différé de ${CHANNEL_DELAY_MINUTES} min)_`,
    `Entrée : ${signal.entry_price}`,
    `Stop loss : ${signal.stop_loss}`,
    `Take profit : ${signal.take_profit}`,
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital.",
    "",
    `📡 Signaux en temps réel + alertes VIP : rejoins @${escapedUsername}`,
  ].join("\n");
}

export async function dispatchPublicChannel(env: Env): Promise<void> {
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
