import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getNextEducationalPost, markEducationalPostSent, hasSentEducationalPostToday } from "../db/educationalPosts";
import { getActiveUsers } from "../db/users";
import { filterByPref } from "../db/userPrefs";

/**
 * Un post éducatif par jour dans le canal public, en rotation (jamais deux
 * fois le même avant d'avoir fait le tour des 30). Le cron tourne toutes les
 * 5 minutes (voir index.ts) : le gate "déjà envoyé aujourd'hui" empêche les
 * envois multiples sans avoir besoin d'un cron dédié une fois par jour.
 *
 * Bloc 19 : en plus du canal, envoyé aussi en DM aux abonnés actifs n'ayant
 * pas désactivé "Posts éducatifs" dans /prefs (activé par défaut).
 */
export async function dispatchEducationalPost(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  if (await hasSentEducationalPostToday(db)) return;

  const post = await getNextEducationalPost(db);
  if (!post) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), post.content);
  await markEducationalPostSent(db, post.id);

  const activeUsers = await getActiveUsers(db);
  const recipientIds = await filterByPref(db, activeUsers.map((u) => u.telegram_id), "educational_posts");
  await Promise.all(
    recipientIds.map((id) => sendMessage(env.TELEGRAM_BOT_TOKEN, id, post.content).catch((err) =>
      console.error(`[educational-post] Échec DM à ${id}:`, err)
    ))
  );
}
