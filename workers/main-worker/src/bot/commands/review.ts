import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { insertReview, attachReviewComment } from "../../db/reviews";
import { setPendingAction } from "../../db/pendingActions";

/** /review (Étape 3, preuve sociale) — note rapide 👍/👎, commentaire optionnel en réponse libre juste après. */
export async function handleReviewCommand(env: Env, telegramId: number): Promise<void> {
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Comment trouves-tu le bot jusqu'ici ?", {
    keyboard: [
      [
        { text: "👍 J'aime", callback_data: "review:up" },
        { text: "👎 Je n'aime pas", callback_data: "review:down" },
      ],
    ],
  });
}

/** data au format "review:up" ou "review:down". */
export async function handleReviewRating(env: Env, telegramId: number, data: string): Promise<void> {
  const rating = data === "review:up" ? "up" : data === "review:down" ? "down" : null;
  if (!rating) return;

  const db = dbConfig(env);
  const reviewId = await insertReview(db, telegramId, rating);
  await setPendingAction(db, telegramId, { type: "awaiting_review_comment", reviewId });

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "Merci pour ta note ! Tu peux répondre à ce message avec un commentaire (anonyme, optionnel) — sinon ignore-le simplement, c'est déjà enregistré."
  );
}

/** Appelé par walletAddressHandler.ts quand un commentaire de review est attendu. */
export async function handleReviewComment(env: Env, telegramId: number, reviewId: number, comment: string): Promise<void> {
  const db = dbConfig(env);
  await attachReviewComment(db, reviewId, comment.slice(0, 500));
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Merci, ton commentaire a bien été ajouté 🙏");
}
