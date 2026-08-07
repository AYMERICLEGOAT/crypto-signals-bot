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

/**
 * Message d'activation. Il doit répondre, dans l'ordre, aux trois questions
 * que se pose quelqu'un qui vient d'appuyer sur un bouton gratuit : jusqu'à
 * quand ça dure, qu'est-ce que je vais recevoir concrètement, et à quel rythme.
 *
 * Le troisième point est celui qu'un vendeur arrondirait. On donne donc les
 * débits mesurés dans les DEUX régimes, en disant que ce sont des moyennes sur
 * 6 ans et pas une garantie sur trois jours. Un essai de 3 jours peut très bien
 * tomber sur un trou : le dire maintenant coûte moins cher qu'un abonné qui le
 * découvre seul et en conclut que le bot est cassé.
 */
function buildActivationMessage(endsAt: Date): string {
  const fin = endsAt.toLocaleString("fr-FR");

  const etatDuFiltre = TREND_FILTER_STATUS.closed
    ? `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre est FERMÉ : ${TREND_FILTER_STATUS.detail}. ` +
      "Les trois familles directionnelles sont donc à l'arrêt en ce moment, et c'est le carry que tu vas " +
      "voir passer. Tape /marche pour l'état recalculé en direct, et les carrys ouverts à cet instant."
    : `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre est ouvert : les quatre familles émettent. ` +
      "Il peut se refermer n'importe quand — ce jour-là, le carry continuera seul. Tape /marche à tout moment.";

  return (
    "🎉 Essai gratuit activé. Tu reçois les signaux pendant 3 jours, jusqu'au " +
    `${fin}.\n\n` +
    "Ce que tu vas recevoir, concrètement — il y a deux formes de signal :\n\n" +
    "1) DES ACHATS. Une paire parmi les plus fortes du moment, avec l'entrée, un stop large à 4 x ATR, " +
    "trois jalons à 4, 8 et 12 x ATR, et une sortie au bout de 7 jours. Trois familles émettent ce " +
    "format : force relative, cassure du plus haut 50 jours, expansion de volatilité.\n\n" +
    "2) DES CARRYS DE FINANCEMENT. Une position neutre au marché, en deux jambes du même montant sur la " +
    "même crypto : achat au comptant et vente à découvert du perpétuel. Le prix ne rentre pas dans " +
    "l'équation, les deux jambes s'annulent. Ce qui est encaissé, c'est le financement versé toutes les " +
    "huit heures par les acheteurs de perpétuels aux vendeurs. Clôture au bout de 21 jours.\n\n" +
    "Une chose importante à savoir tout de suite : les trois familles d'achat se taisent quand le Bitcoin " +
    "est sous sa moyenne 200 jours, ce qui arrive 41 % du temps (la plus longue fermeture a duré " +
    "381 jours, du 28/12/2021 au 13/01/2023). C'est voulu : on préfère ne rien t'envoyer plutôt que de te " +
    "faire perdre de l'argent. Le carry, lui, n'est pas filtré et continue dans les deux cas. Et un second " +
    "moteur, le momentum 4H, ne travaille QUE dans ce régime baissier — en observation, ce qui est écrit " +
    "sur chacun de ses signaux.\n\n" +
    `${etatDuFiltre}\n\n` +
    "Le rythme mesuré : 4,35 signaux par jour en marché favorable ; en marché défavorable, le carry " +
    "(1,15 par jour) accompagné du momentum 4H. Jamais plus de 5 par jour au total. " +
    "Ce sont des moyennes, pas une garantie : trois jours, c'est court, et il est possible que tu tombes " +
    "sur un jour creux.\n\n" +
    "Le silence n'est donc jamais une panne. /demo montre la forme exacte des deux signaux, /marche l'état " +
    "du marché en direct, /status où tu en es.\n\n" +
    "⚠️ Ce ne sont pas des conseils en investissement : c'est toi qui décides, et il y a un risque de " +
    "perte en capital."
  );
}

