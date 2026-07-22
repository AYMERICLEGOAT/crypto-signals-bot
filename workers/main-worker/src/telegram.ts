/**
 * Client minimal pour l'API Telegram Bot, basé uniquement sur `fetch`
 * (pas de Telegraf : sur Workers, le bot fonctionne en webhook, pas en
 * long polling, et un client fetch direct est plus simple et plus fiable
 * dans ce runtime que d'adapter une lib pensée pour Node).
 */

const API_BASE = "https://api.telegram.org/bot";
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineKeyboardButton[][];

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}
export interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number };
  text?: string;
}
export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from: { id: number };
  message?: { chat: { id: number } };
}

async function callTelegramApi(token: string, method: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${method} a répondu ${res.status}: ${body}`);
  }
}

/** Découpe un message trop long en plusieurs morceaux valides pour l'API Telegram. */
export function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  options: { markdown?: boolean; keyboard?: InlineKeyboard } = {}
): Promise<void> {
  for (const chunk of splitMessage(text)) {
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: options.markdown ? "Markdown" : undefined,
      reply_markup: options.keyboard ? { inline_keyboard: options.keyboard } : undefined,
    });
  }
}

/** photo : une URL HTTP (ex: image hébergée sur Supabase Storage) — Telegram la récupère lui-même. */
export async function sendPhoto(
  token: string,
  chatId: number,
  photoUrl: string,
  options: { caption?: string; markdown?: boolean } = {}
): Promise<void> {
  await callTelegramApi(token, "sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: options.caption,
    parse_mode: options.markdown ? "Markdown" : undefined,
  });
}

export async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await callTelegramApi(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  await callTelegramApi(token, "setWebhook", { url, secret_token: secretToken });
}
