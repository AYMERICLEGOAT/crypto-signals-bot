import { SupabaseConfig, insertRow } from "../supabaseRest";

/**
 * Canal d'échange asynchrone avec la routine autonome quotidienne
 * (OPS_ROUTINE_PROMPT.md, tourne en local une fois par jour, non
 * interactive) : /opsnote enregistre un message de l'admin ici, et la
 * routine le lit à son prochain run pour en tenir compte.
 */
export async function recordAdminNote(db: SupabaseConfig, message: string): Promise<void> {
  await insertRow(db, "admin_notes", { sender: "admin", message });
}
