/**
 * Retour admin (30/07) : les visiteurs du canal public doivent comprendre
 * immédiatement comment accéder au bot. Les signaux et Alertes Momentum ont
 * déjà chacun leur propre CTA (voir signalFormat.ts et
 * dispatchMomentumAlerts.ts), mais le canal peut rester plusieurs heures
 * sans nouveau signal (0 signal pendant des heures est un état normal, voir
 * checkSignalFreshness.ts) -- ce rappel autonome garantit qu'un visiteur qui
 * arrive à un moment calme voit quand même l'info dans les REMINDER_INTERVAL_HOURS
 * dernières heures, sans dépendre du rythme des signaux.
 *
 * Réutilise system_heartbeats (job_name dédié) comme horloge "dernier envoi"
 * plutôt qu'une nouvelle table, cohérent avec checkSignalFreshness.ts.
 */

import { Env, dbConfig } from "../env";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, SupabaseConfig } from "../supabaseRest";
import { sendMessage } from "../telegram";

const JOB_NAME = "channel_reminder";
const REMINDER_INTERVAL_HOURS = 6;

async function recordReminderSent(db: SupabaseConfig): Promise<void> {
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}

export async function postChannelReminder(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID || !env.TELEGRAM_BOT_USERNAME) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (heartbeat) {
    const hoursSinceLastReminder = (Date.now() - new Date(heartbeat.last_run_at).getTime()) / (60 * 60 * 1000);
    if (hoursSinceLastReminder < REMINDER_INTERVAL_HOURS) return;
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.TELEGRAM_CHANNEL_ID),
    `📡 Pour recevoir ces signaux en temps réel : @${env.TELEGRAM_BOT_USERNAME}`
  );
  await recordReminderSent(db);
}
