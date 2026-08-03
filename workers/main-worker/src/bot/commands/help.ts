import { Env } from "../../env";
import { sendMessage } from "../../telegram";
import { TREND_FILTER_STATUS } from "./subscribe";

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
 * fonctionnement, et le fonctionnement a changé de nature (signaux journaliers
 * tenus 7 jours, et surtout aucun signal en marché baissier). Quelqu'un qui
 * tape /help après plusieurs jours sans rien recevoir cherche cette
 * explication-là, pas la liste.
 */
export async function handleHelpCommand(env: Env, telegramId: number): Promise<void> {
  // Constat daté repris de TREND_FILTER_STATUS (commands/subscribe.ts) : aucune
  // valeur réécrite ici, sinon elle survivrait à la bascule du filtre. Ni
  // `detail` ni `measuredOn` ne contiennent de caractère à échapper en Markdown.
  const filterState = TREND_FILTER_STATUS.closed
    ? `Au ${TREND_FILTER_STATUS.measuredOn} ce filtre est FERMÉ (${TREND_FILTER_STATUS.detail}) : rien ne sera envoyé jusqu'à ce qu'il repasse au-dessus.`
    : `Au ${TREND_FILTER_STATUS.measuredOn} ce filtre est ouvert, mais il peut se refermer sans préavis.`;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📖 *Commandes disponibles*\n\n" +
      "*Comment fonctionne le bot*\n" +
      "Aucun signal n'est émis tant que le Bitcoin reste sous sa moyenne mobile 200 jours — sur 6 ans, c'est 41 % du temps. " +
      "Quand ce filtre est ouvert : 8,0 signaux par semaine en moyenne, tenus 7 jours, avec une sortie à la date plutôt qu'à un objectif de prix.\n" +
      `${filterState} Le détail est dans /faq.\n\n` +
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
      "/history — tes 5 derniers signaux reçus et leur résultat\n" +
      "/myperformance — ton bilan personnel complet (taux de réussite, cumul, badge)\n" +
      "/guide — comment suivre un signal pas à pas\n" +
      "Pas de signal depuis plusieurs jours ? C'est probablement le filtre de tendance, pas une panne — voir /faq.\n\n" +
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
      "/faq — pourquoi aucun signal en ce moment, combien de temps ça dure, ce qui a changé\n" +
      "/help — cette liste",
    { markdown: true }
  );
}
