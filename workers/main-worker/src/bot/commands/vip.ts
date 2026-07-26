import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser } from "../../db/users";
import { getVipInviteLink } from "../vipChannel";

/** /vip (Partie 1) — lien d'invitation du canal privé, réservé aux abonnés payants actifs (Standard/Pro/Découverte, pas l'essai gratuit). */
export async function handleVipCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);

  const hasActivePaidPlan = user.plan !== null && user.plan !== 0 && user.expiration !== null && new Date(user.expiration).getTime() > Date.now();

  if (!hasActivePaidPlan) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Le groupe VIP est réservé aux abonnés payants (Standard, Pro ou Découverte). Utilise /subscribe pour t'abonner."
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
      `🔒 *Groupe VIP*\n\nRejoins le canal privé réservé aux abonnés :\n${link}\n\n` +
        "Ce lien est personnel à ton statut d'abonné — ne le partage pas, il est régénéré périodiquement.",
      { markdown: true }
    );
  } catch (err) {
    console.error(`[vip] Échec de génération du lien pour ${telegramId}:`, err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Impossible de générer le lien VIP pour le moment, réessaie plus tard.");
  }
}
