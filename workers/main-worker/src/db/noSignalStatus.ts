import { SupabaseConfig, selectRows, insertRow } from "../supabaseRest";

/** Gate "un post par jour" (Bloc 9), même principe que db/luckyVip.ts pour le tirage quotidien. */
export async function hasPostedNoSignalStatusToday(db: SupabaseConfig): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await selectRows(db, "no_signal_status_posts", { posted_at: `gte.${startOfDay.toISOString()}`, limit: "1" });
  return rows.length > 0;
}

export async function recordNoSignalStatusPost(db: SupabaseConfig): Promise<void> {
  await insertRow(db, "no_signal_status_posts", {});
}
