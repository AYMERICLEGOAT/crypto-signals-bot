import { Env, dbConfig } from "../../env";
import { SupabaseConfig } from "../../supabaseRest";
import { sendMessage, getChatMemberStatus } from "../../telegram";
import {
  getOrCreateUser,
  activateSubscription,
  markTrialUsed,
  hasWalletClaimedTrial,
  countReferralsBy,
  isSubscriptionActive,
  setWalletAddress,
} from "../../db/users";
import { setPendingAction } from "../../db/pendingActions";
import { buildReferralLink } from "../referral";
import { addDays } from "../../utils/date";
// Source unique de l'état du filtre de tendance : le dupliquer ici garantirait
// qu'une des deux copies devienne fausse (voir commands/subscribe.ts).
import { TREND_FILTER_STATUS } from "./subscribe";

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

  // Un abonné payant (Standard/Pro/Découverte) qui active /trial verrait son
  // plan en cours écrasé par 3 jours d'essai (activateSubscription remplace
  // l'expiration) -- refuser plutôt que de faire perdre le bénéfice déjà payé.
  if (isSubscriptionActive(user) && user.plan !== 0) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `Tu as déjà un abonnement payant actif jusqu'au ${new Date(user.expiration as string).toLocaleDateString("fr-FR")} — ` +
        "l'essai gratuit ne t'apporterait rien de plus (et remplacerait ton abonnement en cours par 3 jours seulement). " +
        "Utilise /status pour voir le détail."
    );
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

  // Refonte du 03/08/2026 (moteur Force Relative). L'ancien message promettait
  // implicitement des signaux dès l'activation ; or 41 % du temps le filtre de
  // tendance est fermé et il n'en part aucun. Trois jours d'essai déclenchés
  // pendant une fermeture, c'est un essai brûlé pour rien — et un abonné qui
  // en conclut, à tort, que le bot ne fonctionne pas.
  //
  // La mécanique de facturation n'est PAS touchée : l'essai reste 3 jours
  // calendaires posés à l'activation. Ce qui change, c'est que l'utilisateur
  // sait qu'il choisit le moment. Il n'y a rien à réserver côté serveur —
  // trial_used n'est marqué qu'à l'activation (voir activateTrialForWallet),
  // donc attendre ne coûte ni ne risque rien.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "Ton essai dure 3 jours calendaires à partir de l'activation — ce sont 3 jours, pas 3 signaux.\n\n" +
      "À savoir avant de le déclencher : aucun signal n'est émis quand le Bitcoin est sous sa moyenne " +
      "200 jours, ce qui arrive 41 % du temps (la plus longue fermeture observée a duré 381 jours). " +
      "C'est voulu : sur 6 ans, ce filtre est ce qui évite les années perdantes. On préfère ne rien " +
      "envoyer plutôt que de te faire perdre de l'argent.\n\n" +
      (TREND_FILTER_STATUS.closed
        ? `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre est fermé : ${TREND_FILTER_STATUS.detail}. ` +
          "Autrement dit, un essai activé maintenant a toutes les chances de se terminer sans un seul signal.\n\n"
        : `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre est ouvert.\n\n`) +
      "Ton essai ne s'annule pas et ne se périme pas : il t'attend. Tu peux tout à fait le garder pour le " +
      "jour où les signaux reprennent — ils réapparaissent aussi sur le canal public, tu verras donc la " +
      "reprise — et retaper /trial à ce moment-là pour profiter de tes 3 jours quand il se passe quelque " +
      "chose.\n\n" +
      "Si tu préfères l'activer tout de suite, envoie-moi ton adresse de wallet Polygon (0x...).\n\n" +
      "En attendant, /demo montre la forme exacte d'un signal et /subscribe détaille les chiffres mesurés."
  );
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

  // Bug corrigé (audit du 31/07) : cette fonction prétendait reproduire la
  // garantie "un essai par adresse" du contrat on-chain via
  // hasWalletClaimedTrial() ci-dessus, mais n'enregistrait jamais l'adresse
  // en base -- hasWalletClaimedTrial() ne pouvait donc JAMAIS matcher un
  // wallet ayant déjà servi à un essai (confirmé en prod : les 2 comptes
  // trial_used=true avaient wallet_address=NULL). Un même wallet pouvait
  // réclamer un essai gratuit avec un nombre illimité de comptes Telegram.
  await setWalletAddress(db, telegramId, walletAddress);

  // Ordre important : activer l'abonnement AVANT de marquer trial_used. Si
  // activateSubscription échoue (hoquet Supabase transitoire), trial_used
  // reste false et /trial reste retentable au prochain essai plutôt que de
  // bloquer définitivement un utilisateur qui n'a jamais rien reçu.
  await activateSubscription(db, telegramId, 0, addDays(new Date(), TRIAL_DURATION_DAYS));
  await markTrialUsed(db, telegramId);

  // « Tu vas recevoir les signaux automatiquement » était faux dès que le
  // filtre de tendance est fermé (41 % du temps). Formulation exacte : tu
  // reçois tout ce qui sort pendant tes 3 jours, et il peut ne rien sortir.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🎉 Essai gratuit de 3 jours activé.\n\n" +
      "Tu recevras automatiquement tout signal émis pendant ces 3 jours. Il peut aussi n'y en avoir " +
      "aucun : rien n'est envoyé quand le Bitcoin est sous sa moyenne 200 jours, et c'est justement ce " +
      "qui a évité les années perdantes sur les 6 dernières années.\n\n" +
      "Le silence n'est donc pas une panne. /demo montre la forme d'un signal, /status l'état de ton essai."
  );
}
