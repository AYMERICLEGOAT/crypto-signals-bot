/**
 * Client minimal pour l'API Telegram Bot, basé uniquement sur `fetch`
 * (pas de Telegraf : sur Workers, le bot fonctionne en webhook, pas en
 * long polling, et un client fetch direct est plus simple et plus fiable
 * dans ce runtime que d'adapter une lib pensée pour Node).
 */

const API_BASE = "https://api.telegram.org/bot";
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Un bouton porte SOIT un `callback_data`, SOIT une `url` — jamais les deux, et
 * jamais aucun des deux : Telegram rejette le message entier dans ces deux cas.
 *
 * L'`url` a été ajoutée pour le canal PUBLIC. Un bouton `callback_data` y est
 * inutilisable en pratique : le lecteur du canal n'a souvent jamais ouvert de
 * conversation privée avec le bot, et un callback ne peut pas en démarrer une.
 * Un lien `https://t.me/<bot>?start=<charge>` ouvre le bot, crée la
 * conversation, et transmet la charge utile — c'est le seul mécanisme qui
 * amène un lecteur anonyme jusqu'au produit.
 */
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
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

/**
 * Limite Telegram d'une légende de photo. Un message normal accepte 4096
 * caractères ; une légende s'arrête à 1024, et l'API répond 400
 * « message caption is too long » au-delà — elle ne tronque pas, elle REFUSE.
 */
export const CAPTION_MAX = 1024;

/**
 * Un graphique ACCOMPAGNÉ d'un texte, quelle que soit la longueur du texte.
 *
 * CE QUE CE HELPER CORRIGE, ET POURQUOI IL EST CENTRAL.
 *
 * Un message de signal complet fait environ 1400 caractères. Envoyé en légende
 * de photo, il dépassait la limite et Telegram refusait TOUT le message. Le
 * défaut existait dans trois chemins distincts, écrits séparément :
 *
 *   dispatchSignals      — les abonnés payants. Le plus grave : l'échec était
 *                          attrapé par destinataire, la liste des livraisons
 *                          restait vide, et le signal était quand même marqué
 *                          « envoyé ». Les quatre signaux des 09 et 10/08 ont
 *                          ainsi été comptés comme diffusés alors que PERSONNE
 *                          ne les avait reçus.
 *   dispatchStandardTier — même code, même issue.
 *   dispatchPublicChannel — corrigé sur place le 09/08, avant de comprendre
 *                          que les deux autres avaient le même défaut.
 *
 * Un correctif recopié dans trois fichiers en aurait manqué un quatrième le
 * jour où un nouveau diffuseur apparaît. La règle vit donc ici, au seul endroit
 * qui connaisse la limite.
 *
 * Au-delà de la limite : la photo part avec une légende courte, puis le texte
 * entier suit en message séparé. Les deux arrivent, dans l'ordre, rien n'est
 * tronqué — et surtout, plus rien n'est perdu en silence.
 */
export async function sendPhotoWithText(
  token: string,
  chatId: number,
  photoUrl: string,
  text: string,
  options: { markdown?: boolean; legendeCourte?: string } = {}
): Promise<void> {
  if (text.length <= CAPTION_MAX) {
    await sendPhoto(token, chatId, photoUrl, { caption: text, markdown: options.markdown });
    return;
  }
  // Légende courte SANS parse_mode : elle est construite ici, pas par
  // l'appelant, donc elle ne peut pas contenir de Markdown mal apparié.
  await sendPhoto(token, chatId, photoUrl, { caption: options.legendeCourte ?? "📈 Le détail complet juste en dessous." });
  await sendMessage(token, chatId, text, { markdown: options.markdown });
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

/**
 * Retire quelqu'un d'un canal, sans le bannir durablement.
 *
 * Telegram n'a pas d'« expulser » : la seule façon de faire sortir un membre
 * est `banChatMember`, qui l'empêche AUSSI de revenir. On le débannit donc
 * immédiatement après (`only_if_banned`), ce qui laisse la porte ouverte à un
 * futur réabonnement. Sans ce second appel, un ancien abonné qui repaie ne
 * pourrait plus jamais rentrer, et personne ne comprendrait pourquoi.
 *
 * Rend true si la personne a bien été retirée. Un échec n'est jamais fatal pour
 * l'appelant : Telegram refuse notamment de retirer un administrateur, et un
 * membre déjà parti renvoie une erreur qu'il faut simplement ignorer.
 */
export async function removeChatMember(token: string, chatId: string | number, userId: number): Promise<boolean> {
  try {
    await callTelegramApi(token, "banChatMember", { chat_id: chatId, user_id: userId });
  } catch (err) {
    console.error(`[telegram] Retrait impossible de ${userId} du canal ${chatId}:`, err);
    return false;
  }
  // Le débannissement est volontairement silencieux : s'il échoue, la personne
  // est sortie (l'essentiel) et pourra être débannie à la main si elle repaie.
  await callTelegramApi(token, "unbanChatMember", {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true,
  }).catch((err) => console.error(`[telegram] Débannissement de ${userId} impossible:`, err));
  return true;
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
