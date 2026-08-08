/**
 * Post « état du marché » du canal public : expliquer le silence plutôt que le
 * subir.
 *
 * Contexte (03/08/2026, remplacement du moteur). Le moteur Force Relative
 * n'émet AUCUN signal tant que le Bitcoin clôture sous sa moyenne mobile 200
 * jours. Ce filtre est fermé 41 % du temps, et la plus longue fermeture
 * observée en 6 ans a duré 381 jours — soit 12,7 mois pendant lesquels le
 * canal public n'a strictement rien à publier. Un canal muet pendant un an
 * meurt ; un canal qui EXPLIQUE son silence avec des chiffres mesurés fait au
 * contraire la démonstration de ce qu'il vend.
 *
 * Ce que ce module remplace. La version précédente publiait un texte unique,
 * identique tous les jours, qui se terminait par « Reste connecté, le prochain
 * signal arrivera dès qu'une vraie opportunité se présente ». Deux défauts
 * rédhibitoires dans une fermeture qui peut durer plus d'un an :
 *   1. il PROMET un signal à venir, alors que rien ne garantit une réouverture
 *      à court terme — sur 6 ans, une fermeture a duré 381 jours ;
 *   2. répété à l'identique 300 fois, il devient un bruit que le lecteur
 *      apprend à ignorer, puis une raison de quitter le canal.
 *
 * D'où : 10 formulations tournantes, chacune enseignant quelque chose de
 * DIFFÉRENT (la règle, sa durée, ce qu'elle évite, ce qu'elle coûte, la
 * mécanique du moteur, l'expérience réelle d'un abonné…), et aucune promesse
 * de signal.
 *
 * Règle d'honnêteté appliquée ici, qui doit le rester. Le texte n'affirme que
 * ce qui est mesuré. L'état du marché est VÉRIFIÉ à chaque publication
 * (market/trendFilter.ts) au lieu d'être déduit de l'absence de signaux : sans
 * cette vérification, une panne du générateur serait publiquement expliquée
 * comme un marché baissier, ce qui serait faux. Quand l'état n'est pas
 * vérifiable, on bascule sur des formulations qui ne décrivent pas le marché.
 *
 * Aucun appel commercial n'est ajouté à ces posts, volontairement : vendre un
 * abonnement à un canal qui n'émet rien, dans le message qui explique
 * justement qu'il n'émet rien, est le contraire du positionnement du produit.
 * Le CTA existe déjà par ailleurs (cron/postChannelReminder.ts).
 */

import { Env, dbConfig } from "../env";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";
import { hasPostedNoSignalStatusToday, recordNoSignalStatusPost } from "../db/noSignalStatus";
import { hasRecentSignal } from "../db/signals";
import { getTrendFilterState } from "../market/trendFilter";
import { sendMessage } from "../telegram";
import { DEBIT } from "../publishedStats";
import { isQuietHours } from "../utils/quietHours";

// Doit rester aligné sur signals/config.py::PAIRS. Le texte annonçait
// encore 28 paires alors que le moteur en surveille 40 depuis le 31/07 --
// annoncer moins que la réalité dessert le service, et l'écart réapparaît
// dès qu'on écrit le nombre en dur dans une phrase.
const WATCHED_PAIRS_COUNT = 40;

const LOOKBACK_HOURS = 24;

