import { SupabaseConfig, selectOne, updateRows } from "../supabaseRest";

export interface HeartbeatRow {
  job_name: string;
  last_run_at: string;
  alerted: boolean;
}

/** Écrit par signals/storage.py::record_heartbeat à chaque exécution réussie de signals/main.py. */
export async function getHeartbeat(db: SupabaseConfig, jobName: string): Promise<HeartbeatRow | null> {
  return selectOne<HeartbeatRow>(db, "system_heartbeats", { job_name: `eq.${jobName}` });
}

export async function markHeartbeatAlerted(db: SupabaseConfig, jobName: string): Promise<void> {
  await updateRows(db, "system_heartbeats", { job_name: `eq.${jobName}` }, { alerted: true });
}
