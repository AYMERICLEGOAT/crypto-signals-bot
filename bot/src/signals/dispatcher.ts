import { Telegram } from "telegraf";
import { getUnsentSignals, markSignalSent, SignalRecord } from "../db/signals";
import { getActiveUsers } from "../db/users";
import { splitMessage } from "../bot/formatting";

// ~20 messages/seconde, sous la limite globale de l'API Bot Telegram (30/s).
const DELAY_BETWEEN_MESSAGES_MS = 50;

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

async function broadcast(telegram: Telegram, signal: SignalRecord, telegramIds: number[]): Promise<void> {
  const text = formatSignalMessage(signal);

  for (const id of telegramIds) {
    try {
      if (signal.chart_url) {
        // Le graphique (module signals/, hébergé sur Supabase Storage) tient largement
        // sous la limite de 1024 caractères d'une légende Telegram, pas besoin de découpage.
        await telegram.sendPhoto(id, signal.chart_url, { caption: text, parse_mode: "Markdown" });
      } else {
        for (const chunk of splitMessage(text)) {
          await telegram.sendMessage(id, chunk, { parse_mode: "Markdown" });
        }
      }
    } catch (err) {
      console.error(`[signals] Échec d'envoi à ${id}:`, err);
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_MESSAGES_MS));
  }
}

/** Diffuse tous les signaux non encore envoyés aux abonnés actuellement actifs. */
export async function sendSignals(telegram: Telegram): Promise<void> {
  const unsent = await getUnsentSignals();
  if (unsent.length === 0) return;

  const activeUsers = await getActiveUsers();
  const activeIds = activeUsers.map((u) => u.telegram_id);

  for (const signal of unsent) {
    await broadcast(telegram, signal, activeIds);
    await markSignalSent(signal.id);
  }
}

export function startSignalDispatcher(telegram: Telegram, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    sendSignals(telegram).catch((err) => console.error("[signals] Erreur du dispatcher:", err));
  }, intervalMs);
}
