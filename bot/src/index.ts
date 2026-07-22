import { Telegraf } from "telegraf";
import { config } from "./config";

import { handleStart } from "./bot/commands/start";
import { handleStatusCommand } from "./bot/commands/status";
import { handleTrialCommand } from "./bot/commands/trial";
import {
  handleSubscribeCommand,
  handlePlanSelection,
  handlePaymentMethodSelection,
} from "./bot/commands/subscribe";
import { handleTextMessage } from "./bot/walletAddressHandler";

import { catchUpMissedEvents, listenForNewSubscriptions, SubscribedPayload } from "./blockchain/subscriptionEvents";
import { findUserByWalletAddress, activateSubscription } from "./db/users";
import { getLatestPendingPayment, markPaymentConfirmed } from "./db/payments";

import { startSignalDispatcher } from "./signals/dispatcher";
import { startPaymentPollers } from "./payments/poller";
import { maybeRewardReferral } from "./bot/referral";

const bot = new Telegraf(config.telegram.botToken);

/**
 * Appelé quand l'événement on-chain `Subscribed` est détecté (paiement USDT
 * confirmé). Retrouve l'utilisateur Telegram correspondant via son wallet
 * (renseigné lors du choix du paiement USDT) et active son abonnement.
 */
async function onSubscribedConfirmed(payload: SubscribedPayload): Promise<void> {
  const user = await findUserByWalletAddress(payload.user);
  if (!user) {
    console.warn(`[usdt] Paiement on-chain reçu de ${payload.user} mais aucun utilisateur Telegram associé.`);
    return;
  }

  await activateSubscription(user.telegram_id, payload.plan, new Date(payload.newExpirationMs));

  const pending = await getLatestPendingPayment(user.telegram_id, "USDT");
  if (pending) await markPaymentConfirmed(pending.id);
  await maybeRewardReferral(bot.telegram, user.telegram_id);

  await bot.telegram.sendMessage(
    user.telegram_id,
    "✅ Paiement USDT confirmé sur la blockchain ! Ton abonnement est actif."
  );
}

function registerHandlers(): void {
  bot.start(handleStart);
  bot.command("subscribe", handleSubscribeCommand);
  bot.command("status", handleStatusCommand);
  bot.command("trial", handleTrialCommand);

  bot.action("start:subscribe", handleSubscribeCommand);
  bot.action("start:trial", handleTrialCommand);
  bot.action("start:status", handleStatusCommand);
  bot.action(/^plan:(1|2)$/, handlePlanSelection);
  bot.action(/^pay:(USDT|XMR|LTC):(1|2)$/, handlePaymentMethodSelection);

  // Catch-all texte libre : ne réagit que si une adresse wallet est attendue (voir bot/state.ts).
  bot.on("text", handleTextMessage);

  bot.catch((err, ctx) => {
    console.error(`[telegraf] Erreur non gérée pour l'update ${ctx.updateType}:`, err);
  });
}

async function main(): Promise<void> {
  console.log("Démarrage du bot d'abonnement...");
  registerHandlers();

  console.log("Rattrapage des événements Subscribed manqués depuis le dernier arrêt...");
  await catchUpMissedEvents(onSubscribedConfirmed);
  listenForNewSubscriptions(onSubscribedConfirmed);
  console.log("Écoute des paiements USDT en direct activée.");

  startSignalDispatcher(bot.telegram, config.polling.signalDispatchIntervalMs);
  startPaymentPollers(bot.telegram, config.polling.paymentCheckIntervalMs);
  console.log("Dispatcher de signaux et pollers Monero/Litecoin démarrés.");

  await bot.launch();
  console.log("Bot Telegram démarré (long polling). Ctrl+C pour arrêter proprement.");
}

main().catch((err) => {
  console.error("Erreur fatale au démarrage du bot:", err);
  process.exit(1);
});

// Arrêt propre : Telegraf coupe le long polling en cours puis relâche le process.
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
