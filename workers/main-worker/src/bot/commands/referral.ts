import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, countReferralsBy } from "../../db/users";
import { buildReferralLink, MILESTONE_REFERRALS, MILESTONE_BONUS_DAYS, REFERRAL_BONUS_DAYS } from "../referral";

export async function handleReferralCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);
  const link = buildReferralLink(env, telegramId);
  const totalReferred = await countReferralsBy(db, telegramId);
  const paidCount = user.paid_referral_count ?? 0;
  const towardsNextMilestone = paidCount % MILESTONE_REFERRALS;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🔗 *Ton lien de parrainage*\n" +
      `${link}\n\n` +
      `+${REFERRAL_BONUS_DAYS} jours pour toi à chaque fois qu'un filleul s'abonne (paiement confirmé).\n` +
      `🏆 Tous les ${MILESTONE_REFERRALS} filleuls payants : +${MILESTONE_BONUS_DAYS} jours de plus (1 mois gratuit).\n\n` +
      `📊 *Ta progression*\n` +
      `${totalReferred} personne(s) ont rejoint via ton lien\n` +
      `${paidCount} filleul(s) payant(s) au total\n` +
      `${towardsNextMilestone}/${MILESTONE_REFERRALS} vers ton prochain mois gratuit`,
    { markdown: true }
  );
}
