import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getUsersExpiringWithin, markReminderSent, UserRecord } from "../db/users";
import { selectRows } from "../supabaseRest";

interface StrategyParamsRow {
  win_rate: number;
  trade_count: number;
}

async function getPerformanceLine(env: Env): Promise<string> {
  try {
    const db = dbConfig(env);
    const rows = await selectRows<StrategyParamsRow>(db, "strategy_params", {
      is_active: "eq.true",
      order: "last_tested.desc",
      limit: "1",
    });
    if (!rows[0]) return "";
    const winRatePct = (rows[0].win_rate * 100).toFixed(1);
    return `\n📊 Rappel : la stratégie affiche ${winRatePct}% de réussite sur ${rows[0].trade_count} trades (backtest 6 mois, in-sample — voir le site pour le détail).\n`;
  } catch {
    return ""; // le récap de perf est un bonus, jamais bloquant pour la relance elle-même
  }
}

async function sendReminder(env: Env, user: UserRecord, hoursLabel: "48h" | "24h", perfLine: string): Promise<void> {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    user.telegram_id,
    `⏰ Ton accès expire dans ${hoursLabel} !${perfLine}\n` +
      "Utilise /subscribe pour renouveler et ne pas interrompre la réception des signaux.",
    { markdown: true }
  );
}

/**
 * Relances 48h et 24h avant expiration. Tourne sur le cron existant (5 min,
 * voir index.ts) : le gate vient des colonnes reminder_48h_sent/24h_sent
 * (jamais renvoyé deux fois pour la même échéance — remises à zéro par
 * activateSubscription() dès que l'expiration change, voir db/users.ts).
 */
export async function checkExpirationReminders(env: Env): Promise<void> {
  const db = dbConfig(env);
  const perfLine = await getPerformanceLine(env);

  const expiring48h = await getUsersExpiringWithin(db, 48, "reminder_48h_sent");
  for (const user of expiring48h) {
    await sendReminder(env, user, "48h", perfLine);
    await markReminderSent(db, user.telegram_id, "reminder_48h_sent");
  }

  const expiring24h = await getUsersExpiringWithin(db, 24, "reminder_24h_sent");
  for (const user of expiring24h) {
    await sendReminder(env, user, "24h", perfLine);
    await markReminderSent(db, user.telegram_id, "reminder_24h_sent");
  }
}
