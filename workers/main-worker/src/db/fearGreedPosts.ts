import { SupabaseConfig, selectRows, insertRow } from "../supabaseRest";

export interface FearGreedPostRecord {
  id: number;
  value: number;
  classification: string;
  posted_at: string;
}

/** Gate "une publication par jour" : a-t-on déjà publié l'indice aujourd'hui (UTC) ? */
export async function hasPostedFearGreedToday(db: SupabaseConfig): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await selectRows<FearGreedPostRecord>(db, "fear_greed_posts", {
    posted_at: `gte.${startOfDay.toISOString()}`,
    limit: "1",
  });
  return rows.length > 0;
}

export async function recordFearGreedPost(db: SupabaseConfig, value: number, classification: string): Promise<void> {
  await insertRow(db, "fear_greed_posts", { value, classification });
}
