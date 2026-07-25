/**
 * Bloc 9 : quand aucun vrai signal n'est sorti depuis 24h, poste un statut
 * honnête sur le canal public plutôt que de laisser le silence s'installer
 * (gestion des attentes — même esprit que la page d'attente du site SEO et
 * les résumés macro Twitter/Discord du Bloc 1, mais propre au canal public
 * Telegram). Un seul post par jour, et rien si un vrai signal a déjà occupé
 * le canal.
 */

import { Env, dbConfig } from "../env";
import { hasPostedNoSignalStatusToday, recordNoSignalStatusPost } from "../db/noSignalStatus";
import { hasRecentSignal } from "../db/signals";
import { sendMessage } from "../telegram";

const LOOKBACK_HOURS = 24;

const STATUS_MESSAGE = [
  "📡 *Aucun signal généré aujourd'hui.*",
  "La stratégie surveille 20 paires en continu et n'agit que lorsque ses critères sont réunis — pas de signal forcé pour faire du volume.",
  "",
  "Reste connecté, le prochain signal arrivera dès qu'une vraie opportunité se présente.",
].join("\n");

export async function dispatchNoSignalStatus(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  if (await hasPostedNoSignalStatusToday(db)) return;
  if (await hasRecentSignal(db, LOOKBACK_HOURS)) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), STATUS_MESSAGE, { markdown: true });
  await recordNoSignalStatusPost(db);
}
