/**
 * Parrainage géré entièrement côté Supabase (le contrat n'a pas de notion de
 * parrainage — voir la conversation). Le "code" de parrainage n'est pas
 * stocké séparément : c'est le telegram_id du parrain encodé en base36,
 * décodable directement, ce qui évite toute collision et toute colonne
 * supplémentaire.
 */

import { Env, dbConfig } from "../env";
import { getUserIfExists, setReferredBy, markReferralRewarded, activateSubscription } from "../db/users";
import { updateRows } from "../supabaseRest";
import { sendMessage } from "../telegram";
import { addDays } from "../utils/date";

// Bonus crédité au PARRAIN quand son filleul confirme son premier
// abonnement PAYANT (jamais sur un essai gratuit, pour éviter qu'un
// parrainage à soi-même via un second compte ne génère des jours gratuits
// sans qu'aucun paiement réel n'ait eu lieu).
export const REFERRAL_BONUS_DAYS = 7;

// Palier supplémentaire : tous les 3 filleuls payants (cumulatif, jamais
// remis à zéro), un mois gratuit en plus du bonus habituel de chaque filleul.
export const MILESTONE_REFERRALS = 3;
export const MILESTONE_BONUS_DAYS = 30;

export function encodeReferralCode(telegramId: number): string {
  return telegramId.toString(36);
}

export function decodeReferralCode(code: string): number | null {
  const value = parseInt(code, 36);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function buildReferralLink(env: Env, telegramId: number): string {
  return `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${encodeReferralCode(telegramId)}`;
}

/**
 * À appeler quand un utilisateur envoie /start avec un payload de parrainage.
 * N'écrase jamais un referred_by déjà défini (premier lien cliqué = définitif),
 * et refuse l'auto-parrainage.
 */
export async function attributeReferralIfNeeded(env: Env, telegramId: number, payload: string | undefined): Promise<void> {
  if (!payload) return;

  const referrerId = decodeReferralCode(payload);
  if (!referrerId || referrerId === telegramId) return;

  const db = dbConfig(env);
  const user = await getUserIfExists(db, telegramId);
  if (!user || user.referred_by !== null) return; // déjà attribué (ou premier lien clique = définitif)

  const referrer = await getUserIfExists(db, referrerId);
  if (!referrer) return; // code invalide (parrain inexistant)

  await setReferredBy(db, telegramId, referrerId);
}

/**
 * À appeler après CHAQUE activation d'abonnement payant confirmée (USDT,
 * Monero, Litecoin — jamais /trial). Crédite le parrain une seule fois par
 * filleul (referral_rewarded), même si le filleul se réabonne plus tard.
 */
export async function maybeRewardReferral(env: Env, referredTelegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getUserIfExists(db, referredTelegramId);
  if (!user || !user.referred_by || user.referral_rewarded) return;

  const referrer = await getUserIfExists(db, user.referred_by);
  if (!referrer) return;

  const newPaidReferralCount = (referrer.paid_referral_count ?? 0) + 1;
  const hitMilestone = newPaidReferralCount % MILESTONE_REFERRALS === 0;
  const bonusDays = REFERRAL_BONUS_DAYS + (hitMilestone ? MILESTONE_BONUS_DAYS : 0);

  const base =
    referrer.expiration && new Date(referrer.expiration).getTime() > Date.now()
      ? new Date(referrer.expiration)
      : new Date();
  const newExpiration = addDays(base, bonusDays);

  await activateSubscription(db, referrer.telegram_id, referrer.plan ?? 1, newExpiration);
  await updateRows(db, "users", { telegram_id: `eq.${referrer.telegram_id}` }, { paid_referral_count: newPaidReferralCount });
  await markReferralRewarded(db, referredTelegramId);

  let message = `🎁 Un ami que tu as parrainé vient de s'abonner ! +${REFERRAL_BONUS_DAYS} jours ajoutés à ton abonnement.`;
  if (hitMilestone) {
    message += `\n\n🏆 Palier atteint : ${newPaidReferralCount} filleuls payants ! +${MILESTONE_BONUS_DAYS} jours supplémentaires offerts (1 mois gratuit).`;
  }

  try {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, referrer.telegram_id, message);
  } catch (err) {
    console.error(`[referral] Échec de la notification au parrain ${referrer.telegram_id}:`, err);
  }
}
