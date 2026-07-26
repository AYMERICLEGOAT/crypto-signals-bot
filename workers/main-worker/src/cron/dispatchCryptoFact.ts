import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getNextCryptoFact, markCryptoFactSent, hasSentCryptoFactToday } from "../db/cryptoFacts";

/**
 * Bloc 12.2 : une anecdote crypto par jour dans le canal public, en rotation
 * complète avant répétition (même pattern que dispatchEducationalPost.ts).
 */
export async function dispatchCryptoFact(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  if (await hasSentCryptoFactToday(db)) return;

  const fact = await getNextCryptoFact(db);
  if (!fact) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), `💡 *Le saviez-vous ?*\n\n${fact.content}`, {
    markdown: true,
  });
  await markCryptoFactSent(db, fact.id);
}
