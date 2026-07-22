import { Context } from "telegraf";
import { contractAsAdmin } from "../../blockchain/contract";
import { getOrCreateUser, activateSubscription, markTrialUsed } from "../../db/users";
import { addDays } from "../../utils/date";
import { setPendingAction } from "../state";

const TRIAL_DURATION_DAYS = 3;

export async function handleTrialCommand(ctx: Context): Promise<void> {
  if (!ctx.from) return;
  const telegramId = ctx.from.id;
  const user = await getOrCreateUser(telegramId);

  if (user.trial_used) {
    await ctx.reply("Tu as déjà utilisé ton essai gratuit. Utilise /subscribe pour t'abonner.");
    return;
  }

  if (user.wallet_address) {
    await activateTrialForWallet(ctx, telegramId, user.wallet_address);
    return;
  }

  setPendingAction(telegramId, { type: "awaiting_wallet_trial" });
  await ctx.reply("Envoie-moi ton adresse de wallet Polygon (0x...) pour activer ton essai gratuit de 3 jours.");
}

/**
 * Appelle setTrial() sur le contrat avec le wallet admin (OWNER). Le contrat
 * lui-même refuse un deuxième essai pour la même adresse (trialUsed on-chain),
 * ce qui sert de garde-fou même si l'état côté Supabase venait à diverger.
 */
export async function activateTrialForWallet(ctx: Context, telegramId: number, walletAddress: string): Promise<void> {
  await ctx.reply("⏳ Activation de ton essai en cours (transaction on-chain, ça peut prendre quelques secondes)...");
  try {
    const tx = await contractAsAdmin.setTrial(walletAddress);
    await tx.wait();

    await markTrialUsed(telegramId);
    await activateSubscription(telegramId, 0, addDays(new Date(), TRIAL_DURATION_DAYS));

    await ctx.reply("🎉 Essai gratuit de 3 jours activé ! Tu vas recevoir les signaux automatiquement.");
  } catch (err) {
    const message = String((err as { reason?: string; message?: string })?.reason ?? (err as Error)?.message ?? "");
    if (message.includes("trial already used")) {
      await ctx.reply("Cette adresse a déjà utilisé son essai gratuit sur le contrat.");
      await markTrialUsed(telegramId);
    } else {
      await ctx.reply("❌ Échec de l'activation de l'essai. Réessaie dans quelques minutes.");
      console.error("[trial] Erreur setTrial:", err);
    }
  }
}
