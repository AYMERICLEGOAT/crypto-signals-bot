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

/**
 * Bloc 13.1 — /trust (preuve sociale publique) : nombre réel d'abonnés
 * payants actifs, sans les stats admin (public, pas de gate).
 *
 * `excludeTelegramId` (audit du 01/08/2026) : l'administrateur s'active
 * régulièrement un plan pour tester le parcours de paiement. Il était compté
 * dans un chiffre présenté publiquement comme « nombre réel d'abonnés
 * payants » — une preuve sociale qui comptait le vendeur parmi ses propres
 * clients. Sur une base de 3 comptes, cela suffisait à afficher "1 trader
 * nous fait confiance" alors qu'aucun client n'avait jamais payé.
 */
export async function getActivePayingCount(db: SupabaseConfig, excludeTelegramId?: string): Promise<number> {
  const rows = await selectRows<{ telegram_id: number }>(db, "users", {
    plan_started_at: "not.is.null",
    expiration: `gt.${new Date().toISOString()}`,
    select: "telegram_id",
  });
  if (!excludeTelegramId) return rows.length;
  return rows.filter((r) => String(r.telegram_id) !== excludeTelegramId).length;
}