/**
 * Pose les 3 jours et envoie la confirmation.
 *
 * Ordre important : activer l'abonnement AVANT de marquer trial_used. Si
 * activateSubscription échoue (hoquet Supabase transitoire), trial_used reste
 * false et /trial reste retentable au prochain essai plutôt que de bloquer
 * définitivement un utilisateur qui n'a jamais rien reçu.
 */
async function grantTrial(env: Env, db: SupabaseConfig, telegramId: number): Promise<void> {
  const endsAt = addDays(new Date(), TRIAL_DURATION_DAYS);
  await activateSubscription(db, telegramId, 0, endsAt);
  await markTrialUsed(db, telegramId);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, buildActivationMessage(endsAt));
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
      "Ton essai gratuit de 3 jours est prêt. Il ne reste qu'une porte à ouvrir, au choix :\n\n" +
        `1️⃣ Rejoins le canal public : ${env.TELEGRAM_CHANNEL_URL ?? "(lien du canal)"}\n` +
        "Tu y verras les vrais signaux, en différé. Retape /trial ensuite : l'essai démarre dans la seconde.\n\n" +
        `2️⃣ Ou partage ton lien : ${referralLink}\n` +
        "Dès qu'une personne démarre le bot avec, ton essai se débloque automatiquement — retape /trial ensuite.\n\n" +
        "Et pour lever le doute tout de suite : l'essai ne demande ni carte bancaire, ni adresse crypto, ni " +
        "moyen de paiement. Il n'y a rien à résilier non plus, il s'arrête tout seul au bout de 3 jours.\n\n" +
        "En attendant, /demo montre la forme exacte des signaux et /marche l'état du marché en direct."
    );
    return;
  }

  // Refonte du 04/08/2026 — suppression de deux étapes.
  //
  // 1) L'adresse de wallet Polygon n'est plus demandée. Elle servait un
  //    anti-abus "un essai par adresse" (hasWalletClaimedTrial), mais rien ne
  //    vérifie que l'adresse saisie appartient à la personne : n'importe quelle
  //    chaîne 0x d'un explorateur public passait. L'anti-abus était donc
  //    largement théorique, alors que la friction, elle, était totale —
  //    réclamer une adresse crypto pour un essai GRATUIT exclut d'emblée toute
  //    personne qui n'a pas encore de wallet, c'est-à-dire exactement le
  //    premier visiteur qu'on cherche à convaincre. trial_used reste posé par
  //    compte Telegram, ce qui couvre le cas courant.
  // 2) L'écran "réfléchis avant de déclencher" disparaît. Il existait parce
  //    qu'un essai tombant pendant une fermeture du filtre était un essai brûlé
  //    pour rien. Le carry de financement ayant supprimé ce cas — il produit
  //    dans les deux régimes —, cet écran ne protégeait plus rien et coûtait un
  //    aller-retour. Ce qu'il disait d'utile (le silence directionnel, sa
  //    durée, l'état du jour) est conservé, mais dans le message d'activation.
  //
  // La mécanique de facturation n'est PAS touchée : 3 jours calendaires posés
  // à l'activation, comme avant.
  await grantTrial(env, db, telegramId);
}

/**
 * V2 100% off-chain : plus d'appel setTrial() sur le contrat (pas de gas,
 * pas de transaction à attendre).
 *
 * Ce chemin n'est plus emprunté par /trial depuis le 04/08/2026 (voir
 * ci-dessus), mais il reste branché sur l'action en attente
 * "awaiting_wallet_trial" (bot/walletAddressHandler.ts) : un utilisateur peut
 * avoir cette action posée en base depuis l'ancien parcours, et sa prochaine
 * adresse envoyée doit continuer d'aboutir plutôt que de tomber dans le vide.
 * L'anti-abus par adresse y est donc conservé à l'identique.
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

  await grantTrial(env, db, telegramId);
}
