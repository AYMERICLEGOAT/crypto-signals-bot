import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getUserSignalHistory, SignalDeliveryWithSignal } from "../../db/history";

function statusLabel(signal: SignalDeliveryWithSignal["signals"]): string {
  if (!signal) return "Inconnu";
  switch (signal.close_reason) {
    case "tp_hit":
      return "TP atteint ✅";
    case "sl_hit":
      return "SL touché ❌";
    case "expired":
      return "Expiré";
    default:
      return "En cours";
  }
}

function pnlPct(signal: NonNullable<SignalDeliveryWithSignal["signals"]>): number | null {
  if (signal.outcome_price === null) return null;
  const entry = Number(signal.entry_price);
  const exit = Number(signal.outcome_price);
  return signal.type === "BUY" ? ((exit - entry) / entry) * 100 : ((entry - exit) / entry) * 100;
}

/** /history — les 5 derniers signaux reçus par CET utilisateur (via signal_deliveries), avec statut et P&L cumulé. */
export async function handleHistoryCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const deliveries = await getUserSignalHistory(db, telegramId, 5);

  if (deliveries.length === 0) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Aucun signal reçu pour le moment. Utilise /trial ou /subscribe pour commencer à en recevoir."
    );
    return;
  }

  const lines = ["📜 *Tes 5 derniers signaux*\n"];
  let cumulativePct = 0;
  let closedCount = 0;

  for (const delivery of deliveries) {
    const signal = delivery.signals;
    if (!signal) continue;

    const status = statusLabel(signal);
    const pct = pnlPct(signal);
    if (pct !== null) {
      cumulativePct += pct;
      closedCount += 1;
    }
    const pctLabel = pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : "";

    lines.push(`${signal.type} ${signal.pair} — ${status}${pctLabel}`);
  }

  if (closedCount > 0) {
    lines.push(`\n📊 Cumul sur ${closedCount} signal(aux) clôturé(s) : ${cumulativePct >= 0 ? "+" : ""}${cumulativePct.toFixed(1)}%`);
  }
  lines.push("\n⚠️ Performance passée ne garantit pas les performances futures.");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), { markdown: true });
}
