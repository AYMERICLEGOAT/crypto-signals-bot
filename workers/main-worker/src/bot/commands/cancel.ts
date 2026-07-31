import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, markUserCancelled, isSubscriptionActive } from "../../db/users";

/**
 * Arrête uniquement les relances commerciales. Aucun message promotionnel ou
 * questionnaire n'est envoyé après la confirmation : l'annulation est une
 * limite de contact, pas une occasion de rétention.
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
      ? `Ton accès reste valable jusqu'au ${new Date(user.expiration as string).toLocaleDateString("fr-FR")}.`
      : "Tu n'as pas d'abonnement actif en ce moment.";
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "⚠️ *Arrêter les relances*\n\n" +
        `${statusLine}\n` +
        "Après confirmation, aucun rappel ou offre ne sera envoyé. Tu pourras revenir de toi-même avec /subscribe.\n\n" +
        "Pour confirmer, envoie /cancel confirm",
      { markdown: true }
    );
    return;
  }

  await markUserCancelled(db, telegramId);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "✅ C'est noté : plus aucune relance ni offre ne te sera envoyée. Ton accès déjà payé reste valable jusqu'à son expiration."
  );
}
