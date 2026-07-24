import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getUsersDueForSurvey, markSurveySent } from "../db/users";
import { surveyKeyboard } from "../bot/keyboards";

const DAYS_BEFORE_SURVEY = 7;

/**
 * 7 jours après le premier paiement (plan_started_at), demande un retour
 * 👍/👎. Greffé sur le cron existant (5 min) : gate via survey_sent (jamais
 * renvoyé deux fois — c'est un repère unique dans la vie du client, pas
 * remis à zéro par un renouvellement, contrairement aux relances 48h/24h).
 */
export async function sendSatisfactionSurveys(env: Env): Promise<void> {
  const db = dbConfig(env);
  const dueUsers = await getUsersDueForSurvey(db, DAYS_BEFORE_SURVEY);

  for (const user of dueUsers) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      user.telegram_id,
      "🙋 Ça fait une semaine que tu es abonné — comment trouves-tu le service ?",
      { keyboard: surveyKeyboard }
    );
    await markSurveySent(db, user.telegram_id);
  }
}
