import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser } from "../../db/users";
import { getVipInviteLink } from "../vipChannel";
import { PLAN_NAMES, PUBLIC_PLANS } from "../../payments/plans";

/**
 * /vip — lien d'invitation du canal privé, réservé aux abonnés payants actifs
 * (l'essai gratuit n'y donne pas accès).
 *
 * Deux corrections du 08/08/2026. Le refus citait « Standard, Pro ou
 * Découverte » : « Pro » n'existe plus, et les deux autres ont été renommés.
 * Une liste de paliers écrite à la main survit toujours au changement de
 * tarification qui la rend fausse — elle est désormais dérivée de
 * payments/plans.ts.
 *
 * Et le message d'accès ne disait pas que l'accès se referme. Depuis
 * cron/revokeExpiredVip.ts, quelqu'un dont l'abonnement expire est réellement
 * retiré du canal : le découvrir sans avoir été prévenu se lit comme une
 * exclusion, alors que c'est le fonctionnement annoncé partout ailleurs.
 */
export async function handleVipCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);

  const hasActivePaidPlan = user.plan !== null && user.plan !== 0 && user.expiration !== null && new Date(user.expiration).getTime() > Date.now();

  if (!hasActivePaidPlan) {
    const paliers = PUBLIC_PLANS.map((p) => PLAN_NAMES[p]).join(", ");
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `🔒 Le canal VIP est réservé aux abonnés payants (${paliers}). L'essai gratuit n'y donne pas accès.\n\n` +
        "On y publie les signaux avant le canal public, avec leurs niveaux complets, et le suivi de chaque " +
        "position jusqu'à sa clôture.",
      { keyboard: [[{ text: "⭐ Voir les offres", callback_data: "start:subscribe" }]] }
    );
    return;
  }

  if (!env.TELEGRAM_VIP_CHANNEL_ID) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Le groupe VIP n'est pas encore configuré, reviens bientôt.");
    return;
  }

  try {
    const link = await getVipInviteLink(env);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `🔒 *Canal VIP*\n\nRejoins le canal privé réservé aux abonnés :\n${link}\n\n` +
        "Ce lien est personnel à ton statut d'abonné — ne le partage pas, il est régénéré périodiquement.\n\n" +
        "À l'échéance de ton abonnement, l'accès se referme automatiquement et tu es retiré du canal. " +
        "Autant que tu le saches maintenant : ce n'est pas une exclusion, c'est le même fonctionnement " +
        "que le reste — rien à résilier, rien qui se prolonge tout seul.",
      { markdown: true }
    );
  } catch (err) {
    console.error(`[vip] Échec de génération du lien pour ${telegramId}:`, err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Impossible de générer le lien VIP pour le moment, réessaie plus tard.");
  }
}
