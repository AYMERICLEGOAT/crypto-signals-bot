import { Env, dbConfig } from "../env";
import { catchUpMissedEvents } from "../blockchain/subscriptionEvents";
import { findUserByWalletAddress, activateSubscription } from "../db/users";
import { getLatestPendingPayment, markPaymentConfirmed, getPendingPayments } from "../db/payments";
import { sendMessage } from "../telegram";
import { isWalletRpcAvailable, checkMoneroPayment } from "../payments/monero";
import { checkLitecoinPayment } from "../payments/litecoin";
import { addDays } from "../utils/date";
import { maybeRewardReferral } from "../bot/referral";

/** Rattrape les événements Subscribed (paiements USDT) manqués depuis le dernier cycle. */
async function processUsdtEvents(env: Env): Promise<void> {
  const db = dbConfig(env);
  const events = await catchUpMissedEvents(env, db);

  for (const event of events) {
    const user = await findUserByWalletAddress(db, event.user);
    if (!user) {
      console.warn(`[usdt] Paiement on-chain reçu de ${event.user} mais aucun utilisateur Telegram associé.`);
      continue;
    }

    await activateSubscription(db, user.telegram_id, event.plan, new Date(event.newExpirationMs));
    const pending = await getLatestPendingPayment(db, user.telegram_id, "USDT");
    if (pending) await markPaymentConfirmed(db, pending.id);
    await maybeRewardReferral(env, user.telegram_id);

    await sendMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_id, "✅ Paiement USDT confirmé sur la blockchain ! Ton abonnement est actif.");
  }
}

async function processMoneroPayments(env: Env): Promise<void> {
  const db = dbConfig(env);
  if (!(await isWalletRpcAvailable(env))) {
    console.warn("[monero] wallet-rpc injoignable (PC éteint ou ngrok arrêté ?) — nouvelle tentative au prochain cycle.");
    return;
  }

  const pending = await getPendingPayments(db, "XMR");
  for (const payment of pending) {
    if (payment.address_index === null || payment.amount_expected === null) continue;
    try {
      const paid = await checkMoneroPayment(env, payment.address_index, payment.amount_expected);
      if (!paid) continue;

      await markPaymentConfirmed(db, payment.id);
      await activateSubscription(db, payment.telegram_id, payment.plan, addDays(new Date(), 30));
      await maybeRewardReferral(env, payment.telegram_id);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, payment.telegram_id, "✅ Paiement Monero confirmé ! Ton abonnement est actif.");
    } catch (err) {
      console.error(`[monero] Erreur de vérification pour le paiement #${payment.id}:`, err);
    }
  }
}

async function processLitecoinPayments(env: Env): Promise<void> {
  const db = dbConfig(env);
  const pending = await getPendingPayments(db, "LTC");
  for (const payment of pending) {
    if (!payment.pay_address || payment.amount_expected === null) continue;
    try {
      const paid = await checkLitecoinPayment(env, payment.pay_address, payment.amount_expected);
      if (!paid) continue;

      await markPaymentConfirmed(db, payment.id);
      await activateSubscription(db, payment.telegram_id, payment.plan, addDays(new Date(), 30));
      await maybeRewardReferral(env, payment.telegram_id);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, payment.telegram_id, "✅ Paiement Litecoin confirmé ! Ton abonnement est actif.");
    } catch (err) {
      console.error(`[litecoin] Erreur de vérification pour le paiement #${payment.id}:`, err);
    }
  }
}

export async function pollPayments(env: Env): Promise<void> {
  await Promise.all([
    processUsdtEvents(env).catch((err) => console.error("[usdt] Erreur du cron:", err)),
    processMoneroPayments(env).catch((err) => console.error("[monero] Erreur du cron:", err)),
    processLitecoinPayments(env).catch((err) => console.error("[litecoin] Erreur du cron:", err)),
  ]);
}
