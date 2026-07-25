/**
 * Bloc 10 : corrige un bug de conception du Lucky VIP Day (cron/luckyVipDay.ts)
 * — le plan passait à Pro pour 24h, mais rien ne le restaurait ensuite. Si
 * l'essai gratuit sous-jacent du gagnant durait déjà au-delà de ces 24h
 * (peu fréquent mais possible en début d'essai), il gardait le plan Pro
 * indéfiniment au lieu de revenir à l'essai gratuit une fois le VIP terminé.
 *
 * Ne touche RIEN si l'utilisateur a payé un vrai abonnement entre-temps
 * (plan_started_at posé UNIQUEMENT par activateSubscription() sur un
 * paiement confirmé, jamais par le tirage VIP lui-même) : on ne doit jamais
 * rétrograder un client payant sous prétexte qu'il avait gagné le tirage
 * avant de payer pour de vrai.
 */

import { Env, dbConfig } from "../env";
import { getDueLuckyVipReverts, markLuckyVipReverted } from "../db/luckyVip";
import { getUserIfExists } from "../db/users";
import { updateRows } from "../supabaseRest";
import { PRO_PLAN } from "../payments/plans";

export async function revertLuckyVip(env: Env): Promise<void> {
  const db = dbConfig(env);
  const dueReverts = await getDueLuckyVipReverts(db);

  for (const draw of dueReverts) {
    const user = await getUserIfExists(db, draw.telegram_id);
    if (user && !user.plan_started_at && user.plan === PRO_PLAN) {
      await updateRows(db, "users", { telegram_id: `eq.${draw.telegram_id}` }, { plan: draw.previous_plan ?? 0 });
    }
    await markLuckyVipReverted(db, draw.id);
  }
}
