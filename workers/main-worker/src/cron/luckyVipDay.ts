import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getActiveTrialUsers } from "../db/users";
import { hasDrawnVipToday, recordVipDraw } from "../db/luckyVip";
import { updateRows } from "../supabaseRest";
import { PRO_PLAN, PLAN_NAMES } from "../payments/plans";

const VIP_PLAN = PRO_PLAN;
const VIP_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Une fois par jour, tire au sort un utilisateur actuellement en essai
 * gratuit actif et lui offre le plan Pro (VIP) pendant au moins 24h. Comme
 * pour les autres tâches "une fois par jour", le gate vient de
 * hasDrawnVipToday() plutôt que d'un cron dédié (celui-ci tourne déjà
 * toutes les 5 minutes, voir index.ts).
 *
 * L'expiration n'est JAMAIS raccourcie : si l'essai en cours va déjà
 * au-delà de +24h (peu probable, les essais durent 3 jours), on la laisse
 * telle quelle — seul le plan passe à VIP.
 */
export async function runLuckyVipDay(env: Env): Promise<void> {
  const db = dbConfig(env);
  if (await hasDrawnVipToday(db)) return;

  const candidates = await getActiveTrialUsers(db);
  if (candidates.length === 0) return;

  const winner = candidates[Math.floor(Math.random() * candidates.length)];
  const vipUntil = new Date(Date.now() + VIP_DURATION_MS);
  const currentExpiration = winner.expiration ? new Date(winner.expiration) : null;
  const newExpiration = currentExpiration && currentExpiration > vipUntil ? currentExpiration : vipUntil;

  await updateRows(
    db,
    "users",
    { telegram_id: `eq.${winner.telegram_id}` },
    { plan: VIP_PLAN, expiration: newExpiration.toISOString(), vip_until: vipUntil.toISOString() }
  );
  await recordVipDraw(db, winner.telegram_id, vipUntil, winner.plan ?? 0);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    winner.telegram_id,
    "🎉 *Lucky VIP Day !*\n\nTu as été tiré au sort parmi les utilisateurs en essai gratuit : " +
      `accès VIP (${PLAN_NAMES[VIP_PLAN]}) offert pour les prochaines 24h, sans rien faire. Profites-en !`,
    { markdown: true }
  );
}
