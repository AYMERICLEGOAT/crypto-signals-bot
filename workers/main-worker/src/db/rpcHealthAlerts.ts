import { SupabaseConfig, selectOne, upsertRow } from "../supabaseRest";

/**
 * Anti-spam pour les alertes de bascule RPC (Bloc 15.1) : sans ça, un cron
 * toutes les 5 minutes envoie une alerte identique à chaque cycle tant que
 * le noeud principal reste en panne (observé en production : 7+ alertes
 * identiques en 30 minutes). Réutilise le même mécanisme que
 * system_heartbeats (job_name/last_run_at/alerted) plutôt qu'une nouvelle
 * table, mais avec une sémantique différente : ici, `alerted` n'est jamais
 * remis à false explicitement au retour à la normale (pas de write sur le
 * chemin sain, qui est appelé beaucoup plus souvent) -- une nouvelle alerte
 * n'est renvoyée que si la précédente date de plus de RE_ALERT_COOLDOWN_MS,
 * ce qui la fait naturellement expirer et laisse une future panne réelle
 * re-déclencher une alerte, sans jamais avoir besoin d'écrire quoi que ce
 * soit lors d'un appel RPC réussi.
 */
const JOB_NAME = "polygon_rpc_fallback";
const RE_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1h : un rappel espacé si la panne dure, jamais un spam à chaque cycle de 5 min

interface HeartbeatRow {
  job_name: string;
  last_run_at: string;
  alerted: boolean;
}

/** true si une alerte de bascule RPC doit être envoyée maintenant (aucune récente, ou la précédente a expiré). */
export async function shouldAlertRpcFallback(db: SupabaseConfig): Promise<boolean> {
  const row = await selectOne<HeartbeatRow>(db, "system_heartbeats", { job_name: `eq.${JOB_NAME}` });
  if (!row || !row.alerted) return true;
  const ageMs = Date.now() - new Date(row.last_run_at).getTime();
  return ageMs > RE_ALERT_COOLDOWN_MS;
}

export async function recordRpcFallbackAlert(db: SupabaseConfig): Promise<void> {
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: true }, "job_name");
}
