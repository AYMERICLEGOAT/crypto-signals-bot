import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getUsersExpiringWithin, markReminderSent, UserRecord } from "../db/users";
import { getActiveStrategyParams } from "../db/strategyParams";

// Phrase evergreen (voir le reste du projet) : jamais de pourcentage de
// backtest présenté comme un argument de vente tant qu'on n'a pas 30+ jours
// de signaux RÉELS suivis (env.DISPLAY_WINRATE, encore désactivé). Un chiffre
// dynamique tiré du dernier backtest peut changer d'un jour à l'autre selon
// les données de marché — l'afficher dans une relance de paiement reviendrait
// à en faire un argument commercial instable, ce qu'on a explicitement décidé
// d'éviter.
const HONEST_PERFORMANCE_PHRASE =
  "\n📊 Stratégie backtestée sur 6 mois de données historiques – performances réelles suivies et publiées chaque semaine.\n";

async function getPerformanceLine(env: Env): Promise<string> {
  if (env.DISPLAY_WINRATE !== "true") return HONEST_PERFORMANCE_PHRASE;

  try {
    const db = dbConfig(env);
    const stats = await getActiveStrategyParams(db);
    if (!stats) return HONEST_PERFORMANCE_PHRASE;
    const winRatePct = (stats.win_rate * 100).toFixed(1);
    return `\n📊 Rappel : ${winRatePct}% de réussite sur ${stats.trade_count} signaux réels suivis.\n`;
  } catch {
    return HONEST_PERFORMANCE_PHRASE; // le récap de perf est un bonus, jamais bloquant pour la relance elle-même
  }
}

const URGENCY_LABELS = { reminder_48h_sent: "48h", reminder_24h_sent: "24h", reminder_2h_sent: "2h" } as const;
type ReminderFlag = keyof typeof URGENCY_LABELS;

function formatReminderText(flagColumn: ReminderFlag, perfLine: string): string {
  const label = URGENCY_LABELS[flagColumn];
  if (flagColumn === "reminder_2h_sent") {
    return (
      `🔴 *Dernière chance* : ton accès expire dans ${label} !${perfLine}\n` +
      "Renouvelle maintenant avec /subscribe pour ne pas perdre l'accès aux signaux."
    );
  }
  return `⏰ Ton accès expire dans ${label} !${perfLine}\n` + "Utilise /subscribe pour renouveler et ne pas interrompre la réception des signaux.";
}

async function sendReminder(env: Env, user: UserRecord, flagColumn: ReminderFlag, perfLine: string): Promise<void> {
  await sendMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_id, formatReminderText(flagColumn, perfLine), { markdown: true });
}

/**
 * Relances 48h, 24h et 2h (ultimatum, Bloc 9) avant expiration. Tourne sur le
 * cron existant (5 min, voir index.ts) : le gate vient des colonnes
 * reminder_48h_sent/24h_sent/2h_sent (jamais renvoyé deux fois pour la même
 * échéance — remises à zéro par activateSubscription() dès que l'expiration
 * change, voir db/users.ts).
 */
export async function checkExpirationReminders(env: Env): Promise<void> {
  const db = dbConfig(env);
  const perfLine = await getPerformanceLine(env);

  for (const [hours, flagColumn] of [
    [48, "reminder_48h_sent"],
    [24, "reminder_24h_sent"],
    [2, "reminder_2h_sent"],
  ] as const) {
    const expiringUsers = await getUsersExpiringWithin(db, hours, flagColumn);
    for (const user of expiringUsers) {
      await sendReminder(env, user, flagColumn, perfLine);
      await markReminderSent(db, user.telegram_id, flagColumn);
    }
  }
}
