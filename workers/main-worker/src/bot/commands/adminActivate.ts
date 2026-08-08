import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, activateSubscription } from "../../db/users";
import { logAdminAction } from "../../db/adminActions";
import { addDays } from "../../utils/date";
import { PLAN_DURATION_DAYS, PLAN_NAMES, isValidPlan, PaidPlan } from "../../payments/plans";

const TRIAL_FALLBACK_DAYS = 3;

function isAdmin(env: Env, telegramId: number): boolean {
  return Boolean(env.ADMIN_TELEGRAM_ID) && String(telegramId) === env.ADMIN_TELEGRAM_ID;
}

function planLabel(plan: number): string {
  return plan === 0 ? "Essai gratuit" : PLAN_NAMES[plan as PaidPlan];
}

/**
 * /admin_activate <telegram_id> <plan 0-4> [jours] — résout manuellement une
 * exception de paiement (Bloc 5) : montant légèrement hors tolérance, méthode
 * de paiement non couverte, erreur signalée en support, etc. Réservé à
 * ADMIN_TELEGRAM_ID, chaque usage est journalisé (admin_actions) et le
 * destinataire est prévenu (transparence — il ne doit jamais découvrir seul
 * un changement d'abonnement).
 */
export async function handleAdminActivateCommand(env: Env, adminTelegramId: number, rawArgs: string): Promise<void> {
  if (!isAdmin(env, adminTelegramId)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, adminTelegramId, "Cette commande est réservée à l'administrateur.\n\n" +
        "Pour ce que tu cherches, c'est probablement /help (toutes les commandes), " +
        "/status (ton abonnement) ou /subscribe (les offres).");
    return;
  }

  const [targetRaw, planRaw, daysRaw] = rawArgs.trim().split(/\s+/).filter(Boolean);
  const targetTelegramId = Number(targetRaw);
  const plan = Number(planRaw);

  if (!targetRaw || !Number.isInteger(targetTelegramId) || targetTelegramId <= 0 || !(plan === 0 || isValidPlan(plan))) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      adminTelegramId,
      // Les libellés étaient périmés (« Standard », « Pro ») et la borne « 0-3 »
      // était fausse depuis l'ajout du plan 4 : un admin qui tapait 4 en croyant
      // le paramètre refusé accordait cent ans d'accès sans le moindre garde-fou.
      "Usage : /admin_activate <telegram_id> <plan 0-4> [jours]\n" +
        "0=Essai gratuit (3 j), 1=Mensuel (30 j), 2=Trimestriel (90 j), 3=Découverte (14 j), 4=À VIE (100 ans)"
    );
    return;
  }

  const days = daysRaw ? Number(daysRaw) : plan === 0 ? TRIAL_FALLBACK_DAYS : PLAN_DURATION_DAYS[plan as PaidPlan];
  if (!Number.isFinite(days) || days <= 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, adminTelegramId, "Nombre de jours invalide.");
    return;
  }

  const db = dbConfig(env);
  const cible = await getOrCreateUser(db, targetTelegramId);

  // ON PROLONGE, ON NE REMPLACE JAMAIS.
  //
  // Cette commande sert à dédommager : montant hors tolérance, paiement non
  // couvert, erreur signalée en support. Elle partait de `new Date()`, si bien
  // qu'accorder 7 jours à quelqu'un qui en avait 60 lui en RETIRAIT 53 — en
  // silence, sous un message « ✅ activé ». Réparer une erreur en en créant une
  // plus grosse, et invisible.
  //
  // Tous les autres chemins qui offrent des jours partent déjà de l'échéance
  // existante (bot/referral.ts, cron/pollPayments.ts, commands/cancel.ts) :
  // celui-ci était le seul à repartir de zéro.
  const encoreActif = Boolean(cible.expiration) && new Date(cible.expiration as string).getTime() > Date.now();
  const base = encoreActif ? new Date(cible.expiration as string) : new Date();
  const nouvelleFin = addDays(base, days);

  await activateSubscription(db, targetTelegramId, plan, nouvelleFin);
  await logAdminAction(db, adminTelegramId, "admin_activate", targetTelegramId, `plan=${plan} days=${days}`);

  const label = planLabel(plan);
  const finFr = nouvelleFin.toLocaleDateString("fr-FR");
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    adminTelegramId,
    `✅ ${label}, ${days} jour(s) pour ${targetTelegramId} — accès jusqu'au ${finFr}` +
      (encoreActif ? " (prolongation de l'échéance existante, rien n'a été écrasé)." : ".")
  );

  // L'ÉCHEC DE NOTIFICATION REMONTE À L'ADMIN, il n'est plus seulement
  // journalisé. Telegram répond 403 « bot can't initiate conversation » quand
  // la personne n'a jamais démarré le bot : une faute de frappe sur l'ID créait
  // donc un compte fantôme actif pendant que l'admin lisait « ✅ activé » et que
  // le vrai client attendait toujours.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    targetTelegramId,
    `✅ Ton accès a été prolongé manuellement par l'administrateur : ${label}, ${days} jour(s) — ` +
      `valable jusqu'au ${finFr}. Le détail est dans /status.`
  ).catch(async (err) => {
    console.error(`[admin] Échec de notification à ${targetTelegramId}:`, err);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      adminTelegramId,
      `⚠️ Accès bien accordé à ${targetTelegramId}, mais impossible de le prévenir. Vérifie l'ID : ` +
        "cette personne n'a peut-être jamais démarré le bot, et une ligne a pu être créée pour un ID inexistant."
    ).catch(() => {});
  });
}
