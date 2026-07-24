import { SupabaseConfig, selectRows, updateRows } from "../supabaseRest";

export interface EducationalPost {
  id: number;
  content: string;
  category: string | null;
  last_sent_at: string | null;
}

/** Le post jamais envoyé (last_sent_at IS NULL) le plus ancien par id, sinon le moins récemment envoyé — rotation complète avant répétition. */
export async function getNextEducationalPost(db: SupabaseConfig): Promise<EducationalPost | null> {
  const rows = await selectRows<EducationalPost>(db, "educational_posts", {
    order: "last_sent_at.asc.nullsfirst,id.asc",
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function markEducationalPostSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "educational_posts", { id: `eq.${id}` }, { last_sent_at: new Date().toISOString() });
}

/** Gate "un post par jour" : a-t-on déjà envoyé un post éducatif aujourd'hui (UTC) ? */
export async function hasSentEducationalPostToday(db: SupabaseConfig): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await selectRows<EducationalPost>(db, "educational_posts", {
    last_sent_at: `gte.${startOfDay.toISOString()}`,
    limit: "1",
  });
  return rows.length > 0;
}
