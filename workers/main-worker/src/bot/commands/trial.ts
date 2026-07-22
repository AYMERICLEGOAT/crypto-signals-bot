import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, activateSubscription, markTrialUsed, hasWalletClaimedTrial } from "../../db/users";
import { setPendingAction } from "../../db/pendingActions";
import { addDays } from "../../utils/date";

const TRIAL_DURATION_DAYS = 3;

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

/**
 * V2 100% off-chain : plus d'appel setTrial() sur le contrat (pas de gas,
 * pas de transaction à attendre). L'anti-abus "un essai par adresse" — que
 * garantissait le contrat via son mapping trialUsed — est reproduit ici
 * par hasWalletClaimedTrial() : une même adresse ne peut pas relancer un
 * essai via un second compte Telegram.
 */
export async function activateTrialForWallet(env: Env, telegramId: number, walletAddress: string): Promise<void> {
  const db = dbConfig(env);

  if (await hasWalletClaimedTrial(db, walletAddress)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Cette adresse a déjà utilisé son essai gratuit.");
    await markTrialUsed(db, telegramId);
    return;
  }

  await markTrialUsed(db, telegramId);
  await activateSubscription(db, telegramId, 0, addDays(new Date(), TRIAL_DURATION_DAYS));

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "🎉 Essai gratuit de 3 jours activé ! Tu vas recevoir les signaux automatiquement.");
}
