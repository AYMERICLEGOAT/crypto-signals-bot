import { Env, dbConfig } from "../env";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";
import { sendMessage } from "../telegram";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, SupabaseConfig } from "../supabaseRest";
import { getSignalsCreatedSince } from "../db/signals";
import { getMomentumAlertDetailsSince } from "../db/momentumAlerts";
import { isQuietHours } from "../utils/quietHours";

const JOB_NAME = "selectivity_digest";
const DIGEST_HOUR_UTC = 18;

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
 * Les alertes individuelles restent diffusées sur le canal VIP : pour un
 * abonné qui trade activement, le contexte temps réel a une valeur — c'est
 * précisément le genre de différence qui justifie un abonnement.
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
  const [emitted, rejected] = await Promise.all([
    getSignalsCreatedSince(db, since),
    getMomentumAlertDetailsSince(db, since),
  ]);

  const examined = emitted.length + rejected.length;
  // Rien examiné du tout = journée sans donnée exploitable : publier
  // « 0 configuration » n'apprendrait rien et ferait douter du service.
  if (examined === 0) return;

  const lines = [
    "🔍 *Bilan de sélectivité du jour*",
    "",
    `${examined} configuration(s) examinée(s) sur 40 paires :`,
    `✅ ${emitted.length} signal(aux) émis`,
    `🚫 ${rejected.length} écartée(s) — critères non réunis`,
    "",
  ];

  if (rejected.length > 0) {
    const sample = rejected.slice(0, 3).map((a) => `• ${a.pair} — ${a.detail}`);
    lines.push("Exemples de ce qui a été écarté :", ...sample, "");
  }

  lines.push(
    emitted.length === 0
      ? "Aucun signal aujourd'hui : c'est un résultat, pas une panne. La stratégie n'émet que lorsque ses critères sont réunis."
      : "Chaque signal émis part avec entrée, stop loss et objectifs définis à l'avance."
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
