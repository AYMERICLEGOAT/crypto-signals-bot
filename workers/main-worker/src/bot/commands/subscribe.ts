import { Env, dbConfig } from "../../env";
import { sendMessage, sendPhoto } from "../../telegram";
import { startUsdtPayment, USDT_PLAN_PRICES } from "../../payments/usdt";
import { createMoneroInvoice } from "../../payments/monero";
import { createLitecoinInvoice } from "../../payments/litecoin";
import { getEffectivePriceUsd } from "../../payments/promoCodes";
import { createPendingPayment } from "../../db/payments";
import { setPendingAction } from "../../db/pendingActions";
import { planKeyboard, paymentMethodKeyboard } from "../keyboards";

export async function handleSubscribeCommand(env: Env, telegramId: number): Promise<void> {
  const [price1, price2] = [USDT_PLAN_PRICES[1], USDT_PLAN_PRICES[2]];
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `📅 *Nos offres*\n\nPlan 1 — ${price1} USDT / 30 jours\nPlan 2 — ${price2} USDT / 30 jours\n\nChoisis un plan :`,
    { markdown: true, keyboard: planKeyboard }
  );
}

/** data au format "plan:1" ou "plan:2" */
export async function handlePlanSelection(env: Env, telegramId: number, data: string): Promise<void> {
  const plan = Number(data.split(":")[1]) as 1 | 2;
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Choisis ton moyen de paiement :", {
    keyboard: paymentMethodKeyboard(plan),
  });
}

/** data au format "pay:USDT:1", "pay:XMR:2", etc. */
export async function handlePaymentMethodSelection(env: Env, telegramId: number, data: string): Promise<void> {
  const [, methodRaw, planRaw] = data.split(":");
  const method = methodRaw as "USDT" | "XMR" | "LTC";
  const plan = Number(planRaw) as 1 | 2;
  const db = dbConfig(env);

  if (method === "USDT") {
    await setPendingAction(db, telegramId, { type: "awaiting_wallet_usdt", plan });
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Envoie-moi l'adresse Polygon (0x...) depuis laquelle tu vas payer, pour que je puisse " +
        "détecter automatiquement ta transaction sur la blockchain."
    );
    return;
  }

  const priceUsd = await getEffectivePriceUsd(db, telegramId, USDT_PLAN_PRICES[plan]);

  if (method === "XMR") {
    const invoice = await createMoneroInvoice(env, telegramId, plan, priceUsd);
    await createPendingPayment(db, {
      telegramId,
      method: "XMR",
      plan,
      payAddress: invoice.address,
      addressIndex: invoice.addressIndex,
      amountExpected: invoice.amountXmr,
    });
    if (env.PAYMENT_GUIDE_IMAGE_URL) {
      await sendPhoto(env.TELEGRAM_BOT_TOKEN, telegramId, env.PAYMENT_GUIDE_IMAGE_URL);
    }
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `🟠 *Paiement Monero — Plan ${plan}*\n\n` +
        `Envoie *exactement ${invoice.amountXmr.toFixed(6)} XMR* à cette adresse (à usage unique) :\n` +
        `\`${invoice.address}\`\n\n` +
        `Confirmation automatique après ${env.MONERO_MIN_CONFIRMATIONS} confirmations (vérifiée toutes les 5 minutes).`,
      { markdown: true }
    );
    return;
  }

  if (method === "LTC") {
    const invoice = await createLitecoinInvoice(db, telegramId, priceUsd);
    if (!invoice) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        telegramId,
        "⚠️ Le pool d'adresses Litecoin est momentanément épuisé. Choisis USDT ou Monero, " +
          "ou réessaie dans quelques instants."
      );
      return;
    }
    await createPendingPayment(db, {
      telegramId,
      method: "LTC",
      plan,
      payAddress: invoice.address,
      addressIndex: invoice.hdIndex,
      amountExpected: invoice.amountLtc,
    });
    if (env.PAYMENT_GUIDE_IMAGE_URL) {
      await sendPhoto(env.TELEGRAM_BOT_TOKEN, telegramId, env.PAYMENT_GUIDE_IMAGE_URL);
    }
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `⚪ *Paiement Litecoin — Plan ${plan}*\n\n` +
        `Envoie *exactement ${invoice.amountLtc.toFixed(6)} LTC* à cette adresse (à usage unique) :\n` +
        `\`${invoice.address}\`\n\n` +
        `Confirmation automatique après détection sur la blockchain (vérifiée toutes les 5 minutes).`,
      { markdown: true }
    );
  }
}
