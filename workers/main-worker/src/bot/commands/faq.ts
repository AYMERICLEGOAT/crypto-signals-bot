import { Env } from "../../env";
import { sendMessage } from "../../telegram";
import { TREND_FILTER_STATUS } from "./subscribe";
import { DEBIT, PART_FILTRE_FERME } from "../../publishedStats";

/**
 * /faq — répond aux OBJECTIONS, pas aux questions confortables.
 *
 * Motif (audit du 01/08/2026) : le bot avait 22 commandes, dont aucune ne
 * traitait les deux questions que se pose réellement toute personne qui
 * découvre un service de signaux crypto — « est-ce une arnaque ? » et
 * « est-ce que je vais gagner de l'argent ? ». Dans un secteur où l'escroquerie
 * est la norme, la méfiance est le premier obstacle à la conversion, bien
 * avant le prix. /help liste les commandes ; il n'existait rien pour lever
 * ces objections.
 *
 * Parti pris : répondre franchement, y compris quand la réponse dessert
 * l'argumentaire commercial. Dire ouvertement ce qui est mesuré, y compris
 * quand c'est décevant, est à la fois la seule option honnête et, dans ce
 * marché précis, un argument différenciant : personne d'autre ne le fait.
 *
 * Mise à jour du 03/08/2026 (moteur Force Relative, voir
 * DECOUVERTE_FORCE_RELATIVE_2026-08-03.md) : les réponses décrivant l'ancien
 * moteur RSI bas étaient devenues fausses (rentabilité non démontrée sur
 * 24 mois, 2 à 3 signaux par jour, stop remonté au point d'entrée après le
 * premier objectif, clôture à 10 jours) et ont toutes été refaites. Quatre
 * questions ont été ajoutées en tête, dans l'ordre où un abonné se les pose
 * réellement aujourd'hui : pourquoi rien n'arrive, combien de temps ça dure,
 * ce qui a changé, et à quel rythme les signaux reviennent. Les chiffres
 * proviennent tous du backtest 6 ans, univers non contaminé, net de frais --
 * aucun n'est arrondi à l'avantage.
 *
 * Envoyé SANS markdown : le texte contient des caractères (%, parenthèses,
 * tirets, slashs de commandes) qui ont déjà cassé des messages Markdown sur
 * ce projet à plusieurs reprises. Le gain de mise en forme ne vaut pas le
 * risque d'un message entièrement non délivré.
 *
 * Envoyé en TROIS messages explicites : le texte dépasse les 4096 caractères
 * de Telegram, et le découpage automatique de splitMessage() coupe au dernier
 * saut de ligne disponible -- en pratique entre le titre d'une question et sa
 * réponse. Découper nous-mêmes sur une frontière de thème (« pourquoi ça se
 * tait » / « l'argent et la confiance » / « l'usage ») rend la coupure lisible
 * au lieu de la subir. splitMessage() reste le filet de sécurité.
 *
 * Le passage de deux à trois parties date du 08/08/2026 : la partie 2 avait
 * franchi la limite et produisait un fragment orphelin de 173 caractères.
 *
 * CORRECTION DU 08/08/2026, la plus importante de ce fichier. La réponse
 * « Combien de signaux par semaine » affirmait : « Quand il est fermé : zéro,
 * sans exception. » C'est la croyance exacte qui fait résilier, et elle est
 * fausse depuis la mise en service du momentum 4H, qui ne travaille QUE dans
 * ce régime. Le rythme hebdomadaire qui l'accompagnait décrivait en outre le
 * moteur à famille unique, retiré partout ailleurs mais survivant ici. Les
 * chiffres viennent désormais de publishedStats.ts.
 */
