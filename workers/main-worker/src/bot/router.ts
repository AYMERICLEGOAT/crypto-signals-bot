import { Env } from "../env";
import { TelegramUpdate, answerCallbackQuery } from "../telegram";
import { handleStart } from "./commands/start";
import { handleStatusCommand } from "./commands/status";
import { handleTrialCommand } from "./commands/trial";
import { handleSubscribeCommand, handlePlanSelection, handlePaymentMethodSelection } from "./commands/subscribe";
import { handlePayCommand } from "./commands/pay";
import { handleReferralCommand } from "./commands/referral";
import { handlePromoCodeCommand } from "./commands/promoCode";
import { handleStatsCommand } from "./commands/stats";
import { handleTextMessage } from "./walletAddressHandler";

/** Traite une Update Telegram reçue par le webhook (voir index.ts, fetch()). */
export async function routeUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = (update.message.text ?? "").trim();

    if (text === "/start" || text.startsWith("/start ")) {
      const referralPayload = text.startsWith("/start ") ? text.slice("/start ".length).trim() : undefined;
      await handleStart(env, chatId, referralPayload || undefined);
    } else if (text === "/subscribe") {
      await handleSubscribeCommand(env, chatId);
    } else if (text === "/status") {
      await handleStatusCommand(env, chatId);
    } else if (text === "/trial") {
      await handleTrialCommand(env, chatId);
    } else if (text === "/pay") {
      await handlePayCommand(env, chatId);
    } else if (text === "/referral") {
      await handleReferralCommand(env, chatId);
    } else if (text === "/code" || text.startsWith("/code ")) {
      await handlePromoCodeCommand(env, chatId, text.slice("/code".length).trim());
    } else if (text === "/stats") {
      await handleStatsCommand(env, chatId);
    } else if (text && !text.startsWith("/")) {
      await handleTextMessage(env, chatId, text);
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const data = cq.data ?? "";

    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cq.id);

    if (data === "start:subscribe") await handleSubscribeCommand(env, chatId);
    else if (data === "start:trial") await handleTrialCommand(env, chatId);
    else if (data === "start:status") await handleStatusCommand(env, chatId);
    else if (data.startsWith("plan:")) await handlePlanSelection(env, chatId, data);
    else if (data.startsWith("pay:")) await handlePaymentMethodSelection(env, chatId, data);
  }
}
