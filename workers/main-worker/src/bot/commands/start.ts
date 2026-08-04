import { Env, dbConfig } from "../../env";
import { InlineKeyboard, sendMessage } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive } from "../../db/users";
import { buildStartMessage1Keyboard, buildStartMessage2Keyboard, buildStartMessage3Keyboard } from "../keyboards";
import { attributeReferralIfNeeded } from "../referral";
import { TREND_FILTER_STATUS } from "./subscribe";
import { sleep } from "../../utils/sleep";

// Cumulés depuis l'appel de /start (pas l'un après l'autre) : +3s puis +10s
// au total, un rythme qui laisse le temps de lire chaque message sans faire
// attendre trop longtemps la suite. Le tout tourne dans le ctx.waitUntil()
// déjà posé par index.ts autour de routeUpdate() -- Telegram a déjà reçu son
// "ok" webhook, ces délais ne retardent donc rien côté Telegram.
const MESSAGE_2_DELAY_MS = 3_000;
const MESSAGE_3_DELAY_MS = 10_000;

// Délai de rediffusion sur le canal public, repris de
// cron/dispatchPublicChannel.ts::CHANNEL_DELAY_MINUTES. Annoncé ici comme un
// MINIMUM : les heures calmes (utils/quietHours.ts) peuvent repousser un signal
// détecté la nuit jusqu'à la réouverture du canal, et « différé de 30 minutes »
// serait alors faux de plusieurs heures pour qui compare les horodatages.
const PUBLIC_CHANNEL_DELAY_MINUTES = 30;

/**
 * Refonte UX du 01/08/2026 : l'ancien /start envoyait un seul message dense
 * (pitch + liste de 5 commandes + lien de parrainage + lien du journal).
 * Remplacé par une séquence de 3 messages courts et espacés dans le temps,
 * pensée pour être lue plutôt que survolée. La plomberie (3 envois, délais,
 * claviers cliquables) n'a pas bougé depuis.
 *
 * Réécriture du 04/08/2026 — motif, et il n'est pas cosmétique. Deux personnes
 * seulement ont ouvert ce bot depuis le lancement, dont l'administrateur : il
 * n'y a jamais eu de problème de conversion, il y a un problème de PREMIER
 * ÉCRAN. L'ancien texte ouvrait sur le filtre de tendance, c'est-à-dire sur ce
 * que le bot NE fait PAS, et n'expliquait nulle part ce qu'on reçoit
 * concrètement. Quelqu'un qui découvre le bot lisait trois paragraphes de
 * précautions avant de savoir qu'il s'agissait de signaux d'achat.
 *
 * L'ordre des trois messages suit donc les trois questions d'un visiteur, dans
 * l'ordre où il se les pose :
 *   1. qu'est-ce que je reçois concrètement ;
 *   2. pourquoi ce serait différent des dizaines d'autres canaux ;
 *   3. comment j'essaie tout de suite, gratuitement.
 *
 * Le carry de financement occupe tout le deuxième message. C'est la seule
 * famille dont le résultat ne dépend pas du prix, la seule qui produise en
 * marché baissier, et elle n'était mentionnée nulle part dans le bot — alors
 * que c'est de très loin ce qu'il y a de plus intéressant à raconter ici, et
 * la seule chose à dire à quelqu'un qui arrive un jour où le filtre est fermé.
 *
 * L'honnêteté n'est PAS retirée pour autant, elle est déplacée : le silence en
 * marché baissier reste annoncé avant tout paiement (messages 1 et 2), et les
 * risques du carry sont écrits dans le même message que ses résultats, pas
 * plus bas. Reléguer l'un ou l'autre recréerait le mécanisme du « 61,2 % de
 * réussite » resté affiché à tort pendant des mois.
 *
 * Tous les chiffres proviennent du backtest 6 ans validé avec témoin
 * aléatoire ; aucun n'est arrondi à l'avantage du produit.
 */
