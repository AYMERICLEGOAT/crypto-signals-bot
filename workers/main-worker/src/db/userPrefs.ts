import { SupabaseConfig, selectOne, selectRows, upsertRow } from "../supabaseRest";

export interface UserPrefsRow {
  telegram_id: number;
  momentum_alerts: boolean;
  educational_posts: boolean;
  weekly_recap: boolean;
}

const DEFAULT_PREFS = { momentum_alerts: true, educational_posts: true, weekly_recap: true };

/** Toujours une valeur (défauts si l'utilisateur n'a jamais touché à /prefs — pas de ligne = tout activé). */
export async function getUserPrefs(db: SupabaseConfig, telegramId: number): Promise<UserPrefsRow> {
  const row = await selectOne<UserPrefsRow>(db, "user_prefs", { telegram_id: `eq.${telegramId}` });
  return row ?? { telegram_id: telegramId, ...DEFAULT_PREFS };
}

export async function setUserPref(db: SupabaseConfig, telegramId: number, key: keyof typeof DEFAULT_PREFS, value: boolean): Promise<void> {
  const current = await getUserPrefs(db, telegramId);
  await upsertRow(db, "user_prefs", { ...current, [key]: value }, "telegram_id");
}

/**
 * Sous-ensemble de `telegramIds` n'ayant PAS désactivé `key` (par défaut :
 * tout le monde, tant qu'aucune ligne user_prefs n'existe pour eux).
 */
export async function filterByPref(db: SupabaseConfig, telegramIds: number[], key: keyof typeof DEFAULT_PREFS): Promise<number[]> {
  if (telegramIds.length === 0) return [];
  const rows = await selectRows<UserPrefsRow>(db, "user_prefs", { telegram_id: `in.(${telegramIds.join(",")})` });
  const disabled = new Set(rows.filter((r) => r[key] === false).map((r) => r.telegram_id));
  return telegramIds.filter((id) => !disabled.has(id));
}
