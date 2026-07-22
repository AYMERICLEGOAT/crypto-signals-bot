import { SupabaseConfig, selectOne, selectRows, insertRow, updateRows } from "../supabaseRest";

export interface UserRecord {
  telegram_id: number;
  wallet_address: string | null;
  plan: number | null;
  expiration: string | null;
  trial_used: boolean;
  created_at: string;
  referred_by: number | null;
  referral_rewarded: boolean;
}

export async function getOrCreateUser(db: SupabaseConfig, telegramId: number): Promise<UserRecord> {
  const existing = await selectOne<UserRecord>(db, "users", { telegram_id: `eq.${telegramId}` });
  if (existing) return existing;
  return insertRow<UserRecord>(db, "users", { telegram_id: telegramId });
}

/** Comme getOrCreateUser mais ne crée rien : utile pour valider un referrer sans polluer la table. */
export async function getUserIfExists(db: SupabaseConfig, telegramId: number): Promise<UserRecord | null> {
  return selectOne<UserRecord>(db, "users", { telegram_id: `eq.${telegramId}` });
}

export async function setReferredBy(db: SupabaseConfig, telegramId: number, referrerTelegramId: number): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { referred_by: referrerTelegramId });
}

export async function markReferralRewarded(db: SupabaseConfig, telegramId: number): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { referral_rewarded: true });
}

export async function setWalletAddress(db: SupabaseConfig, telegramId: number, address: string): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { wallet_address: address.toLowerCase() });
}

export async function findUserByWalletAddress(db: SupabaseConfig, address: string): Promise<UserRecord | null> {
  return selectOne<UserRecord>(db, "users", { wallet_address: `eq.${address.toLowerCase()}` });
}

/**
 * Anti-abus pour l'essai gratuit sans contrat (V2 off-chain) : le contrat
 * garantissait "un essai par adresse" via son mapping trialUsed on-chain,
 * indépendamment du compte Telegram utilisé. Cette vérification reproduit
 * la même garantie côté Supabase, en cherchant TOUT utilisateur (peu
 * importe son telegram_id) ayant déjà consommé un essai avec cette adresse.
 */
export async function hasWalletClaimedTrial(db: SupabaseConfig, address: string): Promise<boolean> {
  const rows = await selectRows<UserRecord>(db, "users", {
    wallet_address: `eq.${address.toLowerCase()}`,
    trial_used: "eq.true",
    limit: "1",
  });
  return rows.length > 0;
}

export async function activateSubscription(
  db: SupabaseConfig,
  telegramId: number,
  plan: number,
  expiration: Date
): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { plan, expiration: expiration.toISOString() });
}

export async function markTrialUsed(db: SupabaseConfig, telegramId: number): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { trial_used: true });
}

export function isSubscriptionActive(user: Pick<UserRecord, "expiration">): boolean {
  if (!user.expiration) return false;
  return new Date(user.expiration).getTime() > Date.now();
}

/** Utilisé par le cron de diffusion des signaux : tous les abonnés actuellement actifs. */
export async function getActiveUsers(db: SupabaseConfig): Promise<UserRecord[]> {
  return selectRows<UserRecord>(db, "users", { expiration: `gt.${new Date().toISOString()}` });
}
