import { Context } from "telegraf";
import { getPlanPriceUsdt } from "../../blockchain/contract";
import { startUsdtPayment } from "../../payments/usdt";
import { createMoneroInvoice } from "../../payments/monero";
import { createLitecoinInvoice } from "../../payments/litecoin";
import { createPendingPayment } from "../../db/payments";
import { config } from "../../config";
import { planKeyboard, paymentMethodKeyboard } from "../keyboards";
import { setPendingAction } from "../state";

export async function handleSubscribeCommand(ctx: Context): Promise<void> {
  const [price1, price2] = await Promise.all([getPlanPriceUsdt(1), getPlanPriceUsdt(2)]);
  await ctx.reply(
    `📅 *Nos offres*\n\nPlan 1 — ${price1} USDT / 30 jours\nPlan 2 — ${price2} USDT / 30 jours\n\nChoisis un plan :`,
    { parse_mode: "Markdown", ...planKeyboard }
  );
}

export async function handlePlanSelection(ctx: Context & { match: RegExpExecArray }): Promise<void> {
  const plan = Number(ctx.match[1]) as 1 | 2;
  await ctx.answerCbQuery();
  await ctx.reply("Choisis ton moyen de paiement :", paymentMethodKeyboard(plan));
}

export async function handlePaymentMethodSelection(ctx: Context & { match: RegExpExecArray }): Promise<void> {
  if (!ctx.from) return;
  const method = ctx.match[1] as "USDT" | "XMR" | "LTC";
  const plan = Number(ctx.match[2]) as 1 | 2;
  const telegramId = ctx.from.id;
  await ctx.answerCbQuery();

  if (method === "USDT") {
    setPendingAction(telegramId, { type: "awaiting_wallet_usdt", plan });
    await ctx.reply(
      "Envoie-moi l'adresse Polygon (0x...) depuis laquelle tu vas payer, pour que je puisse " +
        "détecter automatiquement ta transaction sur la blockchain."
    );
    return;
  }

  const priceUsd = await getPlanPriceUsdt(plan);

  if (method === "XMR") {
    const invoice = await createMoneroInvoice(telegramId, plan, priceUsd);
    await createPendingPayment({
      telegramId,
      method: "XMR",
      plan,
      payAddress: invoice.address,
      addressIndex: invoice.addressIndex,
      amountExpected: invoice.amountXmr,
    });
    await ctx.replyWithMarkdown(
      `🟠 *Paiement Monero — Plan ${plan}*\n\n` +
        `Envoie *exactement ${invoice.amountXmr.toFixed(6)} XMR* à cette adresse (à usage unique) :\n` +
        `\`${invoice.address}\`\n\n` +
        `Confirmation automatique après ${config.monero.minConfirmations} confirmations sur la blockchain ` +
        `(vérification via monero-wallet-rpc — voir /status pour suivre l'état).`
    );
    return;
  }

  if (method === "LTC") {
    const invoice = await createLitecoinInvoice(priceUsd);
    await createPendingPayment({
      telegramId,
      method: "LTC",
      plan,
      payAddress: invoice.address,
      addressIndex: invoice.index,
      amountExpected: invoice.amountLtc,
    });
    await ctx.replyWithMarkdown(
      `⚪ *Paiement Litecoin — Plan ${plan}*\n\n` +
        `Envoie *exactement ${invoice.amountLtc.toFixed(6)} LTC* à cette adresse (à usage unique) :\n` +
        `\`${invoice.address}\`\n\n` +
        `Confirmation automatique après détection sur la blockchain (voir /status).`
    );
  }
}
