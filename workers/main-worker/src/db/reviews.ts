import { SupabaseConfig, insertRow, updateRows, selectRows } from "../supabaseRest";

export interface ReviewRow {
  id: number;
  telegram_id: number;
  rating: "up" | "down";
  comment: string | null;
  created_at: string;
}

/** Insère la note immédiatement (le commentaire, optionnel, arrive potentiellement plus tard). */
export async function insertReview(db: SupabaseConfig, telegramId: number, rating: "up" | "down"): Promise<number> {
  const row = await insertRow<ReviewRow>(db, "reviews", { telegram_id: telegramId, rating });
  return row.id;
}

export async function attachReviewComment(db: SupabaseConfig, reviewId: number, comment: string): Promise<void> {
  await updateRows(db, "reviews", { id: `eq.${reviewId}` }, { comment });
}

/** Derniers avis pour la page témoignages du site — jamais le telegram_id (anonymisé). */
export async function getRecentReviews(db: SupabaseConfig, limit = 20): Promise<Array<Pick<ReviewRow, "rating" | "comment" | "created_at">>> {
  return selectRows(db, "reviews", {
    select: "rating,comment,created_at",
    order: "created_at.desc",
    limit: String(limit),
  });
}
