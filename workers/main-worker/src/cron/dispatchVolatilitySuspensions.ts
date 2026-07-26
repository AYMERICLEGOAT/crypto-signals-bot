/**
 * Bloc 11.3 : relaie sur le canal public gratuit les suspensions de signal
 * décidées par signals/main.py (ATR intraday > VOLATILITY_SUSPENSION_ATR_PCT
 * du prix -- marché trop erratique pour que des stop/target fixés à l'avance
 * restent pertinents). Même pattern que dispatchMomentumAlerts.ts.
 */

import { Env, dbConfig } from "../env";
import { getUnsentVolatilitySuspensions, markVolatilitySuspensionSent, VolatilitySuspensionRecord } from "../db/volatilitySuspensions";
import { sendMessage } from "../telegram";

function formatSuspensionMessage(event: VolatilitySuspensionRecord): string {
  const pct = (event.atr_pct * 100).toFixed(1);
  return [
    `⏸️ *Signaux suspendus — ${event.pair}*`,
    `Volatilité anormale détectée (${pct}% du prix sur la dernière bougie) : par prudence, aucun signal n'est émis sur cette paire ce cycle.`,
  ].join("\n");
}

export async function dispatchVolatilitySuspensions(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  const due = await getUnsentVolatilitySuspensions(db);

  for (const event of due) {
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatSuspensionMessage(event), { markdown: true });
      await markVolatilitySuspensionSent(db, event.id);
    } catch (err) {
      console.error(`[volatility-suspensions] Échec de diffusion pour l'événement #${event.id}:`, err);
    }
  }
}