export async function handleFaqCommand(env: Env, telegramId: number): Promise<void> {
  const channel = env.TELEGRAM_CHANNEL_URL ?? "notre canal public";

  // Repris de TREND_FILTER_STATUS (commands/subscribe.ts) : constat daté, une
  // seule source à corriger le jour où le Bitcoin repasse au-dessus. Rendu en
  // deux lignes pour ne pas dépasser la largeur des autres lignes du bloc, qui
  // sont coupées à la main faute de mise en forme Markdown.
  const filterLines = TREND_FILTER_STATUS.closed
    ? [`Aujourd'hui encore c'est le cas : au ${TREND_FILTER_STATUS.measuredOn},`, `${TREND_FILTER_STATUS.detail}.`]
    : [`Ce n'était plus le cas au ${TREND_FILTER_STATUS.measuredOn}, dernier point`, "mesuré : des signaux partent à nouveau."];

  // Durée de la fermeture EN COURS : conditionnée au même drapeau, sinon la
  // phrase survivrait à la réouverture et deviendrait fausse toute seule. Elle
  // disparaît d'elle-même le jour où `closed` repasse à false.
  const currentClosureLines = TREND_FILTER_STATUS.closed
    ? [`Celle en cours a commencé le 03/11/2025 : au ${TREND_FILTER_STATUS.measuredOn},`, "elle durait depuis 273 jours."]
    : [];

  // Partie 1 : ce qui se passe MAINTENANT. Première parce que c'est la seule
  // chose que cherche quelqu'un qui n'a rien reçu depuis des jours.
  const silence = [
    "❓ QUESTIONS FRÉQUENTES (1/2) — pourquoi le bot se tait",
    "",
    "▸ Pourquoi je ne reçois aucun signal en ce moment ?",
    "Parce que le bot est volontairement à l'arrêt. Il n'émet rien tant que le",
    "Bitcoin reste sous sa moyenne mobile 200 jours.",
    ...filterLines,
    "Ce n'est ni une panne, ni un manque d'idées, ni un service qui t'a oublié.",
    "C'est la règle qui fait le plus gros du travail : sans elle, la stratégie",
    "n'est positive que 4 années sur 7 ; avec elle, aucune année perdante en",
    "6 ans. En 2022 et en 2026 elle n'a rien émis du tout, pendant que détenir",
    "les mêmes cryptos coûtait -70,9 % et -39,4 %.",
    "Un abonné qui s'ennuie nous convient mieux qu'un abonné qui perd.",
    "",
    "▸ Combien de temps ce silence peut-il durer ?",
    "Longtemps, et il vaut mieux le savoir avant de s'abonner qu'après.",
    `Sur les 6 dernières années, le filtre a été fermé ${PART_FILTRE_FERME} du temps. Il y a eu`,
    "11 fermetures d'au moins une semaine, dont la médiane est de 25 jours.",
    "Mais la plus longue a duré 381 jours, soit 12,7 mois d'affilée (du",
    "28/12/2021 au 13/01/2023).",
    ...currentClosureLines,
    "Personne ne peut annoncer la date de fin d'une fermeture : elle se termine",
    "quand le Bitcoin repasse au-dessus de sa moyenne 200 jours, pas à une date",
    "choisie par nous. Si payer pour un service qui peut ne rien émettre",
    "pendant des mois ne te convient pas, c'est parfaitement compréhensible —",
    "mieux vaut ne pas s'abonner.",
    "",
    "▸ Qu'est-ce qui a changé dans la stratégie ?",
    "Le moteur a été remplacé le 03/08/2026. L'ancien achetait quand le RSI",
    "était bas (sous 40). Mesuré sur 6 ans et 18 paires, c'est le sens",
    "PERDANT : de -24,9 % à +16,9 % par an selon les réglages, majoritairement",
    "négatif. Nous l'avons désactivé plutôt que de continuer à le diffuser à",
    "des abonnés payants.",
    "Le nouveau moteur fait l'inverse : il classe 40 paires par force relative",
    "(du momentum, rien de plus) sur des données journalières et achète les 12",
    "plus fortes. Aucune formule secrète là-dedans : un simple classement par",
    "rendement passé fait aussi bien.",
    "Et pour être clair sur l'origine du résultat : l'essentiel vient du filtre",
    "de tendance, pas du classement. Le classement n'ajoute qu'environ",
    "1,1 point d'espérance par signal.",
    "",
    "▸ Combien de signaux vais-je recevoir ?",
    `${DEBIT.favorable} par jour quand le filtre est ouvert, ${DEBIT.defavorable} quand il est fermé.`,
    "Fermé ne veut donc pas dire silence complet : les trois moteurs",
    "directionnels s'arrêtent, mais le carry de financement continue (il est",
    "neutre au marché) et le momentum 4 h ne travaille QUE dans ce régime.",
    "Ce qui change n'est pas le volume, c'est la NATURE de ce que tu reçois.",
    "Le momentum 4 h rend +0,805 % par signal sur 3 jours, soit 0,268 % par",
    "jour de capital immobilisé — environ neuf fois le carry sur cette même",
    "unité. C'est aussi celui dont l'historique est le plus court : il commence",
    "en 2023, il est positif trois années sur quatre et en recul sur la",
    "dernière, d'où un plafond de deux places par jour.",
    "Ce ne sont pas des quotas mais des moyennes constatées. Forcer des signaux",
    "pour tenir une promesse de fréquence est exactement ce que nous refusons",
    "de faire.",
    "",
    "Suite ci-dessous : l'argent et la confiance, puis l'usage au quotidien.",
  ].join("\n");

  // Partie 2 : la confiance et l'argent. Les objections historiques
  // (rentabilité, arnaque, taux de réussite) restent groupées et dans cet
  // ordre : c'est la progression logique quand la première partie a été lue.
  const service = [
    "❓ QUESTIONS FRÉQUENTES (2/3) — l'argent et la confiance",
    "",
    "▸ Est-ce que je vais gagner de l'argent ?",
    "Nous ne le promettons pas, et personne ne devrait vous le promettre.",
    "Le chiffre honnête est celui d'une personne qui commencerait à une date",
    "tirée au hasard. Mesuré sur 6 ans, net de frais :",
    "- après 3 mois : médiane 0,0 %, 43 % des entrées gagnantes, pire cas -49,0 %",
    "- après 6 mois : médiane +5,0 %, 53 % des entrées gagnantes, pire cas -61,7 %",
    "Le backtest de la force relative seule, lui, affiche +83,3 % par an avec",
    "une baisse maximale de -62,9 % en cours de route. Ce n'est PAS ce que touche",
    "un abonné : il suppose d'avoir pris tous les signaux depuis le premier",
    "jour, sans jamais en rater un ni s'arrêter pendant la baisse. Les deux",
    "lignes au-dessus décrivent bien mieux une expérience réelle.",
    "Et un backtest mesure le passé : il n'a pas démontré, et ne peut pas",
    "démontrer, ce que fera le marché demain.",
    "",
    "▸ Comment savoir que ce n'est pas une arnaque ?",
    "Trois vérifications que tu peux faire toi-même :",
    "1. Le code est public sur GitHub — la stratégie, les backtests, et même",
    "   les analyses qui ont conclu que notre ancien moteur était perdant.",
    "2. Les résultats sont publiés en entier, pertes comprises, sur le canal",
    `   public : ${channel}`,
    "3. Essai gratuit de 3 jours avec /trial, sans moyen de paiement demandé.",
    "Et l'indice le plus simple : une arnaque ne te préviendrait pas qu'elle",
    "n'émettra peut-être rien pendant plusieurs mois.",
    "",
    "▸ Pourquoi un taux de réussite ne suffit-il pas ?",
    "Parce qu'il ne dit rien de la rentabilité. Une stratégie qui gagne 7 fois",
    "sur 10, avec des gains de 1 € et des pertes de 3 €, fait +7 contre -9 sur",
    "10 trades : perdante, avec 70% de réussite. Ce qui compte est le taux de",
    "réussite ET le rapport entre gains et pertes moyens. Méfie-toi de tout",
    "service qui affiche l'un sans jamais mentionner l'autre.",
    "Le nôtre est de 48,3 % : moins d'un signal sur deux est gagnant, et nous",
    "l'écrivons plutôt que de le maquiller. Ce qui compte est l'écart entre les",
    "deux côtés : le signal médian PERD 0,49 %, mais la moyenne ressort à",
    "+2,83 % par signal net de frais — tout vient d'une minorité de gros",
    "gagnants. Mesuré sur les 40 paires réellement suivies, 2020-2026.",
    "",
    "▸ Combien ça coûte, et comment payer ?",
    "Mensuel : 19 USDT / 30 jours. Trimestriel : 45 USDT / 90 jours, soit",
    "15 par mois. Découverte : 5 USDT / 14 jours, en nombre limité, pour",
    "tester. Paiement en crypto uniquement (USDT sur Polygon,",
    "Litecoin, Monero) — pas encore de carte bancaire, autant le dire avant.",
    "Aucun prélèvement automatique : ça s'arrête tout seul à échéance.",
    "",
    "Suite ci-dessous : l'usage au quotidien.",
  ].join("\n");

  // Partie 3 : l'usage concret, une fois la décision prise.
  const usage = [
    "❓ QUESTIONS FRÉQUENTES (3/3) — l'usage au quotidien",
    "",
    "▸ Faut-il de l'expérience ?",
    "Pas pour lire un signal : un signal directionnel indique entrée, stop loss",
    "et jalons ; un carry indique ses deux jambes et sa date de clôture.",
    "Mais oui pour l'utiliser correctement — savoir calculer sa taille de",
    "position à partir de son stop est indispensable. /guide explique la",
    "marche à suivre pas à pas.",
    "",
    "▸ Que se passe-t-il après l'ouverture d'un signal ?",
    "La position est tenue puis clôturée à une DATE : 7 jours pour la force",
    "relative, la cassure de canal et l'expansion de volatilité, 3 jours pour",
    "le momentum 4 h, 21 jours pour un carry. La sortie est TEMPORELLE :",
    "c'est la date qui ferme le trade, pas un objectif de prix. Les paliers",
    "annoncés (4, 8 et 12 fois l'ATR) jalonnent la progression pour toi, ils ne",
    "déclenchent pas la clôture.",
    "Le stop est volontairement très large (4 fois l'ATR) : c'est une",
    "protection contre l'accident, elle ne se déclenche que dans environ 5 %",
    "des cas. Un stop serré coûte plus cher qu'il ne rapporte — il coupe des",
    "positions qui seraient revenues, c'est mesuré.",
    "Le suivi est automatique jusqu'à la clôture, avec une notification à",
    "chaque étape franchie.",
    "",
    "▸ Est-ce un conseil en investissement ?",
    "Non. C'est une information générale, diffusée à l'identique à tous les",
    "abonnés, sans tenir compte de ta situation, de tes objectifs ni de ta",
    "tolérance au risque. Le trading de cryptoactifs comporte un risque de",
    "perte en capital, y compris totale.",
    "",
    "▸ Comment arrêter ?",
    "Rien à résilier : sans prélèvement automatique, l'abonnement s'arrête",
    "seul. /cancel stoppe en plus les relances. /delete_my_data efface tes",
    "données personnelles immédiatement.",
    "",
    "Une question qui n'est pas ici ? /help liste toutes les commandes.",
  ].join("\n");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, silence);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, service);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, usage);
}
