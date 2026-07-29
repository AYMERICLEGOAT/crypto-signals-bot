import { SupabaseConfig, selectOne, updateRows } from "../supabaseRest";

export interface HeartbeatRow {
  job_name: string;
  last_run_at: string;
  alerted: boolean;
  /** Audit#30 -- voir cron/checkSignalFreshness.ts. Indépendant de `alerted` (job pas relancé) : ici le job tourne, mais ne produit aucun signal depuis trop longtemps. */
  no_signal_alerted?: boolean;
}

/** Écrit par signals/storage.py::record_heartbeat à chaque exécution réussie de signals/main.py. */
export async function getHeartbeat(db: SupabaseConfig, jobName: string): Promise<HeartbeatRow | null> {
  return selectOne<HeartbeatRow>(db, "system_heartbeats", { job_name: `eq.${jobName}` });
}

export async function markHeartbeatAlerted(db: SupabaseConfig, jobName: string): Promise<void> {
  await updateRows(db, "system_heartbeats", { job_name: `eq.${jobName}` }, { alerted: true });
}

export async function markNoSignalAlerted(db: SupabaseConfig, jobName: string, alerted: boolean): Promise<void> {
  await updateRows(db, "system_heartbeats", { job_name: `eq.${jobName}` }, { no_signal_alerted: alerted });
}
