import { Env, dbConfig } from "../env";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";
import { sendMessage } from "../telegram";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, SupabaseConfig } from "../supabaseRest";
import { getSignalsCreatedSince } from "../db/signals";
import { isQuietHours } from "../utils/quietHours";

const JOB_NAME = "selectivity_digest";
const DIGEST_HOUR_UTC = 18;

/**
 * Taille de l'univers balayé à chaque cycle — `config.PAIRS` côté Python.
 *
 * Ramené de 40 à 38 le 14/08/2026 : MKR/USDT et EOS/USDT ont été retirés
 * comme marchés MORTS (6 007 $ et 76 648 $ de volume sur 24 h, contre une
 * médiane d'univers à 49 millions). Un signal sur un marché pareil est
 * injouable pour l'abonné avant même d'être juste ou faux.
 *
 * Le chiffre est publié sur le canal public : s'il change là-bas, il doit
 * changer ici. La sentinelle surveille désormais la liquidité de l'univers,
 * ce qui rendra ce genre de dérive visible sans attendre une panne.
 */
const TAILLE_UNIVERS = 38;

/**
 * Bilan quotidien de SÉLECTIVITÉ sur le canal public (02/08/2026).
 *
 * Remplace la diffusion des Alertes Momentum une par une, qui posait un
 * problème de fond plutôt qu'un simple problème de volume.
 *
 * Ce que contenait réellement une alerte momentum :
 *   « Croisement EMA baissier détecté, RSI (49) ne confirme pas encore »
 *   « RSI sort de la zone neutre (55), dynamique haussière »
 *
 * Autrement dit : les configurations que la stratégie a examinées puis
 * ÉCARTÉES. C'étaient ses rejets, publiés comme du contenu — et le message
 * le reconnaissait lui-même (« PAS un signal de trading »). Trois
 * conséquences fâcheuses :
 *   1. Non actionnable par construction : ni entrée, ni stop, ni objectif.
 *      Un lecteur qui agit dessus prend un risque non borné.
 *   2. Noyade : jusqu'à 8 rejets par jour contre ~2,5 vrais signaux, soit un
 *      canal composé aux trois quarts de non-signaux.
 *   3. Cannibalisation : montrer sans cesse ce qui a « presque » été un
 *      signal dilue la rareté de ceux qui en sont vraiment.
 *
 * Le même fait — « la stratégie a écarté 12 configurations aujourd'hui » —
 * devient au contraire un argument fort dès lors qu'il est agrégé : il
 * PROUVE la sélectivité que le service revendique (« pas de signal forcé
 * pour faire du volume »). Un message par jour au lieu de huit, et le rejet
 * passe du statut de bruit à celui de preuve.
 *
 * CE MESSAGE SE CONTREDISAIT TOUS LES JOURS (corrigé le 10/08/2026).
 *
 * Il comptait les « écartées » à partir de la table `momentum_alerts`. Or le
 * moteur qui les produisait — EMA/RSI, dit « Haute Confiance » — a été
 * désactivé le 03/08 après avoir été mesuré comme la jambe PERDANTE de la
 * stratégie (`config.ENABLE_HIGH_CONFIDENCE_ENGINE = False`). Dernière alerte
 * en base : 03/08 23:13. Depuis, ce bilan publiait chaque jour sur le canal
 * d'acquisition :
 *
 *   2 configuration(s) examinée(s) sur 40 paires :
 *   ✅ 2 signal(aux) émis
 *   🚫 0 écartée(s) — critères non réunis
 *
 * Deux mensonges dans quatre lignes. « 2 examinées » alors que les 40 paires
 * sont balayées à chaque cycle, et « 0 écartée » sur un message dont le titre
 * annonce la sélectivité — soit un taux d'acceptation de 100 % affiché comme
 * une preuve de rigueur.
 *
 * Le bilan ne s'appuie plus que sur des faits vérifiables : la taille de
 * l'univers balayé, et le nombre de signaux retenus. La soustraction n'est pas
 * affichée volontairement — le carry puise dans un univers plus large que
 * `config.PAIRS`, si bien qu'un « 38 écartées » calculé serait à nouveau une
 * approximation présentée comme un compte.
 */
async function recordSent(db: SupabaseConfig): Promise<void> {
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}

function startOfTodayUtcIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export async function dispatchSelectivityDigest(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;
  if (isQuietHours()) return;

  const now = new Date();
  if (now.getUTCHours() < DIGEST_HOUR_UTC) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (heartbeat) {
    const hours = (Date.now() - new Date(heartbeat.last_run_at).getTime()) / 3_600_000;
    if (hours < 20) return; // un seul bilan par jour
  }

  const since = startOfTodayUtcIso();
  const emitted = await getSignalsCreatedSince(db, since);

  const lines = [
    "🔍 *Bilan de sélectivité du jour*",
    "",
    `🔎 ${TAILLE_UNIVERS} paires analysées à chaque cycle.`,
    `✅ ${emitted.length} signal(aux) retenu(s) aujourd'hui.`,
    "",
  ];

  lines.push(
    emitted.length === 0
      ? "Aucun signal aujourd'hui : c'est un résultat, pas une panne. La stratégie n'émet que lorsque ses critères sont réunis, et le silence coûte moins cher qu'un mauvais trade."
      : "Le reste de l'univers n'a pas rempli les conditions d'entrée. Aucun signal n'est forcé pour faire du volume, et chaque signal émis part avec entrée, stop loss et objectifs définis à l'avance."
  );

  if (env.TELEGRAM_BOT_USERNAME) {
    const escaped = env.TELEGRAM_BOT_USERNAME.replace(/_/g, "\\_");
    lines.push("", `📡 Les signaux en temps réel : @${escaped}`);
  }

  // Voir channelBudget.ts. On sort avant recordSent : un digest bloqué doit
  // pouvoir repartir au cycle suivant, pas être consommé sans avoir été publié.
  const verdict = await peutPublier(db, "public", "quotidien");
  if (!verdict.autorise) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), lines.join("\n"), { markdown: true });
  await enregistrerEnvoi(db, "public", "quotidien", "digest");
  await recordSent(db);
}
