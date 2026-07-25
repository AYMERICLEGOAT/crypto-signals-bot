/**
 * Bloc 8 : surveillance de fraîcheur du générateur de signaux (GitHub
 * Actions, signals/main.py, toutes les heures). Si le heartbeat n'a pas été
 * rafraîchi depuis STALENESS_THRESHOLD_HOURS, le workflow a dû s'arrêter
 * silencieusement (échec de credentials, panne GitHub Actions, bug non
 * catché...) — alerte l'administrateur une seule fois par panne (`alerted`,
 * remis à false automatiquement dès que le heartbeat repart, voir
 * signals/storage.py::record_heartbeat).
 */

import { Env, dbConfig } from "../env";
import { getHeartbeat, markHeartbeatAlerted } from "../db/systemHeartbeats";
import { sendMessage } from "../telegram";

const JOB_NAME = "signals";
const STALENESS_THRESHOLD_HOURS = 3; // génération horaire : large marge avant de conclure à une panne

export async function monitorSignalsHeartbeat(env: Env): Promise<void> {
  if (!env.ADMIN_TELEGRAM_ID) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (!heartbeat) return; // jamais tourné une seule fois pour l'instant : état initial normal, pas une panne

  const ageHours = (Date.now() - new Date(heartbeat.last_run_at).getTime()) / (60 * 60 * 1000);
  if (ageHours < STALENESS_THRESHOLD_HOURS || heartbeat.alerted) return;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.ADMIN_TELEGRAM_ID),
    `🚨 Le générateur de signaux (GitHub Actions) ne semble plus avoir tourné depuis ${Math.round(ageHours)}h. ` +
      'Vérifie le workflow "Signaux crypto (horaire)" sur GitHub.'
  );
  await markHeartbeatAlerted(db, JOB_NAME);
}
