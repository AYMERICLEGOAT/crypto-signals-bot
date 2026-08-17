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
 * au-delà de +24h, on la laisse telle quelle — seul le plan passe à VIP.
 *
 * LE MESSAGE ANNONÇAIT 24 H, LE CODE EN DONNAIT JUSQU'À TROIS JOURS.
 *
 * Le gagnant est tiré parmi les essais ACTIFS, et un essai dure trois jours :
 * son expiration est donc presque toujours postérieure à +24 h, et c'est elle
 * qui est conservée. Le plan Pro courait ainsi jusqu'à la fin de l'essai, pas
 * vingt-quatre heures. L'écart jouait en faveur de l'utilisateur, ce qui est
 * précisément pourquoi il pouvait durer : personne ne se plaint de recevoir
 * plus que promis. Le message annonce désormais la date réellement inscrite en
 * base.
 *
 * `vip_until` NE COMMANDE RIEN, et c'est le piège à connaître ici. Cette
 * colonne est écrite par cette tâche et lue par AUCUNE autre : la seule chose
 * qui gouverne l'accès au canal VIP est `expiration` (voir
 * cron/revokeExpiredVip.ts, qui n'interroge qu'elle). Un champ nommé
 * « vip_until » ressemble pourtant à un verrou — y adosser un contrôle futur
 * sans vérifier accorderait un accès que rien ne révoquerait jamais. Il est
 * conservé comme trace du tirage, rien de plus.
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

  // La durée annoncée est LUE sur ce qui vient d'être écrit en base, jamais
  // écrite en dur : c'est la seule façon qu'elle ne puisse pas diverger.
  const heures = Math.max(1, Math.round((newExpiration.getTime() - Date.now()) / 3_600_000));
  const duree = heures >= 48 ? `les ${Math.round(heures / 24)} prochains jours` : `les ${heures} prochaines heures`;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    winner.telegram_id,
    "🎉 *Lucky VIP Day !*\n\nTu as été tiré au sort parmi les utilisateurs en essai gratuit : " +
      `accès VIP (${PLAN_NAMES[VIP_PLAN]}) offert pour ${duree}, sans rien faire. Profites-en !`,
    { markdown: true }
  );
}
