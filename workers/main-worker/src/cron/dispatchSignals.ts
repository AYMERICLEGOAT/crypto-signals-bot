import { Env, dbConfig } from "../env";
import { getUnsentSignals, markSignalSent, SignalRecord } from "../db/signals";
import { getActiveUsers } from "../db/users";
import { sendMessage, sendPhoto } from "../telegram";

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

// Sous-lots envoyés en parallèle, avec une pause entre chaque lot : reste
// sous la limite globale de l'API Telegram (~30 messages/seconde) même avec
// un grand nombre d'abonnés actifs.
const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

export async function dispatchSignals(env: Env): Promise<void> {
  const db = dbConfig(env);
  const unsent = await getUnsentSignals(db);
  if (unsent.length === 0) return;

  const activeUsers = await getActiveUsers(db);
  const activeIds = activeUsers.map((u) => u.telegram_id);

  for (const signal of unsent) {
    const text = formatSignalMessage(signal);
    const send = (id: number) =>
      signal.chart_url
        ? sendPhoto(env.TELEGRAM_BOT_TOKEN, id, signal.chart_url as string, { caption: text, markdown: true })
        : sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true });

    for (let i = 0; i < activeIds.length; i += BATCH_SIZE) {
      const batch = activeIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((id) => send(id).catch((err) => console.error(`[signals] Échec d'envoi à ${id}:`, err)))
      );
      if (i + BATCH_SIZE < activeIds.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    await markSignalSent(db, signal.id);
  }
}
