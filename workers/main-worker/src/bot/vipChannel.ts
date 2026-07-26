/**
 * Canal VIP privé (Partie 1) : un seul lien d'invitation partagé, régénéré
 * tous les VIP_INVITE_ROTATION_DAYS jours (voir cron/rotateVipInvite.ts) pour
 * limiter l'impact d'une fuite -- pas un lien par utilisateur (Telegram le
 * permettrait, mais ce serait un suivi bien plus lourd pour un gain limité
 * ici : un abonné qui partage son accès VIP reste rare et se voit via le
 * nombre de membres du canal, pas via l'identité du lien).
 */

import { Env, dbConfig } from "../env";
import { createChatInviteLink, revokeChatInviteLink } from "../telegram";
import { getVipInviteState, setVipInviteState } from "../db/vipInvite";

export const VIP_INVITE_ROTATION_DAYS = 30;

/** Retourne le lien actif, en le créant s'il n'existe pas encore (jamais la rotation elle-même, voir cron dédié). */
export async function getVipInviteLink(env: Env): Promise<string | null> {
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return null;

  const db = dbConfig(env);
  const existing = await getVipInviteState(db);
  if (existing) return existing.link;

  const link = await createChatInviteLink(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_VIP_CHANNEL_ID, "ProSignaux VIP");
  await setVipInviteState(db, link, new Date().toISOString());
  return link;
}

/** À appeler par le cron (voir index.ts) : révoque et remplace le lien s'il a dépassé VIP_INVITE_ROTATION_DAYS. */
export async function rotateVipInviteLinkIfDue(env: Env): Promise<void> {
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;

  const db = dbConfig(env);
  const existing = await getVipInviteState(db);
  if (!existing) {
    await getVipInviteLink(env); // premier lien jamais créé
    return;
  }

  const ageDays = (Date.now() - new Date(existing.createdAt).getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays < VIP_INVITE_ROTATION_DAYS) return;

  const newLink = await createChatInviteLink(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_VIP_CHANNEL_ID, "ProSignaux VIP");
  await setVipInviteState(db, newLink, new Date().toISOString());
  try {
    await revokeChatInviteLink(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_VIP_CHANNEL_ID, existing.link);
  } catch (err) {
    // Non bloquant : le nouveau lien est déjà actif et enregistré, l'ancien
    // resterait valide encore un peu en cas d'échec ponctuel de révocation,
    // ce n'est pas grave (juste moins strict que prévu jusqu'au prochain cycle).
    console.error("[vip] Échec de révocation de l'ancien lien VIP:", err);
  }
}
