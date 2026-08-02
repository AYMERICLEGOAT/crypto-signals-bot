import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getNextCryptoFact, markCryptoFactSent, hasSentCryptoFactToday } from "../db/cryptoFacts";
import { isQuietHours } from "../utils/quietHours";

/**
 * Bloc 12.2 : une anecdote crypto par jour dans le canal public, en rotation
 * complète avant répétition (même pattern que dispatchEducationalPost.ts).
 * CTA ajouté (audit du 31/07) : ce flux n'en avait aucun.
 */
export async function dispatchCryptoFact(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  if (await hasSentCryptoFactToday(db)) return;

  const fact = await getNextCryptoFact(db);
  if (!fact) return;

  // markdown:true -- échapper le username comme partout ailleurs (voir
  // signalFormat.ts) : un underscore non échappé casse tout le message
  // (bug vécu le 29/07 sur /help et /referral, même famille).
  const escapedUsername = env.TELEGRAM_BOT_USERNAME?.replace(/_/g, "\\_");
  const cta = escapedUsername ? `\n\n@${escapedUsername} pour des signaux en temps réel` : "";
  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), `💡 *Le saviez-vous ?*\n\n${fact.content}${cta}`, {
    markdown: true,
  });
  await markCryptoFactSent(db, fact.id);
}
