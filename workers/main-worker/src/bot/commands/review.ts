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

  // La NOTE est déjà enregistrée à ce stade : c'est l'essentiel, et le
  // commentaire libre qui suit n'est qu'un bonus optionnel. Armer son
  // attente ne doit donc jamais faire échouer l'ensemble.
  //
  // Bug trouvé en test réel le 01/08/2026 : la contrainte CHECK de
  // pending_actions n'autorisait que 'awaiting_wallet_usdt' et
  // 'awaiting_wallet_trial' (voir init.sql section 45), alors que ce flux y
  // écrit 'awaiting_review_comment'. L'insertion partait donc en erreur 23514,
  // l'exception remontait, le remerciement n'était jamais envoyé et
  // l'utilisateur recevait « Une erreur temporaire est survenue » — alors que
  // sa note venait bel et bien d'être enregistrée. Une fonctionnalité censée
  // bâtir la crédibilité paraissait cassée à chaque utilisation.
  let commentPromptAvailable = true;
  try {
    await setPendingAction(db, telegramId, { type: "awaiting_review_comment", reviewId });
  } catch (err) {
    commentPromptAvailable = false;
    console.error("[review] Attente de commentaire indisponible (note bien enregistrée):", err);
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    commentPromptAvailable
      ? "Merci pour ta note ! Tu peux répondre à ce message avec un commentaire (anonyme, optionnel) — sinon ignore-le simplement, c'est déjà enregistré."
      : "Merci pour ta note, elle est bien enregistrée 🙏"
  );
}

/** Appelé par walletAddressHandler.ts quand un commentaire de review est attendu. */
export async function handleReviewComment(env: Env, telegramId: number, reviewId: number, comment: string): Promise<void> {
  const db = dbConfig(env);
  await attachReviewComment(db, reviewId, comment.slice(0, 500));
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Merci, ton commentaire a bien été ajouté 🙏");
}
