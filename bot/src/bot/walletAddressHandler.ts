import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { ethers } from "ethers";
import { consumePendingAction, setPendingAction } from "./state";
import { startUsdtPayment } from "../payments/usdt";
import { activateTrialForWallet } from "./commands/trial";

/**
 * Catch-all texte libre : ne fait quelque chose que si on attend une adresse
 * wallet de cet utilisateur (cf. state.ts). Sinon, ignore silencieusement
 * (évite de répondre n'importe quoi à une conversation normale).
 */
export async function handleTextMessage(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const telegramId = ctx.from.id;
  const action = consumePendingAction(telegramId);
  if (!action) return;

  const text = (ctx.message as Message.TextMessage | undefined)?.text?.trim();

  if (!text || !ethers.isAddress(text)) {
    setPendingAction(telegramId, action); // on laisse une nouvelle chance de saisir une adresse valide
    await ctx.reply("Adresse invalide. Renvoie une adresse Polygon au format 0x... (42 caractères).");
    return;
  }

  if (action.type === "awaiting_wallet_usdt") {
    const message = await startUsdtPayment(telegramId, action.plan, text);
    await ctx.replyWithMarkdown(message);
  } else if (action.type === "awaiting_wallet_trial") {
    await activateTrialForWallet(ctx, telegramId, text);
  }
}
