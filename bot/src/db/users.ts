import { supabase } from "./supabaseClient";

export interface UserRecord {
  telegram_id: number;
  wallet_address: string | null;
  plan: number | null;
  expiration: string | null; // timestamp ISO
  trial_used: boolean;
  created_at: string;
  referred_by: number | null;
  referral_rewarded: boolean;
}

export async function getOrCreateUser(telegramId: number): Promise<UserRecord> {
  const { data: existing, error: selectError } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing as UserRecord;

  const { data: created, error: insertError } = await supabase
    .from("users")
    .insert({ telegram_id: telegramId })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return created as UserRecord;
}

/** Les adresses EVM sont stockées en minuscules pour des comparaisons fiables. */
export async function setWalletAddress(telegramId: number, address: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ wallet_address: address.toLowerCase() })
    .eq("telegram_id", telegramId);
  if (error) throw error;
}

/** Comme getOrCreateUser mais ne crée rien : utile pour valider un referrer sans polluer la table. */
export async function getUserIfExists(telegramId: number): Promise<UserRecord | null> {
  const { data, error } = await supabase.from("users").select("*").eq("telegram_id", telegramId).maybeSingle();
  if (error) throw error;
  return (data as UserRecord) || null;
}

export async function setReferredBy(telegramId: number, referrerTelegramId: number): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ referred_by: referrerTelegramId })
    .eq("telegram_id", telegramId);
  if (error) throw error;
}

export async function markReferralRewarded(telegramId: number): Promise<void> {
  const { error } = await supabase.from("users").update({ referral_rewarded: true }).eq("telegram_id", telegramId);
  if (error) throw error;
}

export async function findUserByWalletAddress(address: string): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("wallet_address", address.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return (data as UserRecord) || null;
}

export async function activateSubscription(telegramId: number, plan: number, expiration: Date): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ plan, expiration: expiration.toISOString() })
    .eq("telegram_id", telegramId);
  if (error) throw error;
}

export async function markTrialUsed(telegramId: number): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({ trial_used: true })
    .eq("telegram_id", telegramId);
  if (error) throw error;
}

export function isSubscriptionActive(user: Pick<UserRecord, "expiration">): boolean {
  if (!user.expiration) return false;
  return new Date(user.expiration).getTime() > Date.now();
}

/** Utilisé par le dispatcher de signaux : tous les utilisateurs avec un abonnement (ou essai) en cours. */
export async function getActiveUsers(): Promise<UserRecord[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .gt("expiration", new Date().toISOString());
  if (error) throw error;
  return (data || []) as UserRecord[];
}
