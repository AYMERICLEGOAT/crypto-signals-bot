import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { recordAdminNote } from "../../db/adminNotes";

/**
 * /opsnote <texte> — réservé à ADMIN_TELEGRAM_ID. Point d'entrée pour
 * répondre à la routine autonome quotidienne (OPS_ROUTINE_PROMPT.md) ou
 * lui laisser une instruction/décision à prendre en compte à son prochain
 * run — elle ne tourne qu'une fois par jour, ne peut pas tenir une
 * conversation en direct.
 */
export async function handleOpsNoteCommand(env: Env, telegramId: number, note: string): Promise<void> {
  if (!env.ADMIN_TELEGRAM_ID || String(telegramId) !== env.ADMIN_TELEGRAM_ID) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Commande réservée à l'administrateur.");
    return;
  }

  if (!note) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Usage : /opsnote <ton message pour la routine>");
    return;
  }

  const db = dbConfig(env);
  await recordAdminNote(db, note);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "📝 Noté — la routine en tiendra compte à son prochain passage.");
}
