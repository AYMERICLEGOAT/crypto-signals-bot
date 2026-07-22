import { Context } from "telegraf";
import { getOrCreateUser, isSubscriptionActive } from "../../db/users";

export async function handleStatusCommand(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const user = await getOrCreateUser(ctx.from.id);

  if (!isSubscriptionActive(user)) {
    await ctx.reply("❌ Aucun abonnement actif pour le moment. Utilise /subscribe ou /trial pour commencer.");
    return;
  }

  const expirationDate = new Date(user.expiration as string);
  const planLabel = user.plan === 0 ? "Essai gratuit" : `Plan ${user.plan}`;
  await ctx.reply(`✅ Abonnement actif — ${planLabel}\nExpire le ${expirationDate.toLocaleString("fr-FR")}.`);
}
