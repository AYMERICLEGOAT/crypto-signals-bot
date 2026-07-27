/**
 * Bloc 8 : surveillance de fraîcheur du générateur de signaux (GitHub
 * Actions, signals/main.py, toutes les heures). Si le heartbeat n'a pas été
 * rafraîchi depuis STALENESS_THRESHOLD_HOURS, alerte l'administrateur une
 * seule fois par panne (`alerted`, remis à false automatiquement dès que le
 * heartbeat repart, voir signals/storage.py::record_heartbeat).
 *
 * Observé en production : le déclencheur `schedule:` de GitHub Actions peut
 * être retardé de plusieurs heures, voire sauté entièrement, en cas de forte
 * charge sur l'infrastructure GitHub (limitation documentée de la plateforme,
 * rien à corriger côté code du dépôt). Plutôt que seulement alerter, ce
 * module redéclenche automatiquement le workflow via l'API GitHub
 * (workflow_dispatch) si GITHUB_ACTIONS_TOKEN est configuré -- auto-guérison
 * sans attendre une action manuelle.
 */

import { Env, dbConfig } from "../env";
import { getHeartbeat, markHeartbeatAlerted } from "../db/systemHeartbeats";
import { sendMessage } from "../telegram";
import { triggerWorkflowDispatch } from "../github";

const JOB_NAME = "signals";
const STALENESS_THRESHOLD_HOURS = 3; // génération horaire : large marge avant de conclure à une panne
const WORKFLOW_FILE = "signals.yml";

export async function monitorSignalsHeartbeat(env: Env): Promise<void> {
  if (!env.ADMIN_TELEGRAM_ID) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (!heartbeat) return; // jamais tourné une seule fois pour l'instant : état initial normal, pas une panne

  const ageHours = (Date.now() - new Date(heartbeat.last_run_at).getTime()) / (60 * 60 * 1000);
  if (ageHours < STALENESS_THRESHOLD_HOURS || heartbeat.alerted) return;

  let retriggerNote = "";
  if (env.GITHUB_ACTIONS_TOKEN) {
    try {
      await triggerWorkflowDispatch(env.GITHUB_ACTIONS_TOKEN, WORKFLOW_FILE);
      retriggerNote = "\n\n🔁 Relance automatique déclenchée, ça devrait repartir dans quelques minutes.";
    } catch (err) {
      console.error("[monitor-signals] Échec du redéclenchement automatique du workflow:", err);
      retriggerNote = "\n\n⚠️ La relance automatique a échoué, une intervention manuelle est nécessaire.";
    }
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.ADMIN_TELEGRAM_ID),
    `🚨 Le générateur de signaux (GitHub Actions) ne semble plus avoir tourné depuis ${Math.round(ageHours)}h. ` +
      'Vérifie le workflow "Signaux crypto (horaire)" sur GitHub.' +
      retriggerNote
  );
  await markHeartbeatAlerted(db, JOB_NAME);
}
