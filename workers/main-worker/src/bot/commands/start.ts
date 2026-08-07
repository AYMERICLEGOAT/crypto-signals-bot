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
 * Le carry de financement occupe la moitié du deuxième message. C'est la seule
 * famille dont le résultat ne dépend pas du prix, et la mieux établie des deux
 * qui produisent en marché baissier — l'autre étant le momentum 4H, encore en
 * observation. Elle n'était mentionnée nulle part dans le bot — alors
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
  // Le clavier vient de keyboards.ts et n'est pas réécrit ici : la règle
  // « pas d'essai proposé à un abonné payant » doit rester à un seul endroit.
  const message1Keyboard: InlineKeyboard = buildStartMessage1Keyboard(showTrial);

  // MESSAGE 1 — CINQ SECONDES, PAS PLUS.
  //
  // Il faisait 1 500 caractères et contenait le débit mesuré, quatre arguments
  // de différenciation et une invitation. Tout y était vrai et tout y était
  // utile — mais pas là. Un premier écran qui demande une minute de lecture
  // n'est pas lu : il est balayé, et la seule chose qui reste est l'impression
  // d'un mur de texte. Ce qui suit tient en quatre lignes et répond aux trois
  // seules questions du premier instant : c'est quoi, ça donne quoi, et qu'est-ce
  // que je fais maintenant.
  //
  // La contrainte du produit (le silence en marché baissier) figure dès cette
  // ligne. Ce n'est pas de la prudence juridique : c'est l'argument. Un canal
  // qui se tait est exactement ce qui le distingue des dizaines d'autres, et le
  // dire d'entrée transforme la principale objection en promesse.
  //
  // Envoyé sans parse_mode, comme tout ce fichier : les textes contiennent des
  // %, des tirets, des parenthèses et des slashs de commandes qui ont déjà fait
  // tomber des messages Markdown sur ce projet.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📊 Des signaux d'achat crypto, en français, sur Telegram.\n\n" +
      "Environ 3 par jour : paire, prix d'entrée, stop, objectifs. Tu recopies, c'est tout.\n\n" +
      "Et quand le marché ne s'y prête pas, on se tait plutôt que d'inventer des trades.\n\n" +
      "👇 Regarde à quoi ressemble un vrai signal — ça ne demande rien.",
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
      "moteur directionnel (la force relative) est donc " +
      "à l'arrêt, et le resteront tant que cette moyenne n'aura pas été repassée — ça peut durer des " +
      "semaines ou des mois. Deux familles continuent pendant ce temps : le carry, qui n'est pas coupé " +
      "par ce filtre, et le momentum 4H, qui ne travaille QUE dans ce régime — il est en observation, " +
      "et chacun de ses signaux le dit."
    : `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre de tendance est ouvert : les familles ` +
      "directionnelles émettent. Il peut se refermer sans préavis — elles s'arrêteront alors, et le " +
      "relais passera au carry et au momentum 4H.";

  await sleep(MESSAGE_2_DELAY_MS);

  // MESSAGE 2 — POURQUOI CE SERAIT CRÉDIBLE.
  //
  // Le carry occupe la moitié de ce message parce que c'est la seule chose
  // vraiment singulière à raconter : une position dont le résultat ne dépend
  // pas du prix. C'est aussi la seule réponse tenable à quelqu'un qui arrive un
  // jour où le filtre est fermé.
  //
  // Ses risques sont écrits dans le MÊME message que ses résultats, jamais plus
  // bas. Les séparer recréerait le mécanisme du « 61,2 % de réussite » resté
  // affiché à tort pendant des mois.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🔍 POURQUOI CE N'EST PAS UN CANAL DE PLUS\n\n" +
      "• Chaque chiffre vient d'un test sur 6 ans, comparé à un tirage aléatoire pour vérifier qu'il ne " +
      "doit rien au hasard. Sur douze approches essayées, deux ont été retenues.\n" +
      "• Les pertes sont publiées comme les gains, sur le canal gratuit. Rien n'est effacé.\n" +
      "• Le silence a occupé 41 % du temps sur 6 ans, dont une fois 381 jours d'affilée. C'est écrit " +
      "ici, avant que tu paies quoi que ce soit.\n\n" +
      "💵 ET UNE POSITION OÙ LE PRIX N'A AUCUNE IMPORTANCE\n\n" +
      "Tu achètes au comptant, et tu vends à découvert le même montant en perpétuel. Les deux jambes " +
      "s'annulent : si le prix monte, l'une gagne ce que l'autre perd. Ce que tu encaisses, c'est le " +
      "financement que les acheteurs de perpétuels versent aux vendeurs toutes les 8 heures.\n\n" +
      "Sur 6 ans, frais déduits : 84,2 % de positions gagnantes, 6 années positives sur 7.\n\n" +
      "Ce n'est pas sans risque, et personne ne devrait te dire le contraire : ta jambe vendeuse peut " +
      "être liquidée si ta marge devient insuffisante, et la pire position mesurée a perdu 19,86 %.\n\n" +
      `${filterState}`,
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

  // MESSAGE 3 — ESSAYER, VÉRIFIER, EN PARLER.
  //
  // La phrase finale sur le signal médian perdant est la plus importante de
  // toute la séquence, et c'est pour cela qu'elle arrive en dernier : lue au
  // premier écran, elle serait prise pour un aveu de faiblesse ; lue ici, après
  // la méthode et les chiffres, elle se lit pour ce qu'elle est — la façon dont
  // fonctionne réellement une stratégie de momentum, et la raison pour laquelle
  // trier les signaux détruit le résultat.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🎁 TROIS FAÇONS D'ESSAYER SANS PAYER\n\n" +
      "1. /demo — un vrai signal, en entier, immédiatement.\n\n" +
      `${channelStep}

` +
      "3. /trial — 3 jours complets et gratuits. Deux conditions : avoir rejoint le canal public (ou " +
      "parrainé une personne), et me donner une adresse de wallet Polygon, uniquement pour qu'un même " +
      "wallet ne réclame pas dix essais. Aucun paiement, aucune carte bancaire, aucune adresse e-mail.\n\n" +
      "🤝 ET SI TU CONNAIS QUELQU'UN\n" +
      "/referral te donne un lien personnel. Chaque personne qui s'abonne via ce lien t'offre des jours " +
      "d'accès gratuits, et lui donne une remise. Rien à installer, rien à déclarer.\n\n" +
      "🔎 POUR VÉRIFIER PAR TOI-MÊME\n" +
      "/marche — l'état du marché recalculé en direct, pas un chiffre saisi à la main.\n" +
      "/faq — pourquoi le bot se tait parfois, et combien de temps ça dure.\n" +
      "/help — toutes les commandes.\n\n" +
      "⚖️ Une dernière chose, parce qu'elle décide de tout le reste : les signaux directionnels " +
      "réussissent environ une fois sur deux, et le signal MÉDIAN perd 0,69 %. Le gain vient d'une " +
      "minorité de très gros gagnants. Il faut donc les prendre TOUS — en trier quelques-uns revient " +
      "statistiquement à ne garder que la partie perdante.",
    { keyboard: buildStartMessage3Keyboard(showTrial) }
  );
}
