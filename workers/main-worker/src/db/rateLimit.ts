import { SupabaseConfig, selectOne, upsertRow } from "../supabaseRest";

const WINDOW_MS = 60_000;
const MAX_COMMANDS_PER_WINDOW = 10;

interface RateLimitRow {
  telegram_id: number;
  window_start: string;
  count: number;
}

/**
 * Anti-abus générique (Bloc 5.3) : au plus MAX_COMMANDS_PER_WINDOW
 * interactions (messages ou clics de bouton) par fenêtre glissante de
 * WINDOW_MS par utilisateur. Retourne true si CETTE requête doit être
 * bloquée. Fenêtre expirée -> réinitialisée silencieusement (pas de
 * "carry-over" punitif d'une fenêtre à l'autre).
 */
export async function isRateLimited(db: SupabaseConfig, telegramId: number): Promise<boolean> {
  const row = await selectOne<RateLimitRow>(db, "command_rate_limit", { telegram_id: `eq.${telegramId}` });
  const now = new Date();

  if (!row || now.getTime() - new Date(row.window_start).getTime() > WINDOW_MS) {
    await upsertRow(db, "command_rate_limit", { telegram_id: telegramId, window_start: now.toISOString(), count: 1 }, "telegram_id");
    return false;
  }

  if (row.count >= MAX_COMMANDS_PER_WINDOW) {
    return true;
  }

  await upsertRow(db, "command_rate_limit", { telegram_id: telegramId, window_start: row.window_start, count: row.count + 1 }, "telegram_id");
  return false;
}
