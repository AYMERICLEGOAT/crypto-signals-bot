import { Env, dbConfig } from "../env";
import { sendMessage, sendPhoto } from "../telegram";
import { consumePendingAction, setPendingAction } from "../db/pendingActions";
import { startUsdtPayment } from "../payments/usdt";
import { activateTrialForWallet } from "./commands/trial";
import { handleReviewComment } from "./commands/review";
import { isValidEthereumAddress } from "../utils/address";

/**
 * Catch-all texte libre : ne fait quelque chose que si on attend une adresse
 * wallet ou un commentaire de review de cet utilisateur (cf.
 * db/pendingActions.ts). Sinon, ignore silencieusement (évite de répondre
 * n'importe quoi à une conversation normale).
 */
export async function handleTextMessage(env: Env, telegramId: number, text: string): Promise<void> {
  const db = dbConfig(env);
  const action = await consumePendingAction(db, telegramId);

  // UN TEXTE LIBRE NE DOIT PAS TOMBER DANS LE SILENCE.
  //
  // Sans action en attente, cette fonction rendait la main sans rien envoyer.
  // Or c'est le cas le plus fréquent chez quelqu'un qui découvre le bot : il
  // écrit « bonjour », « ça marche ? », « c'est quoi ce truc » — et ne reçoit
  // RIEN. Il en conclut que le service est mort, au premier contact.
  //
  // Le projet avait déjà corrigé ce silence pour les commandes mal orthographiées
  // (voir bot/router.ts), mais pas pour le texte ordinaire, qui est pourtant ce
  // qu'une personne tape spontanément avant de connaître la moindre commande.
  //
  // Réponse courte et sans reproche : on ne sait pas répondre à du texte libre,
  // et on montre les trois portes d'entrée. Aucune ne demande de payer.
  if (!action) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Je ne comprends que des commandes — je ne sais pas discuter.\n\n" +
        "Pour commencer :\n" +
        "/demo — un vrai signal, en entier\n" +
        "/marche — l'état du marché, recalculé maintenant\n" +
        "/trial — l'essai gratuit de 3 jours\n\n" +
        "/help liste tout le reste."
    );
    return;
  }

  if (action.type === "awaiting_review_comment") {
    await handleReviewComment(env, telegramId, action.reviewId, text.trim());
    return;
  }

  const trimmed = text.trim();
  if (!isValidEthereumAddress(trimmed)) {
    await setPendingAction(db, telegramId, action); // on laisse une nouvelle chance de saisir une adresse valide
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Adresse invalide. Renvoie une adresse Polygon au format 0x... (42 caractères).");
    return;
  }

  if (action.type === "awaiting_wallet_usdt") {
    const message = await startUsdtPayment(env, db, telegramId, action.plan, trimmed);
    if (env.PAYMENT_GUIDE_IMAGE_URL) {
      await sendPhoto(env.TELEGRAM_BOT_TOKEN, telegramId, env.PAYMENT_GUIDE_IMAGE_URL);
    }
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, message, { markdown: true });
  } else if (action.type === "awaiting_wallet_trial") {
    await activateTrialForWallet(env, telegramId, trimmed);
  }
}
