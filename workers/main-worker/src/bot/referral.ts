/**
 * Parrainage géré entièrement côté Supabase (le contrat n'a pas de notion de
 * parrainage — voir la conversation). Le "code" de parrainage n'est pas
 * stocké séparément : c'est le telegram_id du parrain encodé en base36,
 * décodable directement, ce qui évite toute collision et toute colonne
 * supplémentaire.
 */

import { Env, dbConfig } from "../env";
import { getUserIfExists, setReferredBy, claimReferralReward, activateSubscription } from "../db/users";
import { recordReferralReward } from "../db/referralRewards";
import { updateRows } from "../supabaseRest";
import { sendMessage } from "../telegram";
import { addDays } from "../utils/date";
import { PLAN_PRICES_USD, isValidPlan } from "../payments/plans";

// BLOC 22 : commission virtuelle du parrain sur le montant payé par le
// filleul -- purement incitative/psychologique, jamais versée
// automatiquement (voir README/CGV). Ex: 10% de 19 USDT (Standard) = 1,9 USDT.
export const REFERRAL_COMMISSION_RATE = 0.1;

// Bonus crédité au PARRAIN quand son filleul confirme son premier
// abonnement PAYANT (jamais sur un essai gratuit, pour éviter qu'un
// parrainage à soi-même via un second compte ne génère des jours gratuits
// sans qu'aucun paiement réel n'ait eu lieu).
export const REFERRAL_BONUS_DAYS = 7;

// Palier supplémentaire : tous les 3 filleuls payants (cumulatif, jamais
// remis à zéro), un mois gratuit en plus du bonus habituel de chaque filleul.
export const MILESTONE_REFERRALS = 3;
export const MILESTONE_BONUS_DAYS = 30;

// Bonus "Joker" (Bloc 6) : parrainer quelqu'un dans les heures qui précèdent
// l'expiration de son PROPRE abonnement (encore actif, pas déjà expiré)
// rapporte quelques jours de plus — encourage à relancer son réseau
// précisément au moment où on est tenté de laisser filer l'abonnement.
export const JOKER_THRESHOLD_HOURS = 48;
export const JOKER_BONUS_DAYS = 3;

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

  // Anti-abus (Bloc 10) : la même personne payant sur un second compte
  // Telegram avec le MÊME wallet pour se "parrainer" elle-même toucherait
  // +7 jours (voire plus avec palier/Joker) pour le prix d'un Pack
  // Découverte (5 USDT) — rentable sans qu'aucun vrai parrainage n'ait eu
  // lieu. Un wallet identique des deux côtés est un signal fort de
  // self-referral : on désactive définitivement CE parrainage (jamais
  // retenté aux paiements suivants) sans pénaliser le filleul lui-même.
  //
  // Couverture réelle par méthode de paiement : USDT (payments/usdt.ts)
  // et Litecoin (cron/pollPayments.ts::processLitecoinPayments, corrigé --
  // capture l'expéditeur via Blockchair, blockchain transparente)
  // renseignent `wallet_address` et sont donc bien protégés ici. Monero ne
  // peut PAS l'être par ce mécanisme : c'est une propriété fondamentale de
  // sa conception (aucune blockchain publique ne peut révéler l'adresse
  // d'envoi d'une transaction confidentielle), pas un manque de code --
  // un paiement Monero laissera toujours `wallet_address` intact (déjà
  // défini par un paiement USDT/LTC antérieur, ou null), donc un
  // self-referral payé exclusivement en Monero reste indétectable ici.
  if (user.wallet_address && referrer.wallet_address && user.wallet_address === referrer.wallet_address) {
    console.warn(`[referral] Parrainage ignoré (même wallet des deux côtés) : parrain ${referrer.telegram_id}, filleul ${referredTelegramId}.`);
    await claimReferralReward(db, referredTelegramId);
    return;
  }

  // Réclame ATOMIQUEMENT avant de créditer quoi que ce soit (voir
  // db/users.ts::claimReferralReward) : si une invocation concurrente a déjà
  // gagné la réclamation pour ce filleul entre-temps, on s'abstient plutôt
  // que de créditer le parrain une deuxième fois.
  if (!(await claimReferralReward(db, referredTelegramId))) return;

  const newPaidReferralCount = (referrer.paid_referral_count ?? 0) + 1;
  const hitMilestone = newPaidReferralCount % MILESTONE_REFERRALS === 0;

  const expiresAt = referrer.expiration ? new Date(referrer.expiration).getTime() : null;
  const msUntilExpiry = expiresAt !== null ? expiresAt - Date.now() : null;
  const hitJoker = msUntilExpiry !== null && msUntilExpiry > 0 && msUntilExpiry <= JOKER_THRESHOLD_HOURS * 60 * 60 * 1000;

  const bonusDays = REFERRAL_BONUS_DAYS + (hitMilestone ? MILESTONE_BONUS_DAYS : 0) + (hitJoker ? JOKER_BONUS_DAYS : 0);

  const base =
    referrer.expiration && new Date(referrer.expiration).getTime() > Date.now()
      ? new Date(referrer.expiration)
      : new Date();
  const newExpiration = addDays(base, bonusDays);

  await activateSubscription(db, referrer.telegram_id, referrer.plan ?? 1, newExpiration);
  await updateRows(db, "users", { telegram_id: `eq.${referrer.telegram_id}` }, { paid_referral_count: newPaidReferralCount });
  // referral_rewarded déjà mis à true par la réclamation atomique ci-dessus.

  // BLOC 22 : commission virtuelle sur le plan que le filleul vient de payer
  // (déjà activé sur `user` par l'appelant avant maybeRewardReferral -- voir
  // cron/pollPayments.ts). Purement incitative : jamais versée automatiquement.
  const commissionUsd = isValidPlan(user.plan ?? 0) ? PLAN_PRICES_USD[user.plan as 1 | 2 | 3] * REFERRAL_COMMISSION_RATE : 0;

  // Non bloquant : le classement hebdomadaire (Bloc 6) est une fonctionnalité
  // secondaire, elle ne doit jamais faire échouer la récompense elle-même
  // (déjà appliquée ci-dessus) ni les étapes suivantes de la confirmation
  // de paiement appelante (cron/pollPayments.ts, boucle sur plusieurs paiements).
  try {
    await recordReferralReward(db, referrer.telegram_id, referredTelegramId, bonusDays, hitMilestone, hitJoker, commissionUsd);
  } catch (err) {
    console.error(`[referral] Échec de l'enregistrement pour le leaderboard (parrain ${referrer.telegram_id}):`, err);
  }

  let message = `🎁 Un ami que tu as parrainé vient de s'abonner ! +${REFERRAL_BONUS_DAYS} jours ajoutés à ton abonnement.`;
  if (commissionUsd > 0) {
    message += `\n\n💰 Commission virtuelle : +${commissionUsd.toFixed(2)} USDT (10% de son abonnement, consultable via /referral — non versée automatiquement).`;
  }
  if (hitJoker) {
    message += `\n\n🃏 Bonus Joker : tu as parrainé juste avant l'expiration de ton abonnement, +${JOKER_BONUS_DAYS} jours supplémentaires offerts !`;
  }
  if (hitMilestone) {
    message += `\n\n🏆 Palier atteint : ${newPaidReferralCount} filleuls payants ! +${MILESTONE_BONUS_DAYS} jours supplémentaires offerts (1 mois gratuit).`;
  }

  try {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, referrer.telegram_id, message);
  } catch (err) {
    console.error(`[referral] Échec de la notification au parrain ${referrer.telegram_id}:`, err);
  }
}
