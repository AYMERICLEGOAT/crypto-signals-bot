/**
 * Audit#30 (30/07) : alerte si le générateur de signaux (signals/main.py)
 * n'a produit AUCUN signal (des deux moteurs, Haute Confiance ou Squeeze
 * 15M) depuis plus de STALENESS_THRESHOLD_HOURS -- distinct de
 * monitorSignalsHeartbeat.ts (qui alerte si le JOB lui-même ne tourne
 * plus) et de signals/alerts.py::maybe_alert_data_outage (qui alerte si
 * les 4 sources de données échouent) : ici, le job tourne bien et les
 * sources de données répondent, mais aucune des deux stratégies n'a
 * matché depuis trop longtemps -- un signal potentiellement révélateur
 * d'une régression de détection (seuils, filtres) plutôt qu'une panne.
 *
 * 0 signal pendant quelques heures est un état NORMAL et fréquent pour
 * cette stratégie (voir signals/config.py, commentaires sur la fréquence
 * réelle des signaux) -- le seuil de 6h et la dédup (no_signal_alerted,
 * une seule alerte par période sèche, jamais une par cycle de 5 min) sont
 * calibrés pour ne pas transformer une variance normale en spam.
 */

import { Env, dbConfig } from "../env";
import { hasRecentSignal } from "../db/signals";
import { getHeartbeat, markNoSignalAlerted } from "../db/systemHeartbeats";
import { sendMessage } from "../telegram";

const JOB_NAME = "signals";
const STALENESS_THRESHOLD_HOURS = 6;

export async function checkSignalFreshness(env: Env): Promise<void> {
  if (!env.ADMIN_TELEGRAM_ID) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (!heartbeat) return; // jamais tourné une seule fois : état initial normal, pas une panne

  const hasSignal = await hasRecentSignal(db, STALENESS_THRESHOLD_HOURS);

  if (hasSignal) {
    if (heartbeat.no_signal_alerted) await markNoSignalAlerted(db, JOB_NAME, false);
    return;
  }

  if (heartbeat.no_signal_alerted) return; // déjà alerté pour cette période sèche, pas de rappel à chaque cycle

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.ADMIN_TELEGRAM_ID),
    `⚠️ Aucun signal généré (Haute Confiance ou Squeeze 15M) depuis plus de ${STALENESS_THRESHOLD_HOURS}h, ` +
      "alors que le générateur tourne normalement (heartbeat à jour, sources de données OK). " +
      "Vérifie les seuils/filtres actifs si ça se prolonge."
  );
  await markNoSignalAlerted(db, JOB_NAME, true);
}
