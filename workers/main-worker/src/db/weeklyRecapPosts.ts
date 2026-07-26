import { SupabaseConfig, selectRows, insertRow } from "../supabaseRest";

interface WeeklyRecapPostRecord {
  id: number;
  posted_at: string;
}

/** Gate "un récap par semaine" : un récap a-t-il déjà été publié dans les 6 derniers jours ? */
export async function hasPostedWeeklyRecapRecently(db: SupabaseConfig): Promise<boolean> {
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await selectRows<WeeklyRecapPostRecord>(db, "weekly_recap_posts", {
    posted_at: `gte.${sixDaysAgo}`,
    limit: "1",
  });
  return rows.length > 0;
}

export async function recordWeeklyRecapPost(db: SupabaseConfig): Promise<void> {
  await insertRow(db, "weekly_recap_posts", {});
}
