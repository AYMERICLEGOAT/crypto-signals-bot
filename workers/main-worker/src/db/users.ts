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
  plan_started_at: string | null;
  reminder_48h_sent: boolean;
  reminder_24h_sent: boolean;
  reengagement_sent: boolean;
  survey_sent: boolean;
  survey_response: "up" | "down" | null;
  paid_referral_count: number;
  vip_until: string | null;
  pending_promo_code: string | null;
  discovery_used: boolean;
  cancelled: boolean;
  deleted: boolean;
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

/**
 * Même principe que hasWalletClaimedTrial, pour le Pack Découverte (5 USDT
 * /14j, "une seule fois par wallet" — voir payments/plans.ts). Ne couvre
 * que le paiement USDT (seule méthode où l'adresse de l'acheteur est
 * connue à l'avance) — limitation assumée, comme pour /trial.
 */
export async function hasWalletClaimedDiscovery(db: SupabaseConfig, address: string): Promise<boolean> {
  const rows = await selectRows<UserRecord>(db, "users", {
    wallet_address: `eq.${address.toLowerCase()}`,
    discovery_used: "eq.true",
    limit: "1",
  });
  return rows.length > 0;
}

export async function markDiscoveryUsed(db: SupabaseConfig, telegramId: number): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { discovery_used: true });
}

/**
 * Nombre de filleuls attribués à ce parrain (attributeReferralIfNeeded),
 * peu importe s'ils ont payé ou non — utilisé par la boucle virale du
 * /trial (voir bot/commands/trial.ts), distincte de maybeRewardReferral
 * qui ne récompense le parrain qu'à un premier paiement confirmé.
 */
export async function countReferralsBy(db: SupabaseConfig, telegramId: number): Promise<number> {
  const rows = await selectRows<UserRecord>(db, "users", { referred_by: `eq.${telegramId}` });
  return rows.length;
}

/**
 * Active/étend un abonnement. Remet systématiquement à zéro les indicateurs
 * de relance (48h/24h avant expiration, réengagement post-expiration) : vu
 * que l'expiration change, un rappel déjà envoyé pour l'ancienne date n'a
 * plus de sens et doit pouvoir se redéclencher pour la nouvelle.
 *
 * plan_started_at n'est posé qu'une seule fois (jamais écrasé) au premier
 * passage à un plan payant (plan > 0) — sert de repère pour le sondage de
 * satisfaction à J+7, indépendant des renouvellements/extensions ultérieurs.
 */
export async function activateSubscription(
  db: SupabaseConfig,
  telegramId: number,
  plan: number,
  expiration: Date
): Promise<void> {
  const patch: Record<string, unknown> = {
    plan,
    expiration: expiration.toISOString(),
    reminder_48h_sent: false,
    reminder_24h_sent: false,
    reengagement_sent: false,
  };

  if (plan > 0) {
    const user = await getUserIfExists(db, telegramId);
    if (user && !user.plan_started_at) {
      patch.plan_started_at = new Date().toISOString();
    }
  }

  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, patch);
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

/** Utilisateurs actuellement en essai gratuit actif (plan=0, pas encore expiré) — vivier du Lucky VIP Day. */
export async function getActiveTrialUsers(db: SupabaseConfig): Promise<UserRecord[]> {
  return selectRows<UserRecord>(db, "users", {
    plan: "eq.0",
    expiration: `gt.${new Date().toISOString()}`,
  });
}

/**
 * Utilisateurs dont l'accès expire dans la fenêtre (now, now+withinHours],
 * et n'ayant pas encore reçu la relance correspondante (`flagColumn=eq.false`).
 * Utilisé pour les relances 48h/24h avant expiration (cron/expirationReminders.ts).
 */
export async function getUsersExpiringWithin(
  db: SupabaseConfig,
  withinHours: number,
  flagColumn: "reminder_48h_sent" | "reminder_24h_sent"
): Promise<UserRecord[]> {
  const now = new Date();
  const threshold = new Date(now.getTime() + withinHours * 60 * 60 * 1000);
  return selectRows<UserRecord>(db, "users", {
    expiration: `gt.${now.toISOString()}`,
    and: `(expiration.lte.${threshold.toISOString()},${flagColumn}.eq.false)`,
  });
}

export async function markReminderSent(
  db: SupabaseConfig,
  telegramId: number,
  flagColumn: "reminder_48h_sent" | "reminder_24h_sent"
): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { [flagColumn]: true });
}

/** Utilisateurs dont l'accès a expiré il y a au moins `daysAgo` jours, sans offre de réengagement envoyée. */
export async function getUsersExpiredSince(db: SupabaseConfig, daysAgo: number): Promise<UserRecord[]> {
  const threshold = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return selectRows<UserRecord>(db, "users", {
    expiration: `lte.${threshold.toISOString()}`,
    reengagement_sent: "eq.false",
  });
}

export async function markReengagementSent(db: SupabaseConfig, telegramId: number): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { reengagement_sent: true });
}

/** Utilisateurs payants depuis au moins `days` jours (plan_started_at), sondage de satisfaction pas encore envoyé. */
export async function getUsersDueForSurvey(db: SupabaseConfig, days: number): Promise<UserRecord[]> {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return selectRows<UserRecord>(db, "users", {
    plan_started_at: `lte.${threshold.toISOString()}`,
    survey_sent: "eq.false",
  });
}

export async function markSurveySent(db: SupabaseConfig, telegramId: number): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { survey_sent: true });
}

export async function setSurveyResponse(db: SupabaseConfig, telegramId: number, response: "up" | "down"): Promise<void> {
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { survey_response: response });
}
