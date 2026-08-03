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
 * réelle des signaux) -- le seuil et la dédup (no_signal_alerted, une
 * seule alerte par période sèche, jamais une par cycle de 5 min) sont
 * calibrés pour ne pas transformer une variance normale en spam.
 *
 * Recalibré le 03/08/2026 avec le remplacement du moteur. Le seuil de 6h
 * datait de moteurs intrajournaliers qui pouvaient émettre à toute heure ;
 * il est devenu franchement faux avec le moteur Force Relative, qui ne
 * tourne qu'UNE FOIS PAR JOUR (config.RS_RUN_HOUR_UTC) et ne redéclenche
 * pas une paire déjà détenue pendant ses 7 jours de portage. Autrement dit
 * une alerte quasi quotidienne pour un système parfaitement sain.
 *
 * Surtout : ce moteur n'émet RIEN tant que le Bitcoin est sous sa moyenne
 * 200 jours, et ce filtre est fermé 41 % du temps -- la plus longue
 * fermeture mesurée en 6 ans a duré 381 jours. Une absence de signaux n'est
 * donc plus, à elle seule, un indice de régression : elle est le
 * comportement attendu la moitié du temps. Le message le dit maintenant
 * explicitement, au lieu d'envoyer l'admin déboguer des seuils qui vont
 * bien. La liveness du job reste couverte par monitorSignalsHeartbeat.ts,
 * qui lui ne dépend pas du régime de marché.
 */

import { Env, dbConfig } from "../env";
import { hasRecentSignal } from "../db/signals";
import { getHeartbeat, markNoSignalAlerted } from "../db/systemHeartbeats";
import { sendMessage } from "../telegram";

const JOB_NAME = "signals";
// 72h : le moteur ne tourne qu'une fois par jour et n'ouvre que sur les paires
// qu'il ne détient pas déjà. Même filtre ouvert, deux jours sans nouvelle
// entrée sont banals ; trois commencent à mériter un coup d'oeil.
const STALENESS_THRESHOLD_HOURS = 72;

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
    `ℹ️ Aucun signal généré depuis plus de ${STALENESS_THRESHOLD_HOURS}h, ` +
      "alors que le générateur tourne normalement (heartbeat à jour, sources de données OK).\n\n" +
      "Cause attendue en premier lieu : le filtre de tendance est fermé (Bitcoin sous sa moyenne 200 jours), " +
      "auquel cas il n'y a RIEN à corriger — c'est le comportement prévu, 41 % du temps. " +
      "À ne creuser (seuils, classement, univers) que si le filtre est ouvert."
  );
  await markNoSignalAlerted(db, JOB_NAME, true);
}
