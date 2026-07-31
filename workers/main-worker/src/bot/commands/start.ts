import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive } from "../../db/users";
import { buildStartKeyboard } from "../keyboards";
import { attributeReferralIfNeeded, buildReferralLink, REFERRAL_BONUS_DAYS } from "../referral";

export async function handleStart(env: Env, telegramId: number, referralPayload?: string): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);
  await attributeReferralIfNeeded(env, telegramId, referralPayload);

  // plan 0 = essai déjà en cours (le proposer à nouveau ne changerait rien de
  // grave) ; plan 1/2/3 = abonnement payant actif, voir handleTrialCommand.
  const hasActivePaidPlan = isSubscriptionActive(user) && user.plan !== 0;

  const referralLink = buildReferralLink(env, telegramId);
  const journalLine = env.TELEGRAM_CHANNEL_URL
    ? "📖 Journal de trading public — chaque signal ouvert ET clôturé (gains comme pertes, sans filtre) : " +
      `${env.TELEGRAM_CHANNEL_URL}\n\n`
    : "";

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "👋 Bienvenue !\n\n" +
      "Ce bot diffuse des signaux de trading crypto (BTC, ETH, SOL, ...) à ses abonnés.\n" +
      "📊 Stratégie backtestée sur 24 mois de données historiques – performances réelles suivies et publiées chaque semaine.\n\n" +
      "• /subscribe — voir les offres et s'abonner\n" +
      (hasActivePaidPlan ? "" : "• /trial — essai gratuit de 3 jours (une fois par wallet)\n") +
      "• /status — vérifier ton abonnement\n" +
      "• /help — toutes les commandes\n" +
      "• /vip — canal privé réservé aux abonnés payants\n\n" +
      journalLine +
      `🎁 Parraine un ami avec ton lien et gagne ${REFERRAL_BONUS_DAYS} jours gratuits dès son premier ` +
      `abonnement payant :\n${referralLink}`,
    { keyboard: buildStartKeyboard(!hasActivePaidPlan) }
  );
}
