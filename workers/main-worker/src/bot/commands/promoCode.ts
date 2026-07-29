import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { selectOne, updateRows } from "../../supabaseRest";
import { activeAndNotExpiredFilter } from "../../payments/promoCodes";

interface PromoCode {
  code: string;
  discount_pct: number;
  active: boolean;
}

/** /code XXXX : active un code promo pour le PROCHAIN paiement (voir payments/promoCodes.ts). */
export async function handlePromoCodeCommand(env: Env, telegramId: number, rawCode: string): Promise<void> {
  const db = dbConfig(env);
  const code = rawCode.trim().toUpperCase();

  if (!code) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Utilisation : /code TONCODE");
    return;
  }

  const promo = await selectOne<PromoCode>(db, "promo_codes", activeAndNotExpiredFilter(code));
  if (!promo) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Code invalide ou expiré.");
    return;
  }

  const alreadyUsed = await selectOne(db, "promo_code_redemptions", { code: `eq.${code}`, telegram_id: `eq.${telegramId}` });
  if (alreadyUsed) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Tu as déjà utilisé ce code.");
    return;
  }

  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { pending_promo_code: code });
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `✅ Code *${code}* appliqué (-${promo.discount_pct}%). Utilise /subscribe pour en profiter sur ton prochain paiement.`,
    { markdown: true }
  );
}
