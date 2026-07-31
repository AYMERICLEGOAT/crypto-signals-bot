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
  const text =
    "👋 Bienvenue sur le canal !\n\n" +
    "Ici : signaux différés, alertes momentum, contenu éducatif.\n\n" +
    `📡 Pour recevoir les signaux en TEMPS RÉEL (dès leur détection, pas en différé) : @${env.TELEGRAM_BOT_USERNAME}\n` +
    "Tape /start pour commencer, /demo pour voir un exemple sans engagement.";

  const messageId = await sendMessageAndGetId(env.TELEGRAM_BOT_TOKEN, channelId, text);
  await pinChatMessage(env.TELEGRAM_BOT_TOKEN, channelId, messageId);
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}
