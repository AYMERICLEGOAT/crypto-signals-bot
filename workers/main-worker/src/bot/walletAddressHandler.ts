import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { consumePendingAction, setPendingAction } from "../db/pendingActions";
import { startUsdtPayment } from "../payments/usdt";
import { activateTrialForWallet } from "./commands/trial";
import { isValidEthereumAddress } from "../utils/address";

/**
 * Catch-all texte libre : ne fait quelque chose que si on attend une adresse
 * wallet de cet utilisateur (cf. db/pendingActions.ts). Sinon, ignore
 * silencieusement (évite de répondre n'importe quoi à une conversation normale).
 */
export async function handleTextMessage(env: Env, telegramId: number, text: string): Promise<void> {
  const db = dbConfig(env);
  const action = await consumePendingAction(db, telegramId);
  if (!action) return;

  const trimmed = text.trim();
  if (!isValidEthereumAddress(trimmed)) {
    await setPendingAction(db, telegramId, action); // on laisse une nouvelle chance de saisir une adresse valide
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Adresse invalide. Renvoie une adresse Polygon au format 0x... (42 caractères).");
    return;
  }

  if (action.type === "awaiting_wallet_usdt") {
    const message = await startUsdtPayment(env, db, telegramId, action.plan, trimmed);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, message, { markdown: true });
  } else if (action.type === "awaiting_wallet_trial") {
    await activateTrialForWallet(env, telegramId, trimmed);
  }
}
