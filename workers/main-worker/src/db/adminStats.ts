import { SupabaseConfig, selectRows } from "../supabaseRest";

export interface AdminStats {
  trials: number;
  everPaid: number;
  activePaying: number;
  conversionRatePct: number;
}

/**
 * Distingue un abonnement VIP offert (Lucky VIP Day, voir cron/luckyVipDay.ts
 * — qui écrit plan directement sans passer par activateSubscription()) d'un
 * VRAI paiement confirmé : seul activateSubscription() pose plan_started_at,
 * donc IS NOT NULL == a payé au moins une fois dans sa vie.
 */
export async function getAdminStats(db: SupabaseConfig): Promise<AdminStats> {
  const [trialRows, everPaidRows, activePayingRows] = await Promise.all([
    selectRows(db, "users", { trial_used: "eq.true" }),
    selectRows(db, "users", { plan_started_at: "not.is.null" }),
    selectRows(db, "users", { plan_started_at: "not.is.null", expiration: `gt.${new Date().toISOString()}` }),
  ]);

  const trials = trialRows.length;
  const everPaid = everPaidRows.length;
  const activePaying = activePayingRows.length;
  const conversionRatePct = trials > 0 ? Math.round((everPaid / trials) * 1000) / 10 : 0;

  return { trials, everPaid, activePaying, conversionRatePct };
}
