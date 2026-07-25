import { SupabaseConfig, selectRows, insertRow } from "../supabaseRest";

/** Gate "un post par semaine" (Bloc 6) — même principe que db/luckyVip.ts pour le tirage quotidien. */
export async function hasPostedLeaderboardThisWeek(db: SupabaseConfig): Promise<boolean> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await selectRows(db, "leaderboard_posts", { posted_at: `gte.${since}`, limit: "1" });
  return rows.length > 0;
}

export async function recordLeaderboardPost(db: SupabaseConfig): Promise<void> {
  await insertRow(db, "leaderboard_posts", {});
}
