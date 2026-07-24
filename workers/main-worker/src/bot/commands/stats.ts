import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getAdminStats } from "../../db/adminStats";
import { getActiveStrategyParams } from "../../db/strategyParams";

/** /stats — réservé à ADMIN_TELEGRAM_ID. Aucun chiffre inventé : "n/a" si une donnée n'existe pas encore. */
export async function handleStatsCommand(env: Env, telegramId: number): Promise<void> {
  if (!env.ADMIN_TELEGRAM_ID || String(telegramId) !== env.ADMIN_TELEGRAM_ID) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Commande réservée à l'administrateur.");
    return;
  }

  const db = dbConfig(env);
  const [stats, backtest] = await Promise.all([getAdminStats(db), getActiveStrategyParams(db)]);

  const backtestLine = backtest
    ? `${(backtest.win_rate * 100).toFixed(1)}% sur ${backtest.trade_count} trades (backtest 6 mois, in-sample)`
    : "n/a (aucun backtest enregistré)";

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📊 *Dashboard*\n\n" +
      `Essais gratuits pris : ${stats.trials}\n` +
      `Abonnés payants actifs : ${stats.activePaying}\n` +
      `Ont payé au moins une fois : ${stats.everPaid}\n` +
      `Taux de conversion (essai → paiement) : ${stats.conversionRatePct}%\n\n` +
      `Taux de réussite récent : ${backtestLine}`,
    { markdown: true }
  );
}
