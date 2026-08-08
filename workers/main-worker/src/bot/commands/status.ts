import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive, UserRecord } from "../../db/users";
import { getUserSignalHistory } from "../../db/history";
import { PLAN_NAMES, isValidPlan } from "../../payments/plans";
import { getLoyaltyBadge } from "../loyaltyBadge";
// Source unique de l'état du filtre de tendance (voir commands/subscribe.ts) :
// le redéclarer ici garantirait qu'une des deux copies devienne fausse.
import { TREND_FILTER_STATUS } from "./subscribe";

/**
 * /status — « où j'en suis ».
 *
 * Refonte du 04/08/2026. La version précédente tenait en deux lignes : plan et
 * date d'expiration. Correct, mais elle laissait sans réponse la question que
 * se pose réellement un abonné qui tape cette commande, et surtout celui qui la
 * tape parce qu'il n'a rien reçu depuis deux jours : « est-ce que ça marche ? »
 *
 * Elle répond donc maintenant à quatre choses : combien de temps il te reste,
 * ce que le moteur émet EN CE MOMENT (la force relative est
 * filtrées, le carry ne l'est pas), combien de signaux tu as reçus, et quoi
 * faire ensuite. Un abonné qui voit « 0 signal reçu » à côté de « filtre fermé,
 * le carry et le momentum 4H prennent le relais » comprend son silence ; le
 * même abonné sans cette
 * ligne conclut à une panne et ne renouvelle pas.
 *
 * Envoyé sans parse_mode, comme avant : le message contient des dates au format
 * français, des pourcentages et des tirets, et un seul caractère mal placé
 * ferait échouer le message ENTIER côté Telegram.
 */

// Assez large pour couvrir tout l'historique réaliste d'un abonné (même borne
// que /myperformance) sans avoir à paginer.
const MAX_SIGNALS = 500;

function planLabel(user: UserRecord): string {
  if (user.plan === 0) return "Essai gratuit";
  if (isValidPlan(user.plan as number)) return PLAN_NAMES[user.plan as 1 | 2 | 3];
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
 * reçu » se contredisent aux yeux de l'abonné. Le filtre ne commande que les
 * la force relative ; le carry de financement tourne dans les deux
 * régimes parce qu'il est neutre au marché.
 */
function buildEngineStateLines(): string[] {
  if (TREND_FILTER_STATUS.closed) {
    return [
      `🔻 Ce que le moteur émet en ce moment (mesuré le ${TREND_FILTER_STATUS.measuredOn}) :`,
      `Le filtre de tendance est fermé — ${TREND_FILTER_STATUS.detail}. La force relative ` +
        "(la force relative) est donc à l'arrêt : elle " +
        "achètent, et acheter ne paie pas dans ce régime.",
      "Le carry de financement, lui, continue : il est neutre au marché, donc jamais filtré. Rythme mesuré sur " +
        "6 ans dans ce régime : 1,15 signal par jour en moyenne.",
      "Le momentum 4H l'accompagne, et lui ne travaille QUE dans ce régime : il classe les cryptos entre elles " +
        "sur des bougies de 4 heures et achète les deux plus fortes, tenues 3 jours. Il est en observation — " +
        "mesuré positif trois années sur quatre, en recul sur la dernière — et chacun de ses signaux le dit.",
      "Si tu ne reçois que ces deux-là en ce moment, ce n'est pas une panne : c'est le fonctionnement prévu.",
    ];
  }
  return [
    `📈 Ce que le moteur émet en ce moment (mesuré le ${TREND_FILTER_STATUS.measuredOn}) :`,
    "Le filtre de tendance est ouvert : la force relative et le carry de financement émettent. Le " +
      "momentum 4H, lui, ne travaille QUE quand le marché baisse : il se tait en ce moment. Rythme mesuré " +
      "sur 6 ans dans ce régime : 4,35 signaux par jour.",
    "Le filtre peut se refermer n'importe quand. Ce jour-là, les trois premières se tairont et le carry " +
      "continuera seul, à 1,15 signal par jour en moyenne.",
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
        "Sur 6 ans, 80 % des jours comportent au moins un signal — mais ça reste une moyenne, pas une " +
        "garantie sur une période courte."
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
function buildInactiveMessage(user: UserRecord): string {
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
    ...buildEngineStateLines(),
    "",
    "Pour voir avant de décider : /demo montre la forme exacte des deux types de signal, /marche donne l'état du marché recalculé en direct.",
  ].join("\n");
}

export async function handleStatusCommand(env: Env, telegramId: number): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);

  if (!isSubscriptionActive(user)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, buildInactiveMessage(user));
    return;
  }

  const expirationDate = new Date(user.expiration as string);
  const badge = getLoyaltyBadge(user);
  const deliveryLine = await buildDeliveryLine(env, telegramId);

  const lines: Array<string | null> = [
    `✅ Accès actif — ${planLabel(user)}`,
    `⏳ Il te reste ${formatRemaining(expirationDate.getTime() - Date.now())}, jusqu'au ${expirationDate.toLocaleString("fr-FR")}.`,
    badge,
    "",
    deliveryLine,
    "",
    ...buildEngineStateLines(),
    "",
    user.plan === 0
      ? "À la fin de l'essai, l'accès s'arrête tout seul — aucun prélèvement, rien à résilier. /subscribe si tu veux continuer."
      : "Aucun prélèvement automatique : ton accès s'arrête tout seul à échéance. /subscribe pour prolonger quand tu le souhaites.",
    "",
    "⚠️ Signaux informatifs — ni conseil en investissement, ni promesse de gain.",
  ];

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.filter((line): line is string => line !== null).join("\n"));
}