/** Format français à la décimale près, sans jamais arrondir à l'avantage. */
function pct(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

const DISCLAIMER =
  "⚠️ Chiffres mesurés sur 6 ans (2020-2026), net de frais. " +
  "Performance passée ne garantit pas les résultats futurs. Pas un conseil en investissement.";

interface ClosedContext {
  /** Écart sous la moyenne 200 jours, en valeur absolue (%). */
  gapBelow: number;
  /** Durée de la fermeture en cours, `null` si l'historique ne permet pas de la mesurer. */
  closedDays: number | null;
}

/**
 * Formulations utilisées quand le filtre est VÉRIFIÉ fermé.
 *
 * Chacune doit rester autonome (un lecteur n'en voit qu'une) et n'utiliser que
 * des chiffres mesurés. Interdits ici, pour mémoire : présenter le +83,3 %/an
 * du portefeuille simulé comme ce que gagnera un abonné, laisser croire que le
 * RSI est un ingrédient magique, ou masquer que le filtre fait la majeure
 * partie du travail.
 */
const CLOSED_VARIANTS: ((ctx: ClosedContext) => string)[] = [
  // 1. La règle, dans sa forme la plus simple.
  (ctx) =>
    [
      "📉 *Pourquoi le canal n'émet rien en ce moment*",
      "",
      `Le Bitcoin clôture ${pct(ctx.gapBelow)} % sous sa moyenne mobile 200 jours.`,
      "Tant que c'est le cas, les trois moteurs directionnels n'émettent aucun achat. Aucune exception, aucun signal « quand même ».",
      "",
      "Deux moteurs continuent pourtant de travailler dans ce régime : le carry de financement, neutre au marché, et le momentum 4H. Si tu ne vois rien aujourd'hui, c'est qu'eux non plus n'ont rien trouvé qui vaille la peine.",
      "",
      "Ce filtre est fermé 41 % du temps. Ce n'est pas une panne : c'est la règle qui tourne.",
    ].join("\n"),

  // 2. La durée : désamorcer l'impatience avant qu'elle ne s'installe.
  () =>
    [
      "⏳ *Combien de temps un silence peut durer*",
      "",
      "La plus longue fermeture observée en 6 ans a duré 381 jours, soit 12,7 mois (du 28/12/2021 au 13/01/2023).",
      "Sur la même période : 11 fermetures d'au moins une semaine, d'une durée médiane de 25 jours.",
      "",
      "Une attente longue n'est donc pas un signe que quelque chose est cassé. C'est un état prévu.",
    ].join("\n"),

  // 3. Le bénéfice concret du silence, chiffré.
  () =>
    [
      "🛡️ *Ce que ce silence évite*",
      "",
      "En 2022, détenir les mêmes cryptos coûtait -70,9 %. En 2026, -39,4 %.",
      "Ces deux années-là, la force relative n'a tout simplement rien acheté.",
      "",
      "Le filtre ne rend pas les mauvaises années moins mauvaises : il en sort.",
    ].join("\n"),

  // 4. La comparaison avec/sans, qui justifie l'existence du filtre.
  () =>
    [
      "⚖️ *Pourquoi ce filtre existe*",
      "",
      "Sans lui, la stratégie n'est positive que 4 années sur 7.",
      "Avec lui, elle n'a aucune année perdante sur 6 ans.",
      "",
      "Il ne cherche pas à gagner davantage. Il cherche à ne pas jouer les manches perdantes.",
    ].join("\n"),

  // 5. L'aveu qui doit rester public : c'est le filtre, pas le classement.
  () =>
    [
      "🔍 *Ce qui fait vraiment le travail ici*",
      "",
      `Ce n'est pas le classement des ${WATCHED_PAIRS_COUNT} paires : il n'ajoute qu'environ 1,1 point.`,
      "L'essentiel du résultat vient de ne PAS être investi quand le Bitcoin est sous sa moyenne 200 jours.",
      "",
      "Autant le dire : il n'y a pas d'ingrédient secret. C'est du momentum, et un interrupteur.",
    ].join("\n"),

  // 6. À quoi ressemble l'ouverture — sans en promettre le retour.
  () =>
    [
      "📊 *À quoi ressemble une période d'ouverture*",
      "",
      `Quand le filtre est ouvert, le rythme mesuré est de ${DEBIT.favorable} signaux par jour.`,
      "Taux de réussite 48,3 %, espérance +2,83 % par signal net de frais.",
      "Gagnant moyen +16,88 %, perdant moyen -9,24 %.",
      "",
      "Plus d'un signal sur deux est perdant. Le résultat vient de l'écart entre gagnants et perdants, pas d'un taux de réussite élevé.",
    ].join("\n"),

  // 7. Le point de situation, avec la durée réelle de la fermeture en cours.
  (ctx) =>
    [
      "🗓️ *Où en est le marché*",
      "",
      ctx.closedDays !== null
        ? `Fermeture en cours depuis ${ctx.closedDays} jours. Le Bitcoin est ${pct(ctx.gapBelow)} % sous sa moyenne 200 jours.`
        : `Le Bitcoin est ${pct(ctx.gapBelow)} % sous sa moyenne 200 jours.`,
      "",
      "Repères sur 6 ans : 11 fermetures d'au moins une semaine, médiane 25 jours, la plus longue 381 jours.",
      "",
      "Le canal n'émettra rien tant que cette moyenne n'est pas franchie.",
    ].join("\n"),

  // 8. LE chiffre à mettre en avant : l'expérience réelle, pas le rendement annuel.
  () =>
    [
      "🎯 *Ce qu'un abonné peut réellement attendre*",
      "",
      "Pour une entrée à une date au hasard, mesuré sur 6 ans :",
      "• après 6 mois — médiane +5,0 %, 53 % des entrées gagnantes, pire cas -61,7 %",
      "• après 3 mois — médiane 0,0 %, 43 % des entrées gagnantes, pire cas -49,0 %",
      "",
      "Ce sont ces chiffres-là qui décrivent l'expérience réelle. Pas un rendement annuel de vitrine.",
    ].join("\n"),

  // 9. La mécanique, pour que le lecteur sache ce qu'il attend exactement.
  () =>
    [
      "⚙️ *Comment fonctionne le moteur, en clair*",
      "",
      `Il classe ${WATCHED_PAIRS_COUNT} paires par force relative sur données journalières, achète les 12 plus fortes et les tient 7 jours.`,
      "La sortie est temporelle, pas sur objectif de prix. Le stop, large (4x ATR), ne sert qu'à la catastrophe : il ne se déclenche que dans 5 % des cas.",
      "",
      "Et rien de tout cela ne tourne tant que le Bitcoin est sous sa moyenne 200 jours, ce qui représente 41 % du temps sur les 6 dernières années.",
    ].join("\n"),

  // 11. La distribution des gains. C'est la chose la plus importante à faire
  // comprendre à un abonné, et celle qu'un vendeur aurait le plus envie de
  // taire : le signal médian PERD de l'argent, et toute la rentabilité vient
  // d'une petite minorité de très gros gagnants. Quelqu'un qui trie les
  // signaux ne garde donc, statistiquement, que la partie perdante.
  () =>
    [
      "🎯 *Pourquoi il faut les prendre TOUS*",
      "",
      "Sur 6 ans, le signal médian de cette stratégie a perdu 0,69 %.",
      "La moyenne est pourtant de +2,83 %. Les deux sont vrais : une minorité de très gros gagnants apporte la totalité du gain. Sans eux, l'espérance devient négative.",
      "",
      "Concrètement : trier les signaux, n'en prendre que quelques-uns parce qu'ils « semblent » meilleurs, revient statistiquement à ne garder que la partie perdante.",
      "",
      "C'est aussi pour ça que le canal se tait 41 % du temps : le tri, c'est le filtre qui le fait, pas l'intuition.",
    ].join("\n"),

  // 10. Le choix assumé, pour que le silence soit lu comme une force.
  () =>
    [
      "🤐 *Ne rien émettre est une décision, pas un oubli*",
      "",
      "Il serait simple de publier un signal par jour pour occuper le canal.",
      "Mais un signal émis en marché baissier n'est pas un service rendu : c'est une perte transférée à celui qui le suit.",
      "",
      "Le filtre est fermé 41 % du temps. Sur ces périodes, ce canal reste silencieux — c'est exactement ce pour quoi il est conçu.",
    ].join("\n"),
];

/**
 * Formulations de repli, quand l'état du filtre n'a pas pu être vérifié.
 *
 * Elles ne décrivent JAMAIS le marché : affirmer « le Bitcoin est sous sa
 * moyenne » sans l'avoir mesuré serait une invention, et masquerait une panne
 * éventuelle du générateur derrière une explication rassurante.
 */
const UNVERIFIED_VARIANTS: (() => string)[] = [
  () =>
    [
      "📡 *Aucun signal aujourd'hui*",
      "",
      `La stratégie surveille ${WATCHED_PAIRS_COUNT} paires et n'émet que lorsque ses critères sont réunis.`,
      "Le premier d'entre eux est un filtre de tendance qui la met totalement hors marché 41 % du temps.",
      "",
      "Aucun signal n'est forcé pour faire du volume.",
    ].join("\n"),

  () =>
    [
      "📡 *Journée sans signal*",
      "",
      "Un jour sans signal n'est pas un incident : sur 6 ans, le filtre de tendance de la stratégie est resté fermé 41 % du temps, dont une période de 381 jours d'affilée.",
      "",
      "Le canal publie quand les critères sont réunis, et se tait le reste du temps.",
    ].join("\n"),
];

/**
 * Rotation déterministe sur le numéro de jour.
 *
 * Pas de tirage aléatoire (qui répéterait le même texte deux jours de suite) ni
 * de compteur en base (qui imposerait une migration pour un besoin que le
 * calendrier couvre déjà). 10 variantes et 7 jours de semaine étant premiers
 * entre eux, une même formulation ne retombe pas non plus sur le même jour de
 * la semaine.
 */
function pickIndex(length: number): number {
  return Math.floor(Date.now() / 86_400_000) % length;
}

export async function dispatchNoSignalStatus(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const db = dbConfig(env);
  if (await hasPostedNoSignalStatusToday(db)) return;
  if (await hasRecentSignal(db, LOOKBACK_HOURS)) return;

  // Vérifié seulement ici, une fois le reste des gates passé : inutile de
  // dépenser des sous-requêtes réseau sur les cycles où l'on ne publiera pas.
  const state = await getTrendFilterState();

  let body: string;
  if (state?.isClosed) {
    const ctx: ClosedContext = { gapBelow: Math.abs(state.gapPct), closedDays: state.closedDays };
    body = CLOSED_VARIANTS[pickIndex(CLOSED_VARIANTS.length)](ctx);
  } else {
    // Filtre ouvert mais aucun signal depuis 24h (creux normal : le moteur ne
    // tourne qu'une fois par jour et ne rouvre pas de position sur une paire
    // déjà détenue), ou état indéterminable. Dans les deux cas on ne raconte
    // pas le marché.
    body = UNVERIFIED_VARIANTS[pickIndex(UNVERIFIED_VARIANTS.length)]();
  }

  // Le régulateur décide si le canal peut parler maintenant (channelBudget.ts).
  const verdictBudget = await peutPublier(db, "public", "quotidien");
  if (!verdictBudget.autorise) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), `${body}\n\n${DISCLAIMER}`, {
    markdown: true,
  });
  await enregistrerEnvoi(db, "public", "quotidien", "aucun-signal");
  await recordNoSignalStatusPost(db);
}
