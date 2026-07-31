import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getNextEducationalPost, markEducationalPostSent, hasSentEducationalPostToday } from "../db/educationalPosts";
import { getActiveUsers } from "../db/users";
import { filterByPref } from "../db/userPrefs";

// Retour admin (30/07, post reçu à 22h) : sans fenêtre horaire, le seul gate
// "déjà envoyé aujourd'hui" laisse le post partir sur le premier cycle utile
// après minuit UTC, quelle que soit l'heure -- si ce cycle est en retard
// (ex : dispatchMomentumAlerts plus haut dans index.ts qui traite un gros
// stock d'alertes prend du temps), le post glisse tard dans la journée.
// 8h-20h UTC (10h-22h Paris en été) : plage large mais qui exclut la nuit.
const DISPATCH_WINDOW_START_UTC_HOUR = 8;
const DISPATCH_WINDOW_END_UTC_HOUR = 20;

function isWithinDispatchWindow(): boolean {
  const hour = new Date().getUTCHours();
  return hour >= DISPATCH_WINDOW_START_UTC_HOUR && hour < DISPATCH_WINDOW_END_UTC_HOUR;
}

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
  if (!isWithinDispatchWindow()) return;

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