export async function handleStart(env: Env, telegramId: number, referralPayload?: string): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);
  await attributeReferralIfNeeded(env, telegramId, referralPayload);

  // plan 0 = essai déjà en cours (le proposer à nouveau ne changerait rien de
  // grave) ; plan 1/2/3 = abonnement payant actif, voir handleTrialCommand.
  const hasActivePaidPlan = isSubscriptionActive(user) && user.plan !== 0;
  const showTrial = !hasActivePaidPlan;

  // Le bouton « voir un vrai signal » passe DEVANT l'essai gratuit : c'est la
  // seule action du premier écran qui ne demande strictement rien (l'essai,
  // lui, suppose d'avoir rejoint le canal public et de fournir une adresse de
  // wallet — voir commands/trial.ts). Le clavier de l'essai reste construit par
  // buildStartMessage1Keyboard plutôt que réécrit ici, pour que la règle
  // « pas d'essai proposé à un abonné payant » reste à un seul endroit.
  const message1Keyboard: InlineKeyboard = [
    [{ text: "📈 Voir un vrai signal, tout de suite", callback_data: "start:demo" }],
    ...(buildStartMessage1Keyboard(showTrial) ?? []),
  ];

  // Envoyé sans parse_mode (comme tout ce fichier depuis l'origine) : les
  // textes contiennent des %, des tirets, des parenthèses et des slashs de
  // commandes qui ont déjà fait tomber des messages Markdown sur ce projet.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📊 Des signaux d'achat crypto, en français, directement sur Telegram.\n\n" +
      "CE QUE TU REÇOIS\n" +
      "Environ 3 signaux par jour : 2,99 en moyenne mesurée sur 6 ans, 4,35 quand le marché est porteur " +
      "et 1,15 quand il ne l'est pas. Chacun te donne la paire, le prix d'entrée, le stop et les " +
      "objectifs : tu n'as qu'à les recopier sur ta plateforme. 80 % des jours ont au moins un signal.\n\n" +
      "POURQUOI CE N'EST PAS UN CANAL DE PLUS\n" +
      "• Chaque chiffre écrit ici vient d'un test sur 6 ans de données, comparé à un tirage aléatoire " +
      "pour vérifier qu'il ne doit rien au hasard. Aucun n'est arrondi à notre avantage.\n" +
      // Formulé sur ce que le code fait RÉELLEMENT : cron/trackSignalOutcomes.ts
      // publie la clôture sur le canal gratuit pour tout signal qui y est passé,
      // et /history rend le résultat de chaque signal reçu, toutes familles
      // confondues. Promettre « chaque résultat sur le canal » serait faux pour
      // les carrys, dont le suivi (cron/trackCarryOutcomes.ts) part en privé.
      "• Les pertes sont annoncées comme les gains : la clôture est publiée sur le canal gratuit, et " +
      "ton /history te rend le résultat de chaque signal reçu. Rien n'est effacé.\n" +
      "• Quand le marché ne s'y prête pas, on se tait. Sur 6 ans, ce silence a occupé 41 % du temps, " +
      "dont une fois 381 jours d'affilée. C'est écrit ici, avant que tu paies quoi que ce soit.\n" +
      "• Et une famille de signaux gagne sans parier sur le prix, même quand tout baisse. C'est le " +
      "message juste après : c'est ce qu'il y a de plus intéressant ici.\n\n" +
      "POUR ESSAYER SANS RIEN DONNER\n" +
      "Le bouton ci-dessous te montre un vrai signal, en entier. Aucun compte, aucun paiement.",
    { keyboard: message1Keyboard }
  );

  // État du filtre repris de TREND_FILTER_STATUS (commands/subscribe.ts) plutôt
  // que réécrit ici : ce constat est daté à la main faute de source live, donc
  // le dupliquer garantirait qu'un des exemplaires devienne faux le jour de la
  // bascule. Les deux branches sont écrites pour que ce fichier reste juste
  // sans y retoucher quand `closed` repassera à false.
  //
  // Le nom des carrys ouverts du jour n'est volontairement PAS écrit ici : ce
  // serait vrai quelques jours, faux ensuite, et personne ne penserait à le
  // corriger. On dit ce qui est structurellement vrai — le carry n'est pas
  // coupé par ce filtre — et on renvoie vers /marche, qui recalcule en direct.
  const filterState = TREND_FILTER_STATUS.closed
    ? `Et ça tombe bien : au ${TREND_FILTER_STATUS.measuredOn}, ${TREND_FILTER_STATUS.detail}. Les trois ` +
      "autres familles de signaux (force relative, cassure de canal, expansion de volatilité) sont donc " +
      "à l'arrêt, et le resteront tant que cette moyenne n'aura pas été repassée — ça peut durer des " +
      "semaines ou des mois. Le carry, lui, n'est pas coupé par ce filtre : c'est aujourd'hui la seule " +
      "famille qui peut encore émettre."
    : `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre de tendance est ouvert : les quatre familles ` +
      "peuvent émettre. Il peut se refermer sans préavis — les trois familles directionnelles " +
      "s'arrêteront alors, le carry non.";

  await sleep(MESSAGE_2_DELAY_MS);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "💵 LA POSITION OÙ LE PRIX N'A AUCUNE IMPORTANCE\n\n" +
      "Tu achètes une crypto au comptant, et tu vends à découvert le même montant en contrat perpétuel. " +
      "Les deux jambes s'annulent : si le prix monte, l'une gagne exactement ce que l'autre perd. S'il " +
      "s'effondre, pareil. Le prix n'entre pas dans l'équation.\n\n" +
      "Alors d'où vient le gain ? Sur les perpétuels, les acheteurs versent un financement aux vendeurs " +
      "toutes les 8 heures. Comme tu es vendeur d'un côté, tu l'encaisses. C'est tout, il n'y a pas " +
      "d'indicateur secret là-dessous.\n\n" +
      "Ce que ça a donné sur 6 ans, frais déduits : 84,2 % de positions gagnantes, +0,572 % net par " +
      "position, et 6 années positives sur 7 — la septième, 2022, finit à -0,046 %, autrement dit à plat.\n\n" +
      "Ce n'est pas sans risque, et personne ne devrait te dire le contraire : ta jambe vendeuse peut " +
      "être liquidée si ta marge devient insuffisante, il reste un risque de plateforme, et une journée " +
      "de financement extrême a déjà coûté -19,86 % sur une position.\n\n" +
      `${filterState}\n\n` +
      "/marche te donne cet état recalculé en direct, à la seconde où tu le demandes.",
    { keyboard: buildStartMessage2Keyboard(showTrial) }
  );

  // Le canal public est la seule porte d'entrée qui ne demande vraiment RIEN.
  // L'essai gratuit, lui, suppose d'avoir rejoint ce canal (ou parrainé
  // quelqu'un) ET de fournir une adresse Polygon : le dire ici plutôt que de
  // laisser l'utilisateur le découvrir en cliquant évite le mur silencieux qui
  // fait fermer Telegram — et la raison de cette adresse (l'anti-abus) est plus
  // rassurante que la demande brute.
  const channelStep = env.TELEGRAM_CHANNEL_URL
    ? `2. Le canal public gratuit : ${env.TELEGRAM_CHANNEL_URL}\n` +
      `   Il reçoit les mêmes signaux, différés d'au moins ${PUBLIC_CHANNEL_DELAY_MINUTES} minutes, et leur résultat ensuite. ` +
      "Rien à donner, rien à installer, tu peux partir quand tu veux."
    : `2. Le canal public gratuit reçoit les mêmes signaux, différés d'au moins ${PUBLIC_CHANNEL_DELAY_MINUTES} minutes, ` +
      "et leur résultat ensuite. Rien à donner, rien à installer.";

  await sleep(MESSAGE_3_DELAY_MS - MESSAGE_2_DELAY_MS);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🎁 TROIS FAÇONS D'ESSAYER SANS PAYER\n\n" +
      "1. /demo — un vrai signal, en entier, immédiatement.\n\n" +
      `${channelStep}\n\n` +
      "3. /trial — 3 jours complets et gratuits. Deux conditions : avoir rejoint le canal public (ou " +
      "parrainé une personne), et me donner une adresse de wallet Polygon, uniquement pour qu'un même " +
      "wallet ne réclame pas dix essais. Aucun paiement, aucune carte bancaire, aucune adresse e-mail.\n\n" +
      "POUR VÉRIFIER PAR TOI-MÊME\n" +
      "/marche — l'état du marché recalculé en direct, pas un chiffre saisi à la main.\n" +
      "/faq — pourquoi le bot se tait parfois, combien de temps ça dure, ce qui a changé.\n" +
      "/help — toutes les commandes.\n\n" +
      "Une dernière chose, parce qu'elle décide de tout le reste : les signaux directionnels réussissent " +
      "environ une fois sur deux, et le signal MÉDIAN perd 0,69 %. Le gain vient d'une minorité de très " +
      "gros gagnants. Il faut donc les prendre TOUS — en trier quelques-uns revient statistiquement à ne " +
      "garder que la partie perdante.",
    { keyboard: buildStartMessage3Keyboard(showTrial) }
  );
}
