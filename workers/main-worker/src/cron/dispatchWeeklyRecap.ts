/**
 * Bloc 12.3 : récap hebdomadaire publié sur le canal public tous les
 * dimanches à partir de 18h UTC (le cron tourne toutes les 5 minutes, voir
 * index.ts -- ce module se déclenche lui-même seulement le bon jour/heure,
 * et le gate "déjà publié cette semaine" empêche les envois multiples le
 * reste du dimanche soir).
 */

import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { hasPostedWeeklyRecapRecently, recordWeeklyRecapPost } from "../db/weeklyRecapPosts";
import { getSignalsCreatedSince, getSignalsResolvedSince } from "../db/signals";
import { getMomentumAlertsSince } from "../db/momentumAlerts";
import { computePnlPct } from "../signalMath";
import { getActiveUsers } from "../db/users";
import { filterByPref } from "../db/userPrefs";

const RECAP_WEEKDAY_UTC = 0; // dimanche
const RECAP_HOUR_UTC = 18;
const PAPER_POSITION_SIZE_PCT = 0.1; // même convention que website/equity_curve.py

export async function dispatchWeeklyRecap(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const now = new Date();
  if (now.getUTCDay() !== RECAP_WEEKDAY_UTC || now.getUTCHours() < RECAP_HOUR_UTC) return;

  const db = dbConfig(env);
  if (await hasPostedWeeklyRecapRecently(db)) return;

  const weekAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [emitted, resolved, momentumAlerts] = await Promise.all([
    getSignalsCreatedSince(db, weekAgoIso),
    getSignalsResolvedSince(db, weekAgoIso),
    getMomentumAlertsSince(db, weekAgoIso),
  ]);

  const tpCount = resolved.filter((s) => s.close_reason === "tp_hit").length;
  const slCount = resolved.filter((s) => s.close_reason === "sl_hit").length;

  const paperPnlPct = resolved.reduce((sum, s) => {
    if (s.outcome_price == null) return sum;
    return sum + computePnlPct(s.type, s.entry_price, s.outcome_price) * PAPER_POSITION_SIZE_PCT;
  }, 0);
  const sign = paperPnlPct >= 0 ? "+" : "";

  const text = [
    "📅 *Récap de la semaine*",
    "",
    `📡 ${emitted.length} signal(aux) émis`,
    `✅ ${tpCount} take profit touché(s) — ❌ ${slCount} stop loss touché(s)`,
    `💼 Portefeuille fictif (10%/trade, non composé) : ${sign}${paperPnlPct.toFixed(1)}%`,
    `⚡ ${momentumAlerts.length} alerte(s) momentum envoyée(s)`,
    "",
    "⚠️ Pas un conseil en investissement. Performance passée ne garantit pas les résultats futurs.",
  ].join("\n");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), text, { markdown: true });
  await recordWeeklyRecapPost(db);

  // Bloc 19 : en plus du canal, envoye aussi en DM aux abonnes actifs n'ayant
  // pas desactive "Recap hebdomadaire" dans /prefs (active par defaut).
  const activeUsers = await getActiveUsers(db);
  const recipientIds = await filterByPref(db, activeUsers.map((u) => u.telegram_id), "weekly_recap");
  await Promise.all(
    recipientIds.map((id) => sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true }).catch((err) =>
      console.error(`[weekly-recap] Échec DM à ${id}:`, err)
    ))
  );
}
