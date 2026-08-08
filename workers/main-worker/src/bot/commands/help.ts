import { Env } from "../../env";
import { sendMessage } from "../../telegram";
import { TREND_FILTER_STATUS } from "./subscribe";
import { DEBIT, PART_FILTRE_FERME, PART_JOURS_AVEC_SIGNAL } from "../../publishedStats";

/**
 * Audit#8 : liste centralisée des commandes — 13 commandes existaient sans qu'aucune ne les récapitule.
 *
 * Envoyé en Markdown (legacy) : contrairement à /faq, ce message est une liste
 * courte et maîtrisée, où le gras sépare les rubriques. Contrepartie stricte :
 * tout `_` doit être échappé (`\\_` dans le littéral TS) et les `*` restent
 * appariés, sinon Telegram répond « can't parse entities » et le message
 * entier n'est jamais délivré (bug vécu le 29/07). Pas de crochets ni
 * d'accents graves ici pour la même raison.
 *
 * Bloc d'en-tête ajouté le 03/08/2026 : une liste de commandes ne dit rien du
 * fonctionnement, et quelqu'un qui tape /help après plusieurs jours sans rien
 * recevoir cherche cette explication-là, pas la liste.
 *
 * Réécrit le 04/08/2026 (passage à plusieurs familles de signaux ; elles sont
 * cinq depuis l'ajout du momentum 4H le 07/08/2026). L'en-tête précédent
 * décrivait un bot à une seule famille et affirmait qu'AUCUN signal
 * n'était émis sous la moyenne 200 jours : c'est devenu faux le jour où le
 * carry de financement est entré en service, puisqu'il n'est pas soumis à ce
 * filtre. Une personne qui recevait des carrys en marché baissier aurait lu ici
 * que le bot ne peut rien envoyer — exactement le genre de contradiction qui
 * fait douter du reste. Le carry occupe donc le haut de l'en-tête : c'est à la
 * fois ce qui a le plus changé et ce qu'un lecteur a le plus de raisons
 * d'ignorer, puisqu'il n'existe nulle part ailleurs.
 *
 * Le rythme vient de publishedStats.ts et n'est plus recopié ici : les chiffres
 * précédents avaient été mesurés à deux moteurs et ne décrivaient plus le
 * produit à cinq. Ce module documente lesquels et pourquoi.
 */
