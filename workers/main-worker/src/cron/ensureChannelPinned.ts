/**
 * Retour admin (30/07) : la tâche "Guide visuel de paiement + épinglage
 * canal" avait été marquée faite mais l'épinglage lui-même n'avait jamais
 * été implémenté (aucun appel à pinChatMessage nulle part dans le code) --
 * seuls le CTA /pay et l'image du guide existaient. Un visiteur qui ouvre le
 * canal public pour la première fois n'avait donc RIEN d'épinglé pour
 * comprendre en un coup d'œil comment accéder au bot.
 *
 * Épinglé une seule fois (flag dans system_heartbeats, jamais ré-épinglé à
 * chaque déploiement) : un admin qui personnalise/déplace le pin ensuite ne
 * se le voit pas écraser par ce job.
 */

import { Env, dbConfig } from "../env";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow } from "../supabaseRest";
import { sendMessageAndGetId, pinChatMessage } from "../telegram";

const JOB_NAME = "channel_pinned";

export async function ensureChannelPinned(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID || !env.TELEGRAM_BOT_USERNAME) return;

  const db = dbConfig(env);
  if (await getHeartbeat(db, JOB_NAME)) return; // déjà épinglé une fois, ne jamais recommencer

  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  // Raccourci le 02/08/2026 : l'ancienne version faisait 262 caractères et
  // était tronquée dans l'aperçu épinglé qu'affiche Telegram en haut du
  // canal — donc l'essentiel (le lien vers le bot) n'était pas toujours
  // visible sans ouvrir le message. Trois lignes, un lien, une action.
  const text =
    "📊 Signaux crypto — ici en différé.\n\n" +
    `⚡ En temps réel + TP/SL suivis : @${env.TELEGRAM_BOT_USERNAME}\n` +
    "🎁 /trial — essai gratuit 3 jours";

  const messageId = await sendMessageAndGetId(env.TELEGRAM_BOT_TOKEN, channelId, text);
  await pinChatMessage(env.TELEGRAM_BOT_TOKEN, channelId, messageId);
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}
