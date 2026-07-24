import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getUsersExpiredSince, markReengagementSent } from "../db/users";

const DAYS_AFTER_EXPIRATION = 3;
const PROMO_CODE = "RELANCE20";

/**
 * 3 jours après expiration, propose le code RELANCE20 (-20%, voir
 * promo_codes) pour inciter au réabonnement. Greffé sur le cron existant
 * (5 min) : le gate vient de reengagement_sent (jamais renvoyé deux fois),
 * remis à zéro par activateSubscription() si l'utilisateur se réabonne.
 */
export async function sendReengagementOffers(env: Env): Promise<void> {
  const db = dbConfig(env);
  const expiredUsers = await getUsersExpiredSince(db, DAYS_AFTER_EXPIRATION);

  for (const user of expiredUsers) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      user.telegram_id,
      "👋 Ça fait quelques jours qu'on ne t'a plus envoyé de signaux !\n\n" +
        `Reviens avec *-20%* sur ton prochain abonnement grâce au code : \`${PROMO_CODE}\`\n\n` +
        `1️⃣ Envoie /code ${PROMO_CODE}\n` +
        "2️⃣ Puis /subscribe pour en profiter",
      { markdown: true }
    );
    await markReengagementSent(db, user.telegram_id);
  }
}
