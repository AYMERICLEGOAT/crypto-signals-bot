import { SupabaseConfig, callRpc } from "../supabaseRest";

const WINDOW_MS = 60_000;
const MAX_COMMANDS_PER_WINDOW = 10;

/**
 * Anti-abus générique (Bloc 5.3) : au plus MAX_COMMANDS_PER_WINDOW
 * interactions (messages ou clics de bouton) par fenêtre glissante de
 * WINDOW_MS par utilisateur. Retourne true si CETTE requête doit être
 * bloquée. Fenêtre expirée -> réinitialisée silencieusement (pas de
 * "carry-over" punitif d'une fenêtre à l'autre).
 */
export async function isRateLimited(db: SupabaseConfig, telegramId: number): Promise<boolean> {
  const result = await callRpc<{ allowed: boolean }[]>(db, "consume_command_rate_limit", {
    p_telegram_id: telegramId,
    p_window_ms: WINDOW_MS,
    p_max_commands: MAX_COMMANDS_PER_WINDOW,
  });
  return result[0]?.allowed !== true;
}
