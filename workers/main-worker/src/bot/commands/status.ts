import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive } from "../../db/users";
import { PLAN_NAMES, isValidPlan } from "../../payments/plans";
import { getLoyaltyBadge } from "../loyaltyBadge";

export async function handleStatusCommand(env: Env, telegramId: number): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);

  if (!isSubscriptionActive(user)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "❌ Aucun abonnement actif pour le moment. Utilise /subscribe ou /trial pour commencer.");
    return;
  }

  const expirationDate = new Date(user.expiration as string);
  const planLabel = user.plan === 0 ? "Essai gratuit" : isValidPlan(user.plan as number) ? PLAN_NAMES[user.plan as 1 | 2 | 3] : `Plan ${user.plan}`;
  const badge = getLoyaltyBadge(user);
  const badgeLine = badge ? `\n${badge}` : "";
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `✅ Abonnement actif — ${planLabel}\nExpire le ${expirationDate.toLocaleString("fr-FR")}.${badgeLine}`
  );
}
