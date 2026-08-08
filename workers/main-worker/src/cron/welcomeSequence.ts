import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getUsersDueForWelcomeFollowUp, markWelcomeFollowUpSent } from "../db/users";

const HOURS_BEFORE_FOLLOWUP_1H = 1;
const HOURS_BEFORE_FOLLOWUP_1D = 24;

/**
 * Audit#21 : /start n'envoyait qu'un seul message — personne ne relançait
 * ensuite celui ou celle qui n'avait rien fait. Deux relances ponctuelles
 * (jamais renvoyées, gate via welcome_1h_sent/welcome_1d_sent — voir
 * db/users.ts), sur le même cron 5 min que les autres relances. Respecte
 * `cancelled` comme les autres messages non essentiels (voir /cancel).
 */
export async function sendWelcomeFollowUps(env: Env): Promise<void> {
  const db = dbConfig(env);

  const due1h = await getUsersDueForWelcomeFollowUp(db, HOURS_BEFORE_FOLLOWUP_1H, "welcome_1h_sent");
  for (const user of due1h) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      user.telegram_id,
      "👋 Toujours partant ? Tape /demo pour voir un exemple de signal (issu du backtest), " +
        "ou /trial pour recevoir de vrais signaux gratuitement pendant 3 jours. " +
        "/help liste toutes les commandes disponibles."
    );
    await markWelcomeFollowUpSent(db, user.telegram_id, "welcome_1h_sent");
  }

  const due1d = await getUsersDueForWelcomeFollowUp(db, HOURS_BEFORE_FOLLOWUP_1D, "welcome_1d_sent");
  for (const user of due1d) {
    // Quelqu'un en essai reçoit le point de mi-parcours (cron/trialMidpointRecap.ts),
    // qui lui montre ce qu'il a RÉELLEMENT reçu. Lui envoyer en plus ce rappel
    // générique ferait deux messages le même jour, dont un qui n'apprend rien.
    if (user.plan === 0) {
      await markWelcomeFollowUpSent(db, user.telegram_id, "welcome_1d_sent");
      continue;
    }
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      user.telegram_id,
      "🙂 Ça fait un jour que tu as rejoint le bot. Une question sur le fonctionnement ? /help est " +
        "toujours là. Et si le service te plaît, /referral te donne un lien à partager pour gagner " +
        "des jours gratuits."
    );
    await markWelcomeFollowUpSent(db, user.telegram_id, "welcome_1d_sent");
  }
}
