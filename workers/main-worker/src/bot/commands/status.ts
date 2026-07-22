import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive } from "../../db/users";

export async function handleStatusCommand(env: Env, telegramId: number): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);

  if (!isSubscriptionActive(user)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "❌ Aucun abonnement actif pour le moment. Utilise /subscribe ou /trial pour commencer.");
    return;
  }

  const expirationDate = new Date(user.expiration as string);
  const planLabel = user.plan === 0 ? "Essai gratuit" : `Plan ${user.plan}`;
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `✅ Abonnement actif — ${planLabel}\nExpire le ${expirationDate.toLocaleString("fr-FR")}.`
  );
}
