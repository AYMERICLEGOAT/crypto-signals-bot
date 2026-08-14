import { Env, dbConfig } from "../../env";
import { sendMessage, InlineKeyboard } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive, UserRecord } from "../../db/users";
import { getUserSignalHistory } from "../../db/history";
import { PLAN_NAMES, isValidPlan, LIFETIME_PLAN } from "../../payments/plans";
import { getLoyaltyBadge } from "../loyaltyBadge";
import { lireDebitReel, formaterDebitReel } from "../../db/debitReel";
import { DEBIT, PART_FILTRE_FERME, PART_JOURS_AVEC_SIGNAL, MOMENTUM_4H } from "../../publishedStats";
// Source unique de l'état du filtre de tendance (voir commands/subscribe.ts) :
// le redéclarer ici garantirait qu'une des deux copies devienne fausse.
import { TREND_FILTER_STATUS } from "./subscribe";

/**
 * /status — « où j'en suis ».
 *
 * Il répond à quatre choses : combien de temps il te reste, ce que le moteur
 * émet EN CE MOMENT, combien de signaux tu as reçus, et quoi faire ensuite. Un
 * abonné qui voit « 0 signal reçu » à côté de « filtre fermé, le carry et le
 * momentum 4H prennent le relais » comprend son silence ; le même abonné sans
 * cette ligne conclut à une panne et ne renouvelle pas.
 *
 * TROIS CORRECTIONS DU 08/08/2026.
 *
 * 1. Le bloc « ce que le moteur émet » ne nommait qu'UN moteur directionnel. Il
 *    y en a trois depuis que la cassure de canal et l'expansion de volatilité
 *    sont entrées en service. Un remplacement automatique avait au passage
 *    produit du français cassé — « La force relative (la force relative) est
 *    donc à l'arrêt : elle achètent » — envoyé tel quel aux abonnés.
 *
 * 2. Le plan À VIE affichait un compte à rebours de cent ans. « Il te reste
 *    36 500 jours » est la façon la plus sûre de faire passer un accès
 *    définitif pour un bug.
 *
 * 3. Aucun bouton. La commande la plus consultée par quelqu'un dont l'accès
 *    vient d'expirer se terminait sur un nom de commande à recopier.
 *
 * Envoyé sans parse_mode : le message contient des dates au format français,
 * des pourcentages et des tirets, et un seul caractère mal placé ferait échouer
 * le message ENTIER côté Telegram.
 */

// Assez large pour couvrir tout l'historique réaliste d'un abonné (même borne
// que /myperformance) sans avoir à paginer.
const MAX_SIGNALS = 500;

function planLabel(user: UserRecord): string {
  if (user.plan === 0) return "Essai gratuit";
  // Le garde de type porte sur la variable locale, pas sur `user.plan` : un
  // `isValidPlan(user.plan as number)` ne rétrécit rien et forcerait un second
  // cast à l'indexation — celui-là même qui laissait le plan 4 hors du type.
  const plan = user.plan ?? -1;
  if (isValidPlan(plan)) return PLAN_NAMES[plan];
  return `Plan ${user.plan}`;
}

