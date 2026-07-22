import { Context } from "telegraf";
import { getOrCreateUser } from "../../db/users";
import { startKeyboard } from "../keyboards";
import { attributeReferralIfNeeded, buildReferralLink, REFERRAL_BONUS_DAYS } from "../referral";

export async function handleStart(ctx: Context & { startPayload?: string }): Promise<void> {
  if (!ctx.from) return;
  await getOrCreateUser(ctx.from.id);
  await attributeReferralIfNeeded(ctx.from.id, ctx.startPayload);

  const referralLink = buildReferralLink(ctx.from.id);

  await ctx.reply(
    "👋 Bienvenue !\n\n" +
      "Ce bot diffuse des signaux de trading crypto (BTC, ETH, SOL, ...) à ses abonnés.\n\n" +
      "• /subscribe — voir les offres et s'abonner\n" +
      "• /trial — essai gratuit de 3 jours (une fois par wallet)\n" +
      "• /status — vérifier ton abonnement\n\n" +
      `🎁 Parraine un ami avec ton lien et gagne ${REFERRAL_BONUS_DAYS} jours gratuits dès son premier ` +
      `abonnement payant :\n${referralLink}`,
    startKeyboard
  );
}
