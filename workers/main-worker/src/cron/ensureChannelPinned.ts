/**
 * Retour admin (30/07) : la tâche "Guide visuel de paiement + épinglage
 * canal" avait été marquée faite mais l'épinglage lui-même n'avait jamais
 * été implémenté (aucun appel à pinChatMessage nulle part dans le code) --
 * seuls le CTA /pay et l'image du guide existaient. Un visiteur qui ouvre le
 * canal public pour la première fois n'avait donc RIEN d'épinglé pour
 * comprendre en un coup d'œil comment accéder au bot.
 *
 * Épinglé une seule fois (flag dans system_heartbeats, jamais ré-épinglé à
 * chaque déploiement) : un admin qui personnalise/déplace le pin ensuite ne
 * se le voit pas écraser par ce job.
 */

import { Env, dbConfig } from "../env";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow } from "../supabaseRest";
import { sendMessageAndGetId, pinChatMessage } from "../telegram";
import { PART_FILTRE_FERME } from "../publishedStats";

/**
 * VERSIONNÉ. L'ancien drapeau `channel_pinned` reste en base et n'est plus lu :
 * il empêchait toute mise à jour du pin, par conception. Chaque nouvelle
 * version du texte prend un nom neuf, s'épingle une fois, puis se verrouille de
 * la même manière — un admin qui déplace ou personnalise le pin ensuite ne se
 * le voit jamais écraser.
 */
const JOB_NAME = "channel_pinned_v2";

export async function ensureChannelPinned(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID || !env.TELEGRAM_BOT_USERNAME) return;

  const db = dbConfig(env);
  if (await getHeartbeat(db, JOB_NAME)) return; // déjà épinglé une fois, ne jamais recommencer

  const channelId = Number(env.TELEGRAM_CHANNEL_ID);

  // LE TEXTE LE PLUS RENTABLE DU CANAL, et il faisait 120 caractères.
  //
  // Un visiteur arrive TOUJOURS au milieu du flux, jamais au début : il voit
  // trois messages sans contexte et repart. Un post de bienvenue descend et
  // disparaît en 24 h ; l'épinglé est vu par 100 % des visiteurs, pour
  // toujours. C'est le seul texte du canal qui mérite d'être long.
  //
  // L'ancienne version annonçait « ici en différé ». C'était vrai quand le
  // canal gratuit recevait le message complet trente minutes après les
  // abonnés. Depuis la refonte du teaser, il reçoit l'annonce immédiatement
  // puis le signal ENTIER avec son résultat à la clôture — donc mieux que ce
  // que le pin promettait, sans que personne le sache.
  //
  // Il répond à quatre questions, dans l'ordre où un visiteur se les pose. La
  // quatrième est la plus importante : annoncer le silence AVANT qu'il soit
  // subi transforme le premier motif de départ en preuve de sérieux.
  // SANS parse_mode, volontairement. sendMessageAndGetId n'en envoie pas, et
  // c'est la bonne décision pour un texte long : le nom du bot contient un
  // underscore, qui ouvre une entité italique en Markdown historique et fait
  // rejeter le message ENTIER par Telegram. La structure passe donc par les
  // majuscules et les émojis, jamais par des astérisques.
  const text = [
    "📊 SIGNAUX CRYPTO GRATUITS — comment ça marche ici",
    "",
    "▪️ C'EST QUOI ?",
    "Cinq moteurs automatiques, validés sur 6 ans contre un tirage aléatoire — c'est-à-dire comparés à " +
      "la chance, pour vérifier qu'ils font mieux qu'elle.",
    "",
    "▪️ CE QUE TU REÇOIS GRATUITEMENT, ICI",
    "Chaque signal est annoncé au moment où il part : la paire, le moteur, la durée prévue. Puis il est " +
      "republié ENTIER à sa clôture, avec ses niveaux d'origine et son résultat — gagnant ou perdant. " +
      "Rien n'est retiré après coup.",
    "",
    "▪️ CE QUE TU N'AS PAS ICI",
    "L'entrée, le stop et les objectifs au moment où le signal part. C'est la seule différence, et c'est " +
      "ce qui se paie.",
    "",
    "▪️ ET QUAND C'EST SILENCIEUX ?",
    "Les moteurs directionnels sont coupés tant que le Bitcoin est sous sa moyenne 200 jours — " +
      `${PART_FILTRE_FERME} du temps sur 6 ans, jusqu'à 381 jours d'affilée une fois. Ce n'est pas une ` +
      "panne : c'est la règle qui évite les années à -70 %.",
    "",
    `👉 COMMENCER : @${env.TELEGRAM_BOT_USERNAME} puis /trial — 3 jours, sans carte bancaire.`,
    "",
    "⚠️ Signaux informatifs. Ni conseil en investissement, ni promesse de gain.",
  ].join("\n");

  const messageId = await sendMessageAndGetId(env.TELEGRAM_BOT_TOKEN, channelId, text);
  await pinChatMessage(env.TELEGRAM_BOT_TOKEN, channelId, messageId);
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}
