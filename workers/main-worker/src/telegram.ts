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

export async function pinChatMessage(token: string, chatId: number, messageId: number): Promise<void> {
  await callTelegramApi(token, "pinChatMessage", { chat_id: chatId, message_id: messageId, disable_notification: true });
}

/** Comme sendMessage, mais retourne le message_id envoyé (nécessaire pour pinChatMessage) -- ne gère pas le découpage multi-message, réservé aux messages courts (ex: message épinglé du canal). */
export async function sendMessageAndGetId(token: string, chatId: number, text: string): Promise<number> {
  const res = await fetch(`${API_BASE}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const json = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
  if (!json.ok || !json.result) {
    throw new Error(`Telegram API sendMessage a échoué: ${json.description ?? "réponse invalide"}`);
  }
  return json.result.message_id;
}

export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  await callTelegramApi(token, "setWebhook", { url, secret_token: secretToken });
}

/**
 * Statut d'un utilisateur dans un chat (ex: le canal public), pour la
 * boucle virale du /trial. Retourne null si l'utilisateur n'a jamais
 * interagi avec le chat (Telegram répond "ok: false" dans ce cas précis —
 * ce n'est pas une erreur, juste "pas membre").
 */
export async function getChatMemberStatus(token: string, chatId: string | number, userId: number): Promise<string | null> {
  const res = await fetch(
    `${API_BASE}${token}/getChatMember?chat_id=${encodeURIComponent(String(chatId))}&user_id=${userId}`
  );
  const json = (await res.json()) as { ok: boolean; result?: { status: string } };
  return json.ok ? json.result?.status ?? null : null;
}

/** Canal VIP (abonnés payants) : le bot doit être admin du chat avec le droit "inviter des utilisateurs". */
export async function createChatInviteLink(token: string, chatId: string | number, name?: string): Promise<string> {
  const res = await fetch(`${API_BASE}${token}/createChatInviteLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, name }),
  });
  const json = (await res.json()) as { ok: boolean; result?: { invite_link: string }; description?: string };
  if (!json.ok || !json.result) {
    throw new Error(`Telegram API createChatInviteLink a échoué: ${json.description ?? "réponse invalide"}`);
  }
  return json.result.invite_link;
}

export async function revokeChatInviteLink(token: string, chatId: string | number, inviteLink: string): Promise<void> {
  await callTelegramApi(token, "revokeChatInviteLink", { chat_id: chatId, invite_link: inviteLink });
}
