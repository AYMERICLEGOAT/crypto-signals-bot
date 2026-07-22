/**
 * Parrainage géré entièrement côté Supabase (le contrat n'a pas de notion de
 * parrainage). Le "code" de parrainage n'est pas stocké séparément : c'est
 * le telegram_id du parrain encodé en base36, décodable directement — pas
 * de collision possible, pas de colonne supplémentaire.
 *
 * Même logique que workers/main-worker/src/bot/referral.ts (version
 * Cloudflare Workers, la production 24/7) — dupliquée ici pour que ce bot
 * Node reste utilisable en local à parité de fonctionnalités.
 */

import { Telegram } from "telegraf";
import { config } from "../config";
import { getUserIfExists, setReferredBy, markReferralRewarded, activateSubscription } from "../db/users";

// Bonus crédité au PARRAIN quand son filleul confirme son premier
// abonnement PAYANT (jamais sur un essai gratuit).
export const REFERRAL_BONUS_DAYS = 7;

export function encodeReferralCode(telegramId: number): string {
  return telegramId.toString(36);
}

export function decodeReferralCode(code: string): number | null {
  const value = parseInt(code, 36);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function buildReferralLink(telegramId: number): string {
  return `https://t.me/${config.telegram.botUsername}?start=${encodeReferralCode(telegramId)}`;
}

export async function attributeReferralIfNeeded(telegramId: number, payload: string | undefined): Promise<void> {
  if (!payload) return;

  const referrerId = decodeReferralCode(payload);
  if (!referrerId || referrerId === telegramId) return;

  const user = await getUserIfExists(telegramId);
  if (!user || user.referred_by !== null) return;

  const referrer = await getUserIfExists(referrerId);
  if (!referrer) return;

  await setReferredBy(telegramId, referrerId);
}

export async function maybeRewardReferral(telegram: Telegram, referredTelegramId: number): Promise<void> {
  const user = await getUserIfExists(referredTelegramId);
  if (!user || !user.referred_by || user.referral_rewarded) return;

  const referrer = await getUserIfExists(user.referred_by);
  if (!referrer) return;

  const base =
    referrer.expiration && new Date(referrer.expiration).getTime() > Date.now()
      ? new Date(referrer.expiration)
      : new Date();
  const newExpiration = new Date(base.getTime() + REFERRAL_BONUS_DAYS * 24 * 60 * 60 * 1000);

  await activateSubscription(referrer.telegram_id, referrer.plan ?? 1, newExpiration);
  await markReferralRewarded(referredTelegramId);

  try {
    await telegram.sendMessage(
      referrer.telegram_id,
      `🎁 Un ami que tu as parrainé vient de s'abonner ! +${REFERRAL_BONUS_DAYS} jours ajoutés à ton abonnement.`
    );
  } catch (err) {
    console.error(`[referral] Échec de la notification au parrain ${referrer.telegram_id}:`, err);
  }
}
