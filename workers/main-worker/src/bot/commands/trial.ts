import { Env, dbConfig } from "../../env";
import { SupabaseConfig } from "../../supabaseRest";
import { sendMessage, getChatMemberStatus } from "../../telegram";
import { getOrCreateUser, activateSubscription, markTrialUsed, hasWalletClaimedTrial, countReferralsBy } from "../../db/users";
import { setPendingAction } from "../../db/pendingActions";
import { buildReferralLink } from "../referral";
import { addDays } from "../../utils/date";

const TRIAL_DURATION_DAYS = 3;

const CHANNEL_MEMBER_STATUSES = ["member", "administrator", "creator"];

/**
 * Boucle virale : le /trial n'est accordé que si l'utilisateur a rejoint le
 * canal public OU a parrainé au moins une personne (son lien de parrainage
 * a été utilisé — voir bot/referral.ts). Les deux conditions sont vérifiées
 * via des API déjà gratuites (Telegram + notre propre base), pas de coût
 * externe contrairement à une vérification via l'API X/Twitter.
 */
export async function isEligibleForTrial(env: Env, db: SupabaseConfig, telegramId: number): Promise<boolean> {
  if (env.TELEGRAM_CHANNEL_ID) {
    const status = await getChatMemberStatus(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHANNEL_ID, telegramId);
    if (status && CHANNEL_MEMBER_STATUSES.includes(status)) return true;
  }
  const referrals = await countReferralsBy(db, telegramId);
  return referrals >= 1;
}

export async function handleTrialCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);

  if (user.trial_used) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Tu as déjà utilisé ton essai gratuit. Utilise /subscribe pour t'abonner.");
    return;
  }

  if (!(await isEligibleForTrial(env, db, telegramId))) {
    const referralLink = buildReferralLink(env, telegramId);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Pour débloquer ton essai gratuit, choisis une option :\n\n" +
        `1️⃣ Rejoins notre canal public : ${env.TELEGRAM_CHANNEL_URL ?? "(lien du canal)"}, puis retape /trial.\n\n` +
        `2️⃣ Ou parraine un ami avec ton lien : ${referralLink}\n` +
        "Dès qu'une personne démarre le bot via ce lien, ton essai se débloque automatiquement — retape /trial ensuite."
    );
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
    // Ne PAS marquer trial_used ici : cette adresse a déjà servi (ailleurs),
    // mais CE compte Telegram n'a encore reçu aucun essai. Le marquer utilisé
    // condamnerait définitivement un utilisateur honnête qui aurait juste
    // collé la mauvaise adresse (copier-coller, adresse recyclée) — il
    // suffit de le laisser réessayer avec une autre adresse.
    await setPendingAction(db, telegramId, { type: "awaiting_wallet_trial" });
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Cette adresse a déjà utilisé son essai gratuit. Envoie une autre adresse de wallet Polygon (0x...) pour activer le tien."
    );
    return;
  }

  await markTrialUsed(db, telegramId);
  await activateSubscription(db, telegramId, 0, addDays(new Date(), TRIAL_DURATION_DAYS));

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "🎉 Essai gratuit de 3 jours activé ! Tu vas recevoir les signaux automatiquement.");
}
