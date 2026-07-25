import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, activateSubscription } from "../../db/users";
import { logAdminAction } from "../../db/adminActions";
import { addDays } from "../../utils/date";
import { PLAN_DURATION_DAYS, PLAN_NAMES, isValidPlan } from "../../payments/plans";

const TRIAL_FALLBACK_DAYS = 3;

function isAdmin(env: Env, telegramId: number): boolean {
  return Boolean(env.ADMIN_TELEGRAM_ID) && String(telegramId) === env.ADMIN_TELEGRAM_ID;
}

function planLabel(plan: number): string {
  return plan === 0 ? "Essai gratuit" : PLAN_NAMES[plan as 1 | 2 | 3];
}

/**
 * /admin_activate <telegram_id> <plan 0-3> [jours] — résout manuellement une
 * exception de paiement (Bloc 5) : montant légèrement hors tolérance, méthode
 * de paiement non couverte, erreur signalée en support, etc. Réservé à
 * ADMIN_TELEGRAM_ID, chaque usage est journalisé (admin_actions) et le
 * destinataire est prévenu (transparence — il ne doit jamais découvrir seul
 * un changement d'abonnement).
 */
export async function handleAdminActivateCommand(env: Env, adminTelegramId: number, rawArgs: string): Promise<void> {
  if (!isAdmin(env, adminTelegramId)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, adminTelegramId, "Commande réservée à l'administrateur.");
    return;
  }

  const [targetRaw, planRaw, daysRaw] = rawArgs.trim().split(/\s+/).filter(Boolean);
  const targetTelegramId = Number(targetRaw);
  const plan = Number(planRaw);

  if (!targetRaw || !Number.isInteger(targetTelegramId) || targetTelegramId <= 0 || !(plan === 0 || isValidPlan(plan))) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      adminTelegramId,
      "Usage : /admin_activate <telegram_id> <plan 0-3> [jours]\n0=Essai, 1=Standard, 2=Pro, 3=Découverte"
    );
    return;
  }

  const days = daysRaw ? Number(daysRaw) : plan === 0 ? TRIAL_FALLBACK_DAYS : PLAN_DURATION_DAYS[plan as 1 | 2 | 3];
  if (!Number.isFinite(days) || days <= 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, adminTelegramId, "Nombre de jours invalide.");
    return;
  }

  const db = dbConfig(env);
  await getOrCreateUser(db, targetTelegramId);
  await activateSubscription(db, targetTelegramId, plan, addDays(new Date(), days));
  await logAdminAction(db, adminTelegramId, "admin_activate", targetTelegramId, `plan=${plan} days=${days}`);

  const label = planLabel(plan);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, adminTelegramId, `✅ Abonnement activé pour ${targetTelegramId} : ${label}, ${days} jour(s).`);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    targetTelegramId,
    `✅ Ton abonnement a été activé manuellement par l'administrateur : ${label} pour ${days} jour(s). Vérifie avec /status.`
  ).catch((err) => console.error(`[admin] Échec de notification à ${targetTelegramId}:`, err));
}
