import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, markUserCancelled, isSubscriptionActive } from "../../db/users";
import { exitSurveyKeyboard } from "../keyboards";

const RETENTION_PROMO_CODE = "RELANCE50";

/**
 * /cancel [confirm] — Bloc 7. N'affecte JAMAIS l'accès déjà payé (pas de
 * remboursement possible côté crypto sans KYC de toute façon) : arrête
 * seulement les relances/offres futures. Un vrai réabonnement annule
 * automatiquement `cancelled` (voir db/users.ts, activateSubscription).
 */
export async function handleCancelCommand(env: Env, telegramId: number, rawArgs: string): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);
  const confirmed = rawArgs.trim().toLowerCase() === "confirm";

  if (user.cancelled) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "C'est déjà fait : aucune relance ni offre ne te sera envoyée. /subscribe reste disponible si tu changes d'avis.");
    return;
  }

  if (!confirmed) {
    const statusLine = isSubscriptionActive(user)
      ? `Ton accès reste valable jusqu'au ${new Date(user.expiration as string).toLocaleDateString("fr-FR")} (aucun remboursement, mais tu gardes les signaux jusque-là).`
      : "Tu n'as pas d'abonnement actif en ce moment.";

    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "⚠️ *Annuler ton abonnement*\n\n" +
        `${statusLine}\n` +
        "Après confirmation, on ne t'enverra plus de rappels ni d'offres — tu peux toujours revenir de toi-même avec /subscribe.\n\n" +
        `🎁 Avant de partir : garde ce code pour -50% si tu changes d'avis : \`${RETENTION_PROMO_CODE}\`\n\n` +
        "Pour confirmer, envoie /cancel confirm",
      { markdown: true }
    );
    return;
  }

  await markUserCancelled(db, telegramId);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "✅ C'est noté, on ne te relancera plus.\n\n" +
      `Si tu changes d'avis, /subscribe avec le code \`${RETENTION_PROMO_CODE}\` (-50%) t'attend.`,
    { markdown: true }
  );

  // Bloc 14.2 : enquête de départ, en message séparé pour ne pas surcharger la confirmation ci-dessus.
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Une dernière chose, si tu as 2 secondes : qu'est-ce qui t'a le plus déçu ?", {
    keyboard: exitSurveyKeyboard,
  });
}
