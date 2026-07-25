/**
 * Effet Sniper (Bloc 2.2) : diffuse les signaux aux abonnés Standard et
 * Découverte SNIPER_DELAY_MINUTES après leur envoi immédiat aux abonnés Pro
 * (cron/dispatchSignals.ts) — la rapidité de réception fait partie de la
 * valeur différenciante du plan Pro. Le canal public gratuit (Bloc "vitrine",
 * cron/dispatchPublicChannel.ts) reste diffusé encore plus tard.
 */

import { Env, dbConfig } from "../env";
import { getSignalsDueForStandardTier, markSentToStandard, SignalRecord } from "../db/signals";
import { getActiveUsers } from "../db/users";
import { recordDeliveries } from "../db/signalDeliveries";
import { sendMessage, sendPhoto } from "../telegram";
import { STANDARD_PLAN, DISCOVERY_PLAN } from "../payments/plans";

export const SNIPER_DELAY_MINUTES = 15;

function formatSignalMessage(signal: SignalRecord): string {
  const emoji = signal.type === "BUY" ? "🟢" : "🔴";
  return [
    `${emoji} *${signal.type} ${signal.pair}*`,
    `Entrée : ${signal.entry_price}`,
    `Stop loss : ${signal.stop_loss}`,
    `Take profit : ${signal.take_profit}`,
    `_${new Date(signal.created_at).toLocaleString("fr-FR")}_`,
  ].join("\n");
}

const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

export async function dispatchStandardTier(env: Env): Promise<void> {
  const db = dbConfig(env);
  const due = await getSignalsDueForStandardTier(db, SNIPER_DELAY_MINUTES);
  if (due.length === 0) return;

  const activeUsers = await getActiveUsers(db);
  const targetIds = activeUsers
    .filter((u) => u.plan === STANDARD_PLAN || u.plan === DISCOVERY_PLAN)
    .map((u) => u.telegram_id);

  for (const signal of due) {
    const text = formatSignalMessage(signal);
    const send = (id: number) =>
      signal.chart_url
        ? sendPhoto(env.TELEGRAM_BOT_TOKEN, id, signal.chart_url as string, { caption: text, markdown: true })
        : sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true });

    const delivered: number[] = [];

    for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
      const batch = targetIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            await send(id);
            return id;
          } catch (err) {
            console.error(`[standard-tier] Échec d'envoi à ${id}:`, err);
            return null;
          }
        })
      );
      delivered.push(...results.filter((id): id is number => id !== null));
      if (i + BATCH_SIZE < targetIds.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    await recordDeliveries(db, signal.id, delivered, "standard");
    await markSentToStandard(db, signal.id);
  }
}
