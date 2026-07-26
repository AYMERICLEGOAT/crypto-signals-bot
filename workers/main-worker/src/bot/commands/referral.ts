import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, countReferralsBy } from "../../db/users";
import { getTotalCommissions } from "../../db/referralRewards";
import {
  buildReferralLink,
  MILESTONE_REFERRALS,
  MILESTONE_BONUS_DAYS,
  REFERRAL_BONUS_DAYS,
  JOKER_THRESHOLD_HOURS,
  JOKER_BONUS_DAYS,
} from "../referral";

export async function handleReferralCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);
  const link = buildReferralLink(env, telegramId);
  const totalReferred = await countReferralsBy(db, telegramId);
  const paidCount = user.paid_referral_count ?? 0;
  const towardsNextMilestone = paidCount % MILESTONE_REFERRALS;
  const totalCommissions = await getTotalCommissions(db, telegramId);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🔗 *Ton lien de parrainage*\n" +
      `${link}\n\n` +
      `+${REFERRAL_BONUS_DAYS} jours pour toi à chaque fois qu'un filleul s'abonne (paiement confirmé).\n` +
      `🏆 Tous les ${MILESTONE_REFERRALS} filleuls payants : +${MILESTONE_BONUS_DAYS} jours de plus (1 mois gratuit).\n` +
      `🃏 Bonus Joker : parraine dans les ${JOKER_THRESHOLD_HOURS}h avant l'expiration de ton abonnement pour +${JOKER_BONUS_DAYS} jours de plus.\n` +
      `💰 Commission virtuelle de 10% sur chaque abonnement payé par un filleul (non versée automatiquement, juste pour suivre ce que tu as généré).\n\n` +
      `📊 *Ta progression*\n` +
      `${totalReferred} personne(s) ont rejoint via ton lien\n` +
      `${paidCount} filleul(s) payant(s) au total\n` +
      `${towardsNextMilestone}/${MILESTONE_REFERRALS} vers ton prochain mois gratuit\n` +
      `${totalCommissions.toFixed(2)} USDT de commissions virtuelles cumulées`,
    { markdown: true }
  );
}
