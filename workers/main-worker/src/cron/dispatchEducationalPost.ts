import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getNextEducationalPost, markEducationalPostSent, hasSentEducationalPostToday } from "../db/educationalPosts";

/**
 * Un post éducatif par jour dans le canal public, en rotation (jamais deux
 * fois le même avant d'avoir fait le tour des 30). Le cron tourne toutes les
 * 5 minutes (voir index.ts) : le gate "déjà envoyé aujourd'hui" empêche les
 * envois multiples sans avoir besoin d'un cron dédié une fois par jour.
 */
export async function dispatchEducationalPost(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  if (await hasSentEducationalPostToday(db)) return;

  const post = await getNextEducationalPost(db);
  if (!post) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), post.content);
  await markEducationalPostSent(db, post.id);
}
