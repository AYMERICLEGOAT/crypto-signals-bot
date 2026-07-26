import { Env, dbConfig } from "../../env";
import { sendMessage, sendPhoto } from "../../telegram";
import { startUsdtPayment } from "../../payments/usdt";
import { createMoneroInvoice } from "../../payments/monero";
import { createLitecoinInvoice } from "../../payments/litecoin";
import { getEffectivePriceUsd } from "../../payments/promoCodes";
import { createPendingPayment } from "../../db/payments";
import { setPendingAction } from "../../db/pendingActions";
import { buildPlanKeyboard, paymentMethodKeyboard } from "../keyboards";
import { getRemainingDiscoverySlots } from "../../db/offerCounter";
import { hasWalletClaimedDiscovery } from "../../db/users";
import { PaidPlan, PLAN_PRICES_USD, PLAN_NAMES, PLAN_DURATION_DAYS, DISCOVERY_PLAN, isValidPlan } from "../../payments/plans";

export async function handleSubscribeCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const remainingDiscoverySlots = await getRemainingDiscoverySlots(db);
  // Audit#19 : grille simplifiée à 2 paliers pour le lancement (voir keyboards.ts).
  const proPlanVisible = env.PRO_PLAN_VISIBLE === "true";

  const lines = ["📅 *Nos offres*", "", `⭐ Standard — ${PLAN_PRICES_USD[1]} USDT / ${PLAN_DURATION_DAYS[1]} jours`];
  if (proPlanVisible) {
    lines.push(`🎯 Pro — ${PLAN_PRICES_USD[2]} USDT / ${PLAN_DURATION_DAYS[2]} jours (signaux en priorité, avant tout le monde)`);
  }
  if (remainingDiscoverySlots > 0) {
    lines.push(
      `🚀 Découverte — ${PLAN_PRICES_USD[3]} USDT / ${PLAN_DURATION_DAYS[3]} jours ` +
        `(offre de lancement, ${remainingDiscoverySlots} places restantes, une fois par wallet)`
    );
  }
  lines.push("", "Choisis un plan :");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), {
    markdown: true,
    keyboard: buildPlanKeyboard(remainingDiscoverySlots, proPlanVisible),
  });
}

/** data au format "plan:1", "plan:2" ou "plan:3" */
export async function handlePlanSelection(env: Env, telegramId: number, data: string): Promise<void> {
  const raw = Number(data.split(":")[1]);
  if (!isValidPlan(raw)) return;
  const plan: PaidPlan = raw;

  if (plan === DISCOVERY_PLAN) {
    const db = dbConfig(env);
    const remaining = await getRemainingDiscoverySlots(db);
    if (remaining <= 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "⚠️ Le Pack Découverte est épuisé. Choisis Standard ou Pro avec /subscribe.");
      return;
    }
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Choisis ton moyen de paiement :", {
    keyboard: paymentMethodKeyboard(plan),
  });
}

/** data au format "pay:USDT:1", "pay:XMR:2", "pay:LTC:3" etc. */
export async function handlePaymentMethodSelection(env: Env, telegramId: number, data: string): Promise<void> {
  const [, methodRaw, planRaw] = data.split(":");
  const method = methodRaw as "USDT" | "XMR" | "LTC";
  const rawPlan = Number(planRaw);
  if (!isValidPlan(rawPlan)) return;
  const plan: PaidPlan = rawPlan;
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

  // Monero et Litecoin ne révèlent l'adresse de l'acheteur qu'après paiement :
  // l'anti-abus par wallet du Pack Découverte (une fois par wallet) n'est donc
  // possible que côté USDT (voir db/users.ts hasWalletClaimedDiscovery) — les
  // utilisateurs qui contournent via XMR/LTC restent malgré tout limités par
  // le compteur global de places (getRemainingDiscoverySlots).
  if (plan === DISCOVERY_PLAN) {
    const remaining = await getRemainingDiscoverySlots(db);
    if (remaining <= 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "⚠️ Le Pack Découverte est épuisé. Choisis Standard ou Pro avec /subscribe.");
      return;
    }
  }

  const priceUsd = await getEffectivePriceUsd(db, telegramId, PLAN_PRICES_USD[plan]);

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
      `🟠 *Paiement Monero — ${PLAN_NAMES[plan]}*\n\n` +
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
    const ltcUri = `litecoin:${invoice.address}?amount=${invoice.amountLtc.toFixed(6)}`;
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `⚪ *Paiement Litecoin — ${PLAN_NAMES[plan]}*\n\n` +
        `Envoie *exactement ${invoice.amountLtc.toFixed(6)} LTC* à cette adresse (à usage unique) :\n` +
        `\`${invoice.address}\`\n\n` +
        `📱 [Ouvrir directement dans ton wallet](${ltcUri}) (adresse et montant préremplis).\n\n` +
        `Confirmation automatique après détection sur la blockchain (vérifiée toutes les 5 minutes).`,
      { markdown: true }
    );
  }
}
