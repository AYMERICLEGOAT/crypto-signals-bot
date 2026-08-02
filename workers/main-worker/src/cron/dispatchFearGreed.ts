/**
 * Bloc 12.1 : indice Fear & Greed quotidien, publié sur le canal public.
 * API publique gratuite alternative.me (aucune clé requise). Le cron tourne
 * toutes les 5 minutes (voir index.ts) : le gate "déjà publié aujourd'hui"
 * évite les envois multiples, comme dispatchEducationalPost.ts.
 */

import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { hasPostedFearGreedToday, recordFearGreedPost } from "../db/fearGreedPosts";
import { isQuietHours } from "../utils/quietHours";

const FEAR_GREED_API_URL = "https://api.alternative.me/fng/?limit=1";

const COMMENTS: Record<string, string> = {
  "Extreme Fear": "Le marché est dans la peur extrême — historiquement une zone de capitulation, pas un signal d'achat en soi.",
  Fear: "Le marché est craintif — les investisseurs restent prudents.",
  Neutral: "Le marché est dans une zone neutre, ni euphorique ni paniqué.",
  Greed: "Le marché est optimiste — prudence, l'euphorie précède parfois les corrections.",
  "Extreme Greed": "Le marché est en avidité extrême — historiquement une zone de prudence accrue.",
};

interface FearGreedApiResponse {
  data: { value: string; value_classification: string }[];
}

function translateClassification(classification: string): string {
  const map: Record<string, string> = {
    "Extreme Fear": "Peur extrême",
    Fear: "Peur",
    Neutral: "Neutre",
    Greed: "Avidité",
    "Extreme Greed": "Avidité extrême",
  };
  return map[classification] ?? classification;
}

export async function dispatchFearGreed(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  if (await hasPostedFearGreedToday(db)) return;

  let value: number;
  let classification: string;
  try {
    const res = await fetch(FEAR_GREED_API_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as FearGreedApiResponse;
    const entry = body.data?.[0];
    if (!entry) throw new Error("réponse vide");
    value = Number(entry.value);
    classification = entry.value_classification;
    if (Number.isNaN(value) || !classification) throw new Error("réponse invalide");
  } catch (err) {
    console.error("[fear-greed] Échec de récupération de l'indice, réessai au prochain cycle:", err);
    return;
  }

  // markdown:true -- échapper le username (voir signalFormat.ts) : un
  // underscore non échappé casse tout le message (bug vécu le 29/07 sur
  // /help et /referral, même famille).
  const escapedUsername = env.TELEGRAM_BOT_USERNAME?.replace(/_/g, "\\_");
  const comment = COMMENTS[classification] ?? "";
  const lines: Array<string | null> = [
    `📊 *Indice Fear & Greed : ${value} (${translateClassification(classification)})*`,
    comment,
    "",
    "ℹ️ Indicateur de sentiment de marché (source : alternative.me), pas un signal de trading ni un conseil en investissement.",
    escapedUsername ? `\n@${escapedUsername} pour des signaux en temps réel` : null,
  ];
  const text = lines.filter((line): line is string => line !== null && line !== "").join("\n");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), text, { markdown: true });
  await recordFearGreedPost(db, value, classification);
}
