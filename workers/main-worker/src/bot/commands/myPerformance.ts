import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getUserSignalHistory, SignalDeliveryWithSignal } from "../../db/history";
import { getOrCreateUser } from "../../db/users";
import { getLoyaltyBadge } from "../loyaltyBadge";
import { computePnlPct } from "../../signalMath";
import { getTotalCommissions } from "../../db/referralRewards";

// Assez large pour couvrir tout l'historique réaliste d'un abonné sans pagination.
const MAX_SIGNALS = 500;

function pnlPct(signal: NonNullable<SignalDeliveryWithSignal["signals"]>): number | null {
  if (signal.outcome_price === null) return null;
  return computePnlPct(signal.type, Number(signal.entry_price), Number(signal.outcome_price));
}

/** /myperformance (Bloc 17) — bilan personnel complet basé sur signal_deliveries, jamais un chiffre agrégé/inventé. */
export async function handleMyPerformanceCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const deliveries = await getUserSignalHistory(db, telegramId, MAX_SIGNALS);

  if (deliveries.length === 0) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Aucun signal reçu pour le moment. Utilise /trial ou /subscribe pour commencer à en recevoir."
    );
    return;
  }

  let tpCount = 0;
  let slCount = 0;
  let expiredCount = 0;
  let openCount = 0;
  let cumulativePct = 0;
  let closedCount = 0;

  for (const delivery of deliveries) {
    const signal = delivery.signals;
    if (!signal) continue;

    switch (signal.close_reason) {
      case "tp_hit":
        tpCount += 1;
        break;
      case "sl_hit":
        slCount += 1;
        break;
      case "expired":
        expiredCount += 1;
        break;
      default:
        openCount += 1;
    }

    const pct = pnlPct(signal);
    if (pct !== null) {
      cumulativePct += pct;
      closedCount += 1;
    }
  }

  const closedTotal = tpCount + slCount + expiredCount;
  const winRateStr = closedTotal > 0 ? `${((tpCount / closedTotal) * 100).toFixed(0)}%` : "n/a (aucun signal clôturé)";
  const cumulativeStr = closedCount > 0 ? `${cumulativePct >= 0 ? "+" : ""}${cumulativePct.toFixed(1)}%` : "n/a";

  const user = await getOrCreateUser(db, telegramId);
  const badge = getLoyaltyBadge(user);
  const totalCommissions = await getTotalCommissions(db, telegramId);

  const lines = [
    "📊 *Ton bilan personnel*\n",
    `Signaux reçus : ${deliveries.length}`,
    `✅ Take profit : ${tpCount} — ❌ Stop loss : ${slCount} — ⌛ Expiré : ${expiredCount} — 🔵 En cours : ${openCount}`,
    `Taux de réussite personnel : ${winRateStr}`,
    `Gain/perte cumulé (${closedCount} signal(aux) clôturé(s)) : ${cumulativeStr}`,
  ];
  if (totalCommissions > 0) lines.push(`💰 Commissions virtuelles de parrainage cumulées : ${totalCommissions.toFixed(2)} USDT`);
  if (badge) lines.push(`\n${badge}`);
  lines.push("\n⚠️ Performance passée ne garantit pas les performances futures.");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), { markdown: true });
}