/** « 2 jours et 5 heures » — plus parlant qu'une date seule quand il reste peu de temps. */
function formatRemaining(msLeft: number): string {
  const days = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  const hours = Math.floor((msLeft % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days >= 1) {
    return `${days} jour${days > 1 ? "s" : ""} et ${hours} heure${hours > 1 ? "s" : ""}`;
  }
  const minutes = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 1) return `${hours} heure${hours > 1 ? "s" : ""} et ${minutes} minute${minutes > 1 ? "s" : ""}`;
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

/**
 * Ce que le moteur émet en ce moment, et pourquoi.
 *
 * C'est le bloc qui manquait : sans lui, « abonnement actif » et « aucun signal
 * reçu » se contredisent aux yeux de l'abonné. Le filtre coupe les TROIS
 * moteurs directionnels ; le carry est neutre au marché donc jamais filtré, et
 * le momentum 4H ne travaille QUE quand le filtre est fermé.
 */
async function buildEngineStateLines(env: Env): Promise<string[]> {
  // LE DÉBIT RÉELLEMENT MESURÉ, à côté de la moyenne historique.
  //
  // Les chiffres de publishedStats sont des moyennes sur six ans, et elles sont
  // justes. Mais « le carry et le momentum prennent le relais à 3,1 signaux par
  // jour » se lit comme une promesse sur aujourd'hui, alors que le carry ne
  // produit rien tant que le financement reste sous le seuil qui couvre ses
  // frais. Le 09/08/2026, le débit réel était de 2,0 par jour.
  //
  // Un abonné qui constate l'écart seul conclut qu'on lui a menti. Le publier
  // nous-mêmes, à côté de la moyenne, est la seule version qui tienne dans le
  // temps — et c'est la règle que ce projet s'applique partout ailleurs.
  //
  // Silence volontaire si la lecture échoue : afficher « 0 par jour » sur une
  // panne de base ferait fuir quelqu'un pour une raison entièrement fausse.
  const reel = await lireDebitReel(dbConfig(env));
  const ligneReelle = reel ? [formaterDebitReel(reel)] : [];

  if (TREND_FILTER_STATUS.closed) {
    return [
      ...ligneReelle,
      "",
      `🔻 Ce que le moteur émet en ce moment (mesuré le ${TREND_FILTER_STATUS.measuredOn}) :`,
      `Le filtre de tendance est fermé — ${TREND_FILTER_STATUS.detail}. Les trois moteurs directionnels ` +
        "sont donc à l'arrêt : force relative, cassure de canal et expansion de volatilité achètent tous " +
        "les trois une hausse, et acheter ne paie pas dans ce régime.",
      "Le carry de financement, lui, continue : il est neutre au marché, donc jamais filtré.",
      "Le momentum 4H l'accompagne, et lui ne travaille QUE dans ce régime : il classe les cryptos entre elles " +
        `sur des bougies de 4 heures et achète LA plus forte, tenue 3 jours. Mesuré : ${MOMENTUM_4H.esperanceParSignal} ` +
        `par signal en ${MOMENTUM_4H.jours} jours, soit ${MOMENTUM_4H.esperanceParJour} par jour de capital immobilisé — environ ` +
        `${MOMENTUM_4H.facteurContreCarry} fois le rendement quotidien du carry. Son historique commence en 2023, plus court que celui des ` +
        "autres moteurs : il reste donc plafonné à UNE place par jour, et chacun de ses signaux porte le détail.",
      `À eux deux, sur six ans : ${DEBIT.defavorable} signaux par jour en moyenne. Le carry ne se déclenche ` +
        "toutefois que si le financement couvre ses frais — quand il est plat, comme en ce moment, le " +
        "momentum 4H travaille seul et le débit descend. Ce n'est pas une panne : c'est le fonctionnement prévu.",
    ];
  }
  return [
    ...ligneReelle,
    "",
    `📈 Ce que le moteur émet en ce moment (mesuré le ${TREND_FILTER_STATUS.measuredOn}) :`,
    "Le filtre de tendance est ouvert : les trois moteurs directionnels — force relative, cassure de canal, " +
      "expansion de volatilité — émettent, et le carry de financement avec eux. Le momentum 4H, lui, ne " +
      `travaille QUE quand le marché baisse : il se tait en ce moment. Rythme mesuré : ${DEBIT.favorable} ` +
      "signaux par jour.",
    `Le filtre peut se refermer n'importe quand — il l'est ${PART_FILTRE_FERME} du temps. Ce jour-là, les ` +
      `trois directionnels se tairont, et le carry et le momentum 4H prendront le relais à ` +
      `${DEBIT.defavorable} signaux par jour.`,
  ];
}

/**
 * Compte les signaux réellement délivrés à CET abonné (signal_deliveries), pas
 * un agrégat global : c'est la seule mesure qui lui appartienne. Toute erreur
 * de lecture est avalée — /status doit rester capable d'annoncer l'essentiel
 * (plan et échéance) même si cette requête échoue.
 */
async function buildDeliveryLine(env: Env, telegramId: number): Promise<string> {
  try {
    const deliveries = await getUserSignalHistory(dbConfig(env), telegramId, MAX_SIGNALS);
    if (deliveries.length === 0) {
      return (
        "📬 Signaux reçus : aucun pour l'instant.\n" +
        `Sur 6 ans, ${PART_JOURS_AVEC_SIGNAL} des jours comportent au moins un signal — mais ça reste une ` +
        "moyenne, pas une garantie sur une période courte."
      );
    }
    const open = deliveries.filter((delivery) => delivery.signals && delivery.signals.outcome === null).length;
    return (
      `📬 Signaux reçus : ${deliveries.length} (dont ${open} encore en cours).\n` +
      "Le détail est dans /history, ton bilan chiffré dans /myperformance."
    );
  } catch (err) {
    console.error("[status] Lecture des signaux délivrés impossible:", err);
    return "📬 Signaux reçus : indisponible pour le moment. Réessaie dans quelques minutes, ou consulte /history.";
  }
}

/**
 * Aucun accès en cours. Trois situations très différentes se cachaient derrière
 * le même « aucun abonnement actif » : jamais rien eu, essai déjà consommé, ou
 * accès arrivé à échéance. Les distinguer évite d'envoyer quelqu'un vers /trial
 * alors qu'il l'a déjà utilisé, et permet de dire à un ancien abonné qu'il a
 * simplement expiré — pas qu'il a été coupé.
 */
async function buildInactiveMessage(env: Env, user: UserRecord): Promise<string> {
  const expired = user.expiration ? new Date(user.expiration) : null;
  const header =
    expired && expired.getTime() <= Date.now()
      ? `⌛ Ton accès a expiré le ${expired.toLocaleString("fr-FR")}. Rien n'a été coupé : un abonnement ici s'arrête tout seul à échéance, il n'y a jamais rien à résilier.`
      : "❌ Aucun accès actif pour le moment.";

  const cta = user.trial_used
    ? "Ton essai gratuit a déjà été utilisé. /subscribe affiche les offres — et l'avertissement complet avant tout paiement."
    : "Tu n'as pas encore utilisé ton essai gratuit : /trial le déclenche, 3 jours, sans carte bancaire ni adresse crypto.";

  return [
    header,
    "",
    cta,
    "",
    ...(await buildEngineStateLines(env)),
    "",
    "Pour voir avant de décider : /demo montre la forme exacte des signaux, /marche donne l'état du marché recalculé en direct.",
  ].join("\n");
}

/**
 * Le bouton qui manquait.
 *
 * Quelqu'un dont l'accès vient d'expirer tape /status plus souvent que
 * n'importe quelle autre commande, et il tombait sur un nom de commande à
 * recopier. Le bouton dépend de sa situation : un essai jamais utilisé mène à
 * l'essai, tout le reste mène au tunnel d'abonnement.
 *
 * Un abonné payant en cours n'a AUCUN bouton. Lui en montrer un reviendrait à
 * lui vendre ce qu'il a déjà, et /status est la commande qu'il consulte quand
 * il se demande si le service fonctionne — pas le moment de lui parler prix.
 */
function buildStatusKeyboard(user: UserRecord, active: boolean): InlineKeyboard | undefined {
  if (active && user.plan !== 0) return undefined;
  if (!user.trial_used) return [[{ text: "🎁 Essai gratuit — 3 jours", callback_data: "start:trial" }]];
  return [[{ text: "⭐ Voir les offres", callback_data: "start:subscribe" }]];
}

export async function handleStatusCommand(env: Env, telegramId: number): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);

  if (!isSubscriptionActive(user)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, await buildInactiveMessage(env, user), {
      keyboard: buildStatusKeyboard(user, false),
    });
    return;
  }

  const expirationDate = new Date(user.expiration as string);
  const badge = getLoyaltyBadge(user);
  const deliveryLine = await buildDeliveryLine(env, telegramId);
  const aVie = user.plan === LIFETIME_PLAN;

  const lines: Array<string | null> = [
    `✅ Accès actif — ${planLabel(user)}`,
    // Un accès à vie affichait « il te reste 36 500 jours, jusqu'au
    // 12/07/2126 ». C'est la façon la plus sûre de faire passer un accès
    // définitif pour un bug d'affichage.
    aVie
      ? "♾️ Pas d'échéance : cet accès est définitif. Rien à renouveler, jamais."
      : `⏳ Il te reste ${formatRemaining(expirationDate.getTime() - Date.now())}, jusqu'au ${expirationDate.toLocaleString("fr-FR")}.`,
    badge,
    "",
    deliveryLine,
    "",
    ...(await buildEngineStateLines(env)),
    "",
    aVie
      ? null
      : user.plan === 0
        ? "À la fin de l'essai, l'accès s'arrête tout seul — aucun prélèvement, rien à résilier. /subscribe si tu veux continuer."
        : "Aucun prélèvement automatique : ton accès s'arrête tout seul à échéance. /subscribe pour prolonger quand tu le souhaites.",
    "",
    "⚠️ Signaux informatifs — ni conseil en investissement, ni promesse de gain.",
  ];

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    lines.filter((line): line is string => line !== null).join("\n"),
    { keyboard: buildStatusKeyboard(user, true) }
  );
}
