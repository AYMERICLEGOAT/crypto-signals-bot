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
  // MOYENNE par signal, jamais la somme : additionner les pourcentages de
  // plusieurs trades ne décrit aucun rendement réel, et suppose une mise
  // totale sur chacun — alors que le message de signal conseille 2 %.
  let sommePct = 0;
  let closedCount = 0;
  let securedCount = 0;

  for (const delivery of deliveries) {
    const signal = delivery.signals;
    if (!signal) continue;

    if (signal.tp1_hit_at) securedCount += 1;

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
      sommePct += pct;
      closedCount += 1;
    }
  }

  const closedTotal = tpCount + slCount + expiredCount;
  const winRateStr = closedTotal > 0 ? `${((tpCount / closedTotal) * 100).toFixed(0)}%` : "n/a (aucun signal clôturé)";
  const moyenneStr =
    closedCount > 0
      ? `${sommePct / closedCount >= 0 ? "+" : ""}${(sommePct / closedCount).toFixed(2)} % par signal`
      : "n/a";

  const user = await getOrCreateUser(db, telegramId);
  const badge = getLoyaltyBadge(user);
  const totalCommissions = await getTotalCommissions(db, telegramId);

  const lines = [
    "📊 *Ton bilan personnel*\n",
    `🔒 Trades sécurisés (TP1 atteint, break-even ou mieux) : ${securedCount}/${deliveries.length}\n`,
    `Signaux reçus : ${deliveries.length}`,
    `✅ Take profit : ${tpCount} — ❌ Stop loss : ${slCount} — ⌛ Expiré : ${expiredCount} — 🔵 En cours : ${openCount}`,
    `Taux de réussite personnel : ${winRateStr}`,
    `Résultat moyen (${closedCount} signal(aux) clôturé(s)) : ${moyenneStr}`,
    "_Une moyenne par signal, pas un rendement de portefeuille : ce que tu as réellement gagné dépend " +
      "de ce que tu as misé sur chacun. C'est aussi l'unité dans laquelle nos chiffres publiés sont " +
      "exprimés, donc la seule qui s'y compare._",
  ];
  if (totalCommissions > 0) lines.push(`💰 Commissions virtuelles de parrainage cumulées : ${totalCommissions.toFixed(2)} USDT`);
  if (badge) lines.push(`\n${badge}`);
  lines.push("\n⚠️ Performance passée ne garantit pas les performances futures.");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), { markdown: true });
}
