import { SupabaseConfig, insertRow } from "../supabaseRest";

/** Journal des actions admin (Bloc 5) — traçabilité des interventions manuelles (ex: /admin_activate). */
export async function logAdminAction(
  db: SupabaseConfig,
  adminTelegramId: number,
  action: string,
  targetTelegramId: number | null,
  details: string | null
): Promise<void> {
  await insertRow(db, "admin_actions", {
    admin_telegram_id: adminTelegramId,
    action,
    target_telegram_id: targetTelegramId,
    details,
  });
}
