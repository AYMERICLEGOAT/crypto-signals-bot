import { SupabaseConfig, selectOne, selectRows, insertRow } from "../supabaseRest";

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Gate "un instantané par jour" (Bloc 7 — archivage), basé sur la contrainte UNIQUE(stat_date). */
export async function hasComputedStatsToday(db: SupabaseConfig): Promise<boolean> {
  const row = await selectOne(db, "daily_stats", { stat_date: `eq.${todayUtcDate()}` });
  return row !== null;
}

interface SignalOutcomeRow {
  outcome: "WIN" | "LOSS";
}

interface UsdtPaymentRow {
  amount_expected: number | null;
}

/**
 * Calcule et archive un instantané quotidien de croissance (daily_stats).
 * total_revenue_usdt ne couvre QUE les paiements USDT confirmés : c'est la
 * seule méthode où amount_expected est déjà exprimé en dollars — les
 * montants XMR/LTC sont natifs (XMR, LTC) et fausseraient un total mélangé
 * s'ils étaient additionnés tels quels. Limitation assumée et documentée,
 * pas un chiffre inventé.
 */
export async function computeAndStoreDailyStats(db: SupabaseConfig): Promise<void> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [allUsers, activeTrials, payingSubscribers, resolvedSignals, confirmedUsdtPayments] = await Promise.all([
    selectRows(db, "users", {}),
    selectRows(db, "users", { plan: "eq.0", expiration: `gt.${now.toISOString()}` }),
    selectRows(db, "users", { plan_started_at: "not.is.null", expiration: `gt.${now.toISOString()}` }),
    selectRows<SignalOutcomeRow>(db, "signals", { evaluated_at: `gte.${thirtyDaysAgo}`, outcome: "not.is.null" }),
    selectRows<UsdtPaymentRow>(db, "pending_payments", { method: "eq.USDT", status: "eq.confirmed" }),
  ]);

  const wins = resolvedSignals.filter((s) => s.outcome === "WIN").length;
  const winrateRolling30d = resolvedSignals.length > 0 ? wins / resolvedSignals.length : null;
  const totalRevenueUsdt = confirmedUsdtPayments.reduce((sum, p) => sum + (p.amount_expected ?? 0), 0);

  await insertRow(db, "daily_stats", {
    stat_date: todayUtcDate(),
    total_users: allUsers.length,
    active_trials: activeTrials.length,
    paying_subscribers: payingSubscribers.length,
    winrate_rolling_30d: winrateRolling30d,
    total_revenue_usdt: totalRevenueUsdt,
  });
}
