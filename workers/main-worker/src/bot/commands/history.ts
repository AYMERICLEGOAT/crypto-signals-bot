import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getUserSignalHistory, SignalDeliveryWithSignal } from "../../db/history";
import { getOrCreateUser } from "../../db/users";
import { getLoyaltyBadge } from "../loyaltyBadge";
import { computePnlPct } from "../../signalMath";
import { typeLabel } from "../../signalFormat";

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
  return computePnlPct(signal.type, Number(signal.entry_price), Number(signal.outcome_price));
}

/**
 * Libellés courts des moteurs. Volontairement plus brefs que les badges de
 * signalFormat.ts : ici ils s'insèrent dans une ligne de liste, pas dans un
 * en-tête de message.
 */
const ENGINE_LABELS: Record<string, string> = {
  relative_strength: " · force relative",
  cassure_canal: " · cassure",
  expansion_volatilite: " · expansion",
  carry_funding: " · carry",
  momentum_4h: " · momentum 4H",
};

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
  // MOYENNE, et non somme. Additionner les pourcentages de plusieurs trades ne
  // décrit AUCUN rendement réel : +10 % puis -10 % ne fait pas 0 % sur un
  // capital, et surtout la somme suppose qu'on a misé la totalité sur chaque
  // signal, ce que personne ne fait — le message de signal conseille lui-même
  // 2 % par trade. C'est la moyenne par signal que les backtests publient, et
  // c'est la seule qui se compare à eux.
  let sommePct = 0;
  let closedCount = 0;

  for (const delivery of deliveries) {
    const signal = delivery.signals;
    if (!signal) continue;

    const status = statusLabel(signal);
    const pct = pnlPct(signal);
    if (pct !== null) {
      sommePct += pct;
      closedCount += 1;
    }
    const pctLabel = pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : "";
    // Le moteur figure sur chaque ligne : cinq moteurs cohabitent, et sans
    // cette mention l'abonné ne peut pas relier un résultat à ce qui l'a produit.
    const moteur = ENGINE_LABELS[signal.engine ?? ""] ?? "";
    lines.push(`${typeLabel(signal.type)} ${signal.pair}${moteur} — ${status}${pctLabel}`);
  }

  if (closedCount > 0) {
    const moyenne = sommePct / closedCount;
    lines.push(
      `\n📊 Moyenne sur ${closedCount} signal(aux) clôturé(s) : ${moyenne >= 0 ? "+" : ""}${moyenne.toFixed(2)} % par signal`
    );
    lines.push(
      "_C'est une moyenne PAR SIGNAL, pas un rendement de portefeuille : ce que tu as réellement gagné " +
        "dépend de ce que tu as misé sur chacun._"
    );
  }

  const user = await getOrCreateUser(db, telegramId);
  const badge = getLoyaltyBadge(user);
  if (badge) lines.push(`\n${badge}`);

  lines.push("\n⚠️ Performance passée ne garantit pas les performances futures.");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), { markdown: true });
}