export async function handleHelpCommand(env: Env, telegramId: number): Promise<void> {
  // Constat daté repris de TREND_FILTER_STATUS (commands/subscribe.ts) : aucune
  // valeur réécrite ici, sinon elle survivrait à la bascule du filtre. Ni
  // `detail` ni `measuredOn` ne contiennent de caractère à échapper en Markdown.
  //
  // Formulation revue avec l'arrivée du carry : filtre fermé ne veut plus dire
  // « plus rien n'arrive », mais « plus rien de directionnel n'arrive ».
  const filterState = TREND_FILTER_STATUS.closed
    ? `Au ${TREND_FILTER_STATUS.measuredOn} ce filtre est FERMÉ (${TREND_FILTER_STATUS.detail}) : seuls des carrys et des signaux momentum 4H peuvent encore partir.`
    : `Au ${TREND_FILTER_STATUS.measuredOn} ce filtre est ouvert, mais il peut se refermer sans préavis.`;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📖 *Commandes disponibles*\n\n" +
      "*Comment fonctionne le bot*\n" +
      "Cinq moteurs, tous mesurés sur 6 ans de données et comparés à un tirage aléatoire pour " +
      "vérifier qu'ils ne doivent rien au hasard. Trois achètent une hausse en marché porteur : la " +
      "FORCE RELATIVE (les cryptos les plus fortes du moment), la CASSURE DE CANAL (franchissement du " +
      "plus haut 50 jours) et l'EXPANSION DE VOLATILITÉ (réveil après compression). Le CARRY DE " +
      "FINANCEMENT ne parie pas sur le prix du tout. Le MOMENTUM 4H ne travaille QUE quand le marché " +
      "baisse — il est en observation, et chacun de ses signaux le dit.\n\n" +
      "*Le carry de financement, en deux phrases*\n" +
      "Achat au comptant et vente à découvert du perpétuel, même montant : les deux jambes s'annulent, " +
      "donc le prix n'entre pas dans l'équation. Ce que tu encaisses, c'est le financement que les " +
      "acheteurs de perpétuels versent aux vendeurs toutes les 8 heures. Sur 6 ans : 84,2 % de positions " +
      "gagnantes et +0,572 % net par position. Ce n'est pas sans risque pour autant — la jambe vendeuse " +
      "peut être liquidée si ta marge devient insuffisante, il reste un risque de plateforme, et une " +
      "journée de financement extrême a déjà coûté -19,86 % sur une position.\n\n" +
      "*Le rythme*\n" +
      `${DEBIT.moyenne} signaux par jour en moyenne : ${DEBIT.favorable} quand le marché est porteur, ` +
      `${DEBIT.defavorable} quand il ne l'est pas. ${PART_JOURS_AVEC_SIGNAL} des jours ont au moins un ` +
      "signal.\n\n" +
      "*Le silence*\n" +
      "Les trois moteurs directionnels sont coupés tant que le Bitcoin reste sous sa moyenne mobile " +
      `200 jours — ${PART_FILTRE_FERME} du temps sur 6 ans, jusqu'à 381 jours d'affilée du 28/12/2021 au ` +
      "13/01/2023. Le carry, lui, n'est pas soumis à ce filtre, et le momentum 4H ne travaille QUE dans ce " +
      `régime : ce sont les deux moteurs qui produisent en marché baissier. ${filterState} ` +
      "Le détail est dans /faq, et /marche recalcule cet état en direct.\n\n" +
      "*À savoir avant de suivre les signaux directionnels*\n" +
      "Ils réussissent environ une fois sur deux, et le signal MÉDIAN perd 0,69 %. La rentabilité vient " +
      "d'une minorité de gros gagnants : il faut donc les prendre TOUS. En trier quelques-uns revient " +
      "statistiquement à ne garder que la partie perdante.\n\n" +
      "*Abonnement*\n" +
      "/subscribe — voir les offres et s'abonner\n" +
      "/trial — essai gratuit de 3 jours (une fois par wallet)\n" +
      "/status — vérifier ton abonnement en cours\n" +
      "/pay — rappeler le paiement en attente\n" +
      "/check\\_payment — vérifier l'état de ton dernier paiement\n" +
      "/guide\\_paiement — comment payer pas à pas (réseaux, pièges, délais)\n" +
      "/code CODE — appliquer un code promo\n" +
      "/cancel — arrêter les relances (ton accès déjà payé reste valable jusqu'à expiration)\n\n" +
      "*Signaux*\n" +
      "/demo — voir un exemple de signal (issu du backtest)\n" +
      "/marche — l'état du filtre de tendance recalculé en direct\n" +
      "/history — tes 5 derniers signaux reçus et leur résultat\n" +
      "/myperformance — ton bilan personnel complet (taux de réussite, cumul, badge)\n" +
      "/guide — comment suivre un signal pas à pas\n" +
      "Pas de signal directionnel depuis plusieurs jours ? C'est probablement le filtre de tendance, pas une panne — voir /marche.\n\n" +
      "*Parrainage*\n" +
      "/referral — ton lien de parrainage et ta progression\n\n" +
      "*Groupe VIP*\n" +
      "/vip — lien du canal privé (réservé aux abonnés payants)\n\n" +
      "*Confiance*\n" +
      "/trust — nombre réel d'abonnés payants actifs, en direct\n" +
      "/review — laisser une note rapide (👍/👎) et un commentaire anonyme\n\n" +
      "*Préférences*\n" +
      "/prefs — choisir les notifications reçues en plus des signaux\n\n" +
      "*Tes données*\n" +
      "/delete\\_my\\_data — supprimer tes données personnelles (RGPD)\n\n" +
      "*Aide*\n" +
      "/faq — pourquoi le bot se tait parfois, combien de temps ça dure, ce qui a changé\n" +
      "/help — cette liste",
    { markdown: true }
  );
}
