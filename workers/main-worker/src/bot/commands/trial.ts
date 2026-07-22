import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, activateSubscription, markTrialUsed } from "../../db/users";
import { setPendingAction } from "../../db/pendingActions";
import { callSetTrial } from "../../blockchain/contract";
import { getTransactionReceipt } from "../../blockchain/rpc";
import { addDays } from "../../utils/date";

const TRIAL_DURATION_DAYS = 3;
// Petit sondage borné : Polygon mine généralement en ~2-5s. Au-delà, on
// active quand même côté Supabase (la transaction déjà diffusée sur le
// mempool a une probabilité extrêmement élevée de miner) plutôt que de
// bloquer la réponse du webhook — voir README pour ce compromis assumé.
const RECEIPT_POLL_ATTEMPTS = 3;
const RECEIPT_POLL_DELAY_MS = 1500;

export async function handleTrialCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);

  if (user.trial_used) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Tu as déjà utilisé ton essai gratuit. Utilise /subscribe pour t'abonner.");
    return;
  }

  if (user.wallet_address) {
    await activateTrialForWallet(env, telegramId, user.wallet_address);
    return;
  }

  await setPendingAction(db, telegramId, { type: "awaiting_wallet_trial" });
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Envoie-moi ton adresse de wallet Polygon (0x...) pour activer ton essai gratuit de 3 jours.");
}

export async function activateTrialForWallet(env: Env, telegramId: number, walletAddress: string): Promise<void> {
  const db = dbConfig(env);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "⏳ Activation de ton essai en cours (transaction on-chain)...");

  let txHash: string;
  try {
    txHash = await callSetTrial(env, walletAddress);
  } catch (err) {
    const message = String((err as Error)?.message ?? "");
    if (message.includes("trial already used")) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Cette adresse a déjà utilisé son essai gratuit sur le contrat.");
      await markTrialUsed(db, telegramId);
    } else {
      console.error("[trial] Erreur setTrial:", err);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "❌ Échec de l'activation de l'essai. Réessaie dans quelques minutes.");
    }
    return;
  }

  const rpc = { url: env.POLYGON_RPC_URL };
  let confirmed = false;
  for (let i = 0; i < RECEIPT_POLL_ATTEMPTS && !confirmed; i++) {
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_DELAY_MS));
    const receipt = await getTransactionReceipt(rpc, txHash).catch(() => null);
    if (receipt) confirmed = receipt.status === "0x1";
  }

  await markTrialUsed(db, telegramId);
  await activateSubscription(db, telegramId, 0, addDays(new Date(), TRIAL_DURATION_DAYS));

  if (confirmed) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "🎉 Essai gratuit de 3 jours activé ! Tu vas recevoir les signaux automatiquement.");
  } else {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "🎉 Essai activé ! La transaction est en cours de confirmation sur la blockchain " +
        `(tx \`${txHash}\`) — tout est déjà en place de ton côté, vérifie /status dans une minute si besoin.`
    );
  }
}
