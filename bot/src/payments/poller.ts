import { Telegram } from "telegraf";
import { getPendingPayments, markPaymentConfirmed } from "../db/payments";
import { activateSubscription } from "../db/users";
import { addDays } from "../utils/date";
import { isWalletRpcAvailable, checkMoneroPayment } from "./monero";
import { checkLitecoinPayment } from "./litecoin";
import { maybeRewardReferral } from "../bot/referral";

async function pollMonero(telegram: Telegram): Promise<void> {
  if (!(await isWalletRpcAvailable())) {
    console.warn(
      "[monero] wallet-rpc injoignable (PC éteint ou ngrok arrêté ?) — nouvelle tentative au prochain cycle."
    );
    return;
  }

  const pending = await getPendingPayments("XMR");
  for (const payment of pending) {
    if (payment.address_index === null || payment.amount_expected === null) continue;
    try {
      const paid = await checkMoneroPayment(payment.address_index, payment.amount_expected);
      if (!paid) continue;

      await markPaymentConfirmed(payment.id);
      await activateSubscription(payment.telegram_id, payment.plan, addDays(new Date(), 30));
      await maybeRewardReferral(telegram, payment.telegram_id);
      await telegram.sendMessage(payment.telegram_id, "✅ Paiement Monero confirmé ! Ton abonnement est actif.");
    } catch (err) {
      console.error(`[monero] Erreur de vérification pour le paiement #${payment.id}:`, err);
    }
  }
}

async function pollLitecoin(telegram: Telegram): Promise<void> {
  const pending = await getPendingPayments("LTC");
  for (const payment of pending) {
    if (!payment.pay_address || payment.amount_expected === null) continue;
    try {
      const paid = await checkLitecoinPayment(payment.pay_address, payment.amount_expected);
      if (!paid) continue;

      await markPaymentConfirmed(payment.id);
      await activateSubscription(payment.telegram_id, payment.plan, addDays(new Date(), 30));
      await maybeRewardReferral(telegram, payment.telegram_id);
      await telegram.sendMessage(payment.telegram_id, "✅ Paiement Litecoin confirmé ! Ton abonnement est actif.");
    } catch (err) {
      console.error(`[litecoin] Erreur de vérification pour le paiement #${payment.id}:`, err);
    }
  }
}

export function startPaymentPollers(telegram: Telegram, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    pollMonero(telegram).catch((err) => console.error("[monero] Erreur du poller:", err));
    pollLitecoin(telegram).catch((err) => console.error("[litecoin] Erreur du poller:", err));
  }, intervalMs);
}
