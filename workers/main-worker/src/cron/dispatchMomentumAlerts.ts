/**
 * Alertes Momentum : UN bilan groupé par jour sur le canal VIP.
 *
 * CE QUI A CHANGÉ, ET POURQUOI.
 *
 * Ces alertes partaient une par une, jusqu'à huit par jour, trois par cycle de
 * cinq minutes. L'historique du module raconte une longue suite de réductions —
 * 30+ par jour, puis 8, puis 3 par cycle — chacune motivée par le même retour :
 * « c'est du spam ». Réduire le débit n'a jamais réglé le problème, parce que
 * le problème n'était pas le débit.
 *
 * Une alerte momentum n'est PAS actionnable, et le module le dit lui-même :
 * « dynamique de marché, PAS un signal de trading, ni stop loss ni take
 * profit ». Un message qu'on ne peut pas jouer, envoyé huit fois par jour dans
 * un canal dont on attend des trades, n'est pas de l'information : c'est du
 * bruit qui rend les vrais signaux plus difficiles à voir. Sur le canal VIP, ces
 * huit messages noyaient les célébrations de TP2 et TP3 — c'est-à-dire la seule
 * chose que l'abonné a payée pour lire.
 *
 * Elles sont donc groupées en UN bilan quotidien. Le même contenu, une fois,
 * lisible d'un coup d'œil, et qui prend enfin la forme de ce qu'il est : un
 * état du marché, pas une alerte. Rien n'est perdu — les alertes non diffusées
 * restent en base et rejoignent le bilan du lendemain.
 *
 * Le canal public, lui, reçoit le bilan de sélectivité (voir
 * dispatchSelectivityDigest.ts), qui dit combien de configurations ont été
 * examinées puis écartées. Le même fait, transformé en preuve de sélectivité.
 */

import { Env, dbConfig } from "../env";
import { getUnsentMomentumAlerts, markMomentumAlertSent, MomentumAlertRecord } from "../db/momentumAlerts";
import { sendMessage } from "../telegram";
import { isQuietHours } from "../utils/quietHours";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow } from "../supabaseRest";

const JOB_NAME = "momentum_digest_vip";

/**
 * Heure du bilan, en UTC. En fin d'après-midi : la séance européenne est
 * terminée et l'américaine est ouverte, la journée a donc livré l'essentiel de
 * ses mouvements. Publier le matin résumerait surtout la nuit.
 */
const HEURE_BILAN_UTC = 17;

/**
 * Plafond de lignes dans le bilan. Au-delà, la liste cesse d'être lisible et
 * redevient ce qu'on essaie d'éviter — un mur. Les alertes en trop restent en
 * base, non marquées, et partiront le lendemain.
 */
const MAX_LIGNES = 8;

function debutDeJourUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function construireBilan(alertes: MomentumAlertRecord[]): string {
  const lignes = alertes.map((a) => `• *${a.pair}* — ${a.detail}`);
  return [
    `⚡ *Mouvements du jour — ${alertes.length} paire${alertes.length > 1 ? "s" : ""}*`,
    "",
    ...lignes,
    "",
    "ℹ️ Du CONTEXTE de marché, pas des trades : ces paires ont bougé fort, mais aucune ne remplit " +
      "les conditions d'entrée de la stratégie. Ni entrée, ni stop, ni objectif — rien à jouer ici.",
    "",
    "C'est justement ce que le filtrage écarte. Les vrais signaux arrivent séparément, avec leurs niveaux.",
  ].join("\n");
}

export async function dispatchMomentumAlerts(env: Env): Promise<void> {
  if (isQuietHours()) return;
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;

  const db = dbConfig(env);
  const maintenant = new Date();
  if (maintenant.getUTCHours() < HEURE_BILAN_UTC) return;

  // « Est-ce déjà fait aujourd'hui ? » plutôt qu'une fenêtre horaire : les
  // déclenchements de cron sont régulièrement retardés, et une fenêtre ratée
  // ferait sauter le bilan de la journée entière sans que rien ne le signale.
  // Même raisonnement que storage.daily_job_already_ran_today côté Python.
  const dernier = await getHeartbeat(db, JOB_NAME);
  if (dernier && new Date(dernier.last_run_at) >= debutDeJourUtc()) return;

  const alertes = await getUnsentMomentumAlerts(db, MAX_LIGNES);
  if (alertes.length === 0) return;

  const verdict = await peutPublier(db, "vip", "quotidien");
  if (!verdict.autorise) return;

  try {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_VIP_CHANNEL_ID), construireBilan(alertes), {
      markdown: true,
    });
  } catch (err) {
    // Rien n'est marqué en cas d'échec : les alertes repartiront au prochain
    // passage plutôt que d'être consommées sans avoir été lues.
    console.error("[momentum-alerts] Échec de diffusion du bilan VIP :", err);
    return;
  }

  await enregistrerEnvoi(db, "vip", "quotidien", "bilan-momentum");
  for (const alerte of alertes) {
    await markMomentumAlertSent(db, alerte.id).catch((err) =>
      console.error(`[momentum-alerts] Marquage impossible pour l'alerte #${alerte.id}:`, err)
    );
  }
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: maintenant.toISOString() }, "job_name").catch((err) =>
    console.error("[momentum-alerts] Enregistrement du passage impossible :", err)
  );
}
