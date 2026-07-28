/**
 * Remplace la Map en mémoire utilisée dans la version Node du bot (module 2) :
 * un Worker est sans état entre deux requêtes (pas de long polling, isolats
 * recyclés à tout moment), donc "qu'est-ce qu'on attend de cet utilisateur"
 * doit être persisté quelque part — ici, une table Supabase dédiée.
 */

import { SupabaseConfig, selectOne, upsertRow, deleteRows } from "../supabaseRest";
import { PaidPlan } from "../payments/plans";

export type PendingAction =
  | { type: "awaiting_wallet_usdt"; plan: PaidPlan }
  | { type: "awaiting_wallet_trial" }
  | { type: "awaiting_review_comment"; reviewId: number };

interface PendingActionRow {
  telegram_id: number;
  action_type: string;
  plan: number | null;
  review_id: number | null;
}

export async function setPendingAction(db: SupabaseConfig, telegramId: number, action: PendingAction): Promise<void> {
  await upsertRow(
    db,
    "pending_actions",
    {
      telegram_id: telegramId,
      action_type: action.type,
      plan: action.type === "awaiting_wallet_usdt" ? action.plan : null,
      review_id: action.type === "awaiting_review_comment" ? action.reviewId : null,
    },
    "telegram_id"
  );
}

export async function consumePendingAction(db: SupabaseConfig, telegramId: number): Promise<PendingAction | null> {
  const row = await selectOne<PendingActionRow>(db, "pending_actions", { telegram_id: `eq.${telegramId}` });
  if (!row) return null;
  await deleteRows(db, "pending_actions", { telegram_id: `eq.${telegramId}` });

  if (row.action_type === "awaiting_wallet_usdt") {
    return { type: "awaiting_wallet_usdt", plan: (row.plan as 1 | 2) ?? 1 };
  }
  if (row.action_type === "awaiting_review_comment" && row.review_id != null) {
    return { type: "awaiting_review_comment", reviewId: row.review_id };
  }
  return { type: "awaiting_wallet_trial" };
}
