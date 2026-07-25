import { SupabaseConfig, insertRow, selectRows } from "../supabaseRest";

/**
 * Journal des récompenses de parrainage (Bloc 6) — permet de calculer un
 * classement PAR PÉRIODE ("top 3 de la semaine"), impossible avec le seul
 * compteur cumulatif users.paid_referral_count.
 */
export async function recordReferralReward(
  db: SupabaseConfig,
  referrerTelegramId: number,
  referredTelegramId: number,
  bonusDays: number,
  milestoneHit: boolean,
  jokerHit: boolean
): Promise<void> {
  await insertRow(db, "referral_rewards", {
    referrer_telegram_id: referrerTelegramId,
    referred_telegram_id: referredTelegramId,
    bonus_days: bonusDays,
    milestone_hit: milestoneHit,
    joker_hit: jokerHit,
  });
}

interface RewardRow {
  referrer_telegram_id: number;
}

export interface TopReferrer {
  telegramId: number;
  count: number;
}

/**
 * Top `limit` parrains par nombre de filleuls payants récompensés sur les
 * `sinceDays` derniers jours. Agrégation faite ici (pas de RPC PostgREST
 * générique pour un group-by) : volume attendu faible à l'échelle du projet.
 */
export async function getTopReferrersSince(db: SupabaseConfig, sinceDays: number, limit = 3): Promise<TopReferrer[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = await selectRows<RewardRow>(db, "referral_rewards", {
    rewarded_at: `gte.${since}`,
    select: "referrer_telegram_id",
  });

  const counts = new Map<number, number>();
  for (const row of rows) {
    counts.set(row.referrer_telegram_id, (counts.get(row.referrer_telegram_id) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([telegramId, count]) => ({ telegramId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
