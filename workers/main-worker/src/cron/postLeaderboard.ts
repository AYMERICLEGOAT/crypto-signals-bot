/**
 * Bloc 6 : classement hebdomadaire des meilleurs parrains, posté sur le
 * canal public gratuit pour stimuler la boucle virale (bot/referral.ts).
 * Identifiants masqués (4 derniers chiffres) : suffisant pour qu'un
 * utilisateur se reconnaisse, sans exposer l'identité de qui que ce soit
 * publiquement.
 */

import { Env, dbConfig } from "../env";
import { hasPostedLeaderboardThisWeek, recordLeaderboardPost } from "../db/leaderboardPosts";
import { getTopReferrersSince, TopReferrer } from "../db/referralRewards";
import { sendMessage } from "../telegram";
import { isQuietHours } from "../utils/quietHours";

const WINDOW_DAYS = 7;
const MEDALS = ["🥇", "🥈", "🥉"];

function maskTelegramId(telegramId: number): string {
  const raw = String(telegramId);
  return `...${raw.slice(-4)}`;
}

function formatLeaderboard(top: TopReferrer[]): string {
  const lines = ["🏆 *Top Parrains de la semaine*", ""];
  top.forEach((entry, index) => {
    lines.push(`${MEDALS[index] ?? "🎖️"} ${maskTelegramId(entry.telegramId)} — ${entry.count} filleul(s) payant(s)`);
  });
  lines.push("", "Envie d'apparaître ici la semaine prochaine ? Utilise /referral pour obtenir ton lien.");
  return lines.join("\n");
}

export async function postLeaderboard(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return; // canal non configuré, rien à faire

  const db = dbConfig(env);
  if (await hasPostedLeaderboardThisWeek(db)) return;

  const top = await getTopReferrersSince(db, WINDOW_DAYS, 3);
  if (top.length === 0) return; // rien à célébrer cette semaine : on retente au prochain cycle, sans "consommer" le créneau hebdo

  const channelId = Number(env.TELEGRAM_CHANNEL_ID);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatLeaderboard(top), { markdown: true });
  await recordLeaderboardPost(db);
}
