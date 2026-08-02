/**
 * Rappel unique dans le canal public : comment accéder au bot.
 *
 * Les visiteurs du canal doivent comprendre immédiatement où aller. Les
 * signaux et alertes portent déjà leur propre CTA, mais le canal peut rester
 * plusieurs heures sans rien publier (0 signal pendant des heures est un état
 * normal, voir checkSignalFreshness.ts) : ce rappel autonome garantit qu'un
 * visiteur arrivé pendant une période calme voit quand même l'information.
 *
 * FUSION du 02/08/2026 — deux rappels coexistaient et se doublonnaient dans
 * le canal : celui-ci (« 📡 Pour recevoir ces signaux en temps réel », toutes
 * les 6 h) et un dispatchChannelCta ajouté la veille (« 🔒 Pour recevoir… »,
 * toutes les 3 h via un déclencheur cron dédié). Un seul message subsiste,
 * ici, avec le contenu le plus complet des deux et la cadence de 3 h. Le
 * module et le déclencheur cron en double ont été supprimés.
 *
 * L'horloge reste system_heartbeats (job_name dédié) plutôt qu'un cron à
 * l'heure fixe : l'intervalle se rattrape tout seul si un cycle est sauté,
 * ce qui est fréquent sur les déclencheurs planifiés GitHub/Cloudflare.
 */

import { Env, dbConfig } from "../env";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, selectRows, SupabaseConfig } from "../supabaseRest";
import { sendMessage } from "../telegram";
import { isQuietHours } from "../utils/quietHours";

const JOB_NAME = "channel_reminder";
const REMINDER_INTERVAL_HOURS = 3;
// Un signal publié dans cette fenêtre rend le rappel superflu : il porte
// déjà son propre appel à l'action.
const QUIET_BEFORE_REMINDER_HOURS = 3;

async function hasRecentChannelSignal(db: SupabaseConfig, hours: number): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  try {
    const rows = await selectRows<{ id: number }>(db, "signals", {
      sent_to_channel: "eq.true",
      created_at: `gte.${since}`,
      select: "id",
      limit: "1",
    });
    return rows.length > 0;
  } catch (err) {
    // En cas d'échec de lecture, on laisse passer le rappel : mieux vaut un
    // message de trop qu'un canal muet.
    console.error("[channel-reminder] Lecture des signaux récents impossible:", err);
    return false;
  }
}

async function recordReminderSent(db: SupabaseConfig): Promise<void> {
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}

export async function postChannelReminder(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID || !env.TELEGRAM_BOT_USERNAME) return;
  if (isQuietHours()) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (heartbeat) {
    const hoursSinceLastReminder = (Date.now() - new Date(heartbeat.last_run_at).getTime()) / (60 * 60 * 1000);
    if (hoursSinceLastReminder < REMINDER_INTERVAL_HOURS) return;
  }

  // Ce rappel COMBLE les silences, il ne s'ajoute pas au contenu. À 3 h
  // d'intervalle sur une plage de 16 h, il partirait jusqu'à 5 fois par jour
  // — un message identique répété cinq fois est exactement le spam qu'on
  // cherche à éliminer. S'il y a eu un vrai signal publié récemment, le
  // visiteur a déjà sous les yeux ce que fait le service ET son CTA : le
  // rappel n'apporterait rien.
  const recentSignal = await hasRecentChannelSignal(db, QUIET_BEFORE_REMINDER_HOURS);
  if (recentSignal) return;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.TELEGRAM_CHANNEL_ID),
    `🔒 Pour recevoir ces signaux en temps réel, avec TP/SL et sécurisation automatique : @${env.TELEGRAM_BOT_USERNAME}\n` +
      "🎁 Essai gratuit de 3 jours avec /trial"
  );
  await recordReminderSent(db);
}
