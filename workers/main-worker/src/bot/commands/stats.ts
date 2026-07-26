import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getAdminStats } from "../../db/adminStats";
import { getActiveStrategyParams } from "../../db/strategyParams";
import { getExitSurveyBreakdown } from "../../db/exitSurveys";

const EXIT_SURVEY_LABELS = {
  frequency: "Signaux pas assez fréquents",
  performance: "Pas assez performants",
  price: "Trop cher",
  other: "Autre",
} as const;

/** /stats — réservé à ADMIN_TELEGRAM_ID. Aucun chiffre inventé : "n/a" si une donnée n'existe pas encore. */
export async function handleStatsCommand(env: Env, telegramId: number): Promise<void> {
  if (!env.ADMIN_TELEGRAM_ID || String(telegramId) !== env.ADMIN_TELEGRAM_ID) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Commande réservée à l'administrateur.");
    return;
  }

  const db = dbConfig(env);
  const [stats, backtest, exitSurveys] = await Promise.all([getAdminStats(db), getActiveStrategyParams(db), getExitSurveyBreakdown(db)]);

  const backtestLine = backtest
    ? `${(backtest.win_rate * 100).toFixed(1)}% sur ${backtest.trade_count} trades (backtest 24 mois, in-sample)`
    : "n/a (aucun backtest enregistré)";

  const totalExitSurveys = Object.values(exitSurveys).reduce((a, b) => a + b, 0);
  const exitSurveyLines =
    totalExitSurveys > 0
      ? Object.entries(EXIT_SURVEY_LABELS)
          .map(([key, label]) => `  • ${label} : ${exitSurveys[key as keyof typeof EXIT_SURVEY_LABELS]}`)
          .join("\n")
      : "  n/a (aucune réponse pour le moment)";

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📊 *Dashboard*\n\n" +
      `Essais gratuits pris : ${stats.trials}\n` +
      `Abonnés payants actifs : ${stats.activePaying}\n` +
      `Ont payé au moins une fois : ${stats.everPaid}\n` +
      `Taux de conversion (essai → paiement) : ${stats.conversionRatePct}%\n\n` +
      `Taux de réussite récent : ${backtestLine}\n\n` +
      `Raisons de départ (${totalExitSurveys}) :\n${exitSurveyLines}`,
    { markdown: true }
  );
}
