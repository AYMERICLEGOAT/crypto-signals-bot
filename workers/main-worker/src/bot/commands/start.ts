import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser } from "../../db/users";
import { startKeyboard } from "../keyboards";
import { attributeReferralIfNeeded, buildReferralLink, REFERRAL_BONUS_DAYS } from "../referral";

export async function handleStart(env: Env, telegramId: number, referralPayload?: string): Promise<void> {
  await getOrCreateUser(dbConfig(env), telegramId);
  await attributeReferralIfNeeded(env, telegramId, referralPayload);

  const referralLink = buildReferralLink(env, telegramId);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "👋 Bienvenue !\n\n" +
      "Ce bot diffuse des signaux de trading crypto (BTC, ETH, SOL, ...) à ses abonnés.\n" +
      "📊 Stratégie backtestée sur 24 mois de données historiques – performances réelles suivies et publiées chaque semaine.\n\n" +
      "• /subscribe — voir les offres et s'abonner\n" +
      "• /trial — essai gratuit de 3 jours (une fois par wallet)\n" +
      "• /status — vérifier ton abonnement\n" +
      "• /help — toutes les commandes\n\n" +
      `🎁 Parraine un ami avec ton lien et gagne ${REFERRAL_BONUS_DAYS} jours gratuits dès son premier ` +
      `abonnement payant :\n${referralLink}`,
    { keyboard: startKeyboard }
  );
}
