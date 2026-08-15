import { Env } from "../../env";
import { sendMessage } from "../../telegram";
import { DEBIT, CARRY_EN_SALVES, DEBIT_PAR_MOTEUR, MAX_PAR_JOUR, PART_FILTRE_FERME } from "../../publishedStats";

/**
 * Montre la FORME réelle des signaux du moteur — désormais DEUX formes, pas une.
 *
 * Pourquoi cette commande ne tire plus d'exemple de backtest_trades : cette
 * table est remplie par signals/backtest.py, c'est-à-dire par l'ANCIEN moteur
 * (achat sur RSI bas, objectif de prix serré, ventes à découvert), désactivé
 * le 03/08/2026 après avoir été mesuré comme la jambe PERDANTE de la
 * stratégie. Afficher un de ces trades sous le titre « voici ce que vous
 * recevrez » montrerait la mauvaise géométrie — un objectif serré et un sens
 * de position que le nouveau moteur n'émet jamais.
 *
 * Ajout du 04/08/2026 : le CARRY de financement (voir signals/carry_engine.py).
 * Il est structurellement différent de tout le reste — deux jambes, neutre au
 * marché, aucun stop de prix, sortie à 21 jours — et c'est l'argument le plus
 * fort du produit : 84,2 % de positions gagnantes, et la mieux établie des deux
 * familles qui produisent quand le Bitcoin est sous sa moyenne 200 jours —
 * l'autre étant le momentum 4H, encore en observation. Un prospect qui lit
 * un /demo ne montrant qu'un achat directionnel repart avec l'idée que le
 * produit est un canal de signaux d'achat de plus. Les deux formes sont donc
 * montrées, dans cet ordre, et la géométrie du carry est décrite exactement
 * comme signalFormat.ts::buildCarryMessage l'enverra.
 *
 * Pourquoi aucun prix chiffré non plus : les niveaux d'un vrai signal se
 * déduisent de l'ATR de la paire (ou du financement observé) au moment de
 * l'émission, et ils changent donc à chaque signal. Inventer une entrée et un
 * ATR pour faire joli produirait des pourcentages qui se liraient comme une
 * promesse de gain. On montre la géométrie réellement utilisée et les
 * statistiques mesurées, rien de plus.
 *
 * Un seul message, volontairement : les contreparties (majorité de perdants,
 * silence directionnel, risque du carry) doivent rester dans le même écran que
 * les exemples. Découpé en deux envois, le second peut être ignoré — et c'est
 * toujours le second qui contient ce qui dérange.
 */
export async function handleDemoCommand(env: Env, telegramId: number): Promise<void> {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🎭 *EXEMPLE — les deux formes de signal*\n\n" +
      "Le moteur envoie deux choses très différentes. Autant les voir avant de t'abonner.\n\n" +
      "━━━━━━━━━━\n" +
      "*1. UN ACHAT — signal directionnel*\n\n" +
      "🟢 *ACHAT* sur une paire parmi les 12 plus fortes du moment\n" +
      "📈 Les 38 paires suivies sont classées par force relative, sur des bougies journalières. " +
      "On achète les 12 premières. C'est du momentum, pas un indicateur secret.\n\n" +
      "💵 Entrée : le cours à la clôture du jour\n" +
      "🛑 Stop : 4 x ATR sous l'entrée\n" +
      "🥇 Jalon 1 : 4 x ATR au-dessus de l'entrée\n" +
      "🥈 Jalon 2 : 8 x ATR\n" +
      "🥉 Jalon 3 : 12 x ATR\n" +
      "⏳ Sortie : *au bout de 7 jours*, au prix du marché\n\n" +
      "L'ATR mesure l'amplitude habituelle des variations de la paire : chaque signal a donc ses propres " +
      "niveaux, à l'échelle de sa volatilité.\n\n" +
      "La sortie est TEMPORELLE : ce sont les 7 jours qui ferment la position, pas un objectif de prix. " +
      "Les jalons servent à suivre la progression. Et le stop est volontairement très large — ce n'est pas " +
      "une gestion fine, c'est une protection catastrophe.\n\n" +
      "Ce moteur se tait dès que le Bitcoin passe sous sa moyenne 200 jours, ce qui arrive " +
      `${PART_FILTRE_FERME} du temps (la plus longue fermeture a duré 381 jours, du 28/12/2021 au 13/01/2023).\n\n` +
      "━━━━━━━━━━\n" +
      "*2. UN CARRY DE FINANCEMENT — neutre au marché*\n\n" +
      "💵 *CARRY* — deux jambes ouvertes en même temps, même montant, même crypto\n" +
      "🟢 Achat au comptant (spot)\n" +
      "🔴 Vente à découvert du perpétuel\n\n" +
      "Le prix n'entre pas dans l'équation : ce que gagne une jambe, l'autre le perd. Ce que tu encaisses, " +
      "c'est le financement, ce montant versé toutes les huit heures par les acheteurs de perpétuels aux vendeurs.\n\n" +
      "📈 Financement net attendu : chiffré dans chaque signal, frais déduits\n" +
      "⏳ Clôture : *au bout de 21 jours*, les deux jambes ensemble\n" +
      "🛑 Aucun stop de prix : il n'y a rien à protéger de ce côté-là\n\n" +
      "Elle produit AUSSI quand le Bitcoin est sous sa moyenne 200 jours : elle n'est pas filtrée, parce " +
      "qu'elle ne parie sur aucune direction. Le momentum 4H tient l'autre bout de ce créneau — il ne " +
      "travaille QUE dans ce régime-là, et c'est là qu'il rend le plus : environ neuf fois le carry par " +
      "jour de capital immobilisé. Le carry reste le mieux établi des deux — historique plus long, quatre " +
      "fois plus de positions mesurées.\n\n" +
      "📊 Mesuré sur 6 ans : 84,2 % de positions gagnantes, +0,572 % net par position, six années positives " +
      "sur sept — la septième, 2022, est à -0,046 %, donc plate et non perdante.\n\n" +
      "⚠️ Ce n'est pas « sans risque », et on ne l'écrira jamais : ta jambe vendeuse peut être liquidée si ta " +
      "marge devient insuffisante, il reste un risque de plateforme, et la pire position mesurée a perdu 19,86 %.\n\n" +
      "━━━━━━━━━━\n" +
      "📬 *Le débit réel*\n" +
      `• marché favorable : ${DEBIT.favorable} signaux par jour\n` +
      `• marché défavorable : ${DEBIT.defavorable} par jour — le carry (${DEBIT_PAR_MOTEUR.carry_funding}) et le ` +
      `momentum 4H (${DEBIT_PAR_MOTEUR.momentum_4h}), qui ne travaille que dans ce régime\n` +
      `• jamais plus de ${MAX_PAR_JOUR} par jour au total — 5 directionnels au maximum, plus les carrys, ` +
      "qui ne prennent aucun risque de marché et ne concourent donc pas pour ces places\n\n" +
      `⏱️ ${CARRY_EN_SALVES}

` +
      "⚠️ *Ce qu'il faut accepter*\n" +
      "Les signaux directionnels réussissent environ une fois sur deux, et leur signal médian PERD " +
      "0,69 % — il y a donc une majorité de perdants. Tout le gain vient d'une minorité de gros gagnants. " +
      "Il faut donc les prendre TOUS : en trier quelques-uns revient statistiquement à ne garder que la " +
      "partie perdante.\n\n" +
      "Et pour quelqu'un qui commence à une date au hasard, mesuré sur 6 ans : après six mois, médiane " +
      "+5,0 %, 53 % des entrées gagnantes, pire cas -61,7 %.\n\n" +
      "⚠️ Performances passées, pas une promesse : elles ne garantissent rien pour la suite. Ce ne sont " +
      "pas des conseils en investissement, c'est toi qui décides, et il y a un risque de perte en capital.\n\n" +
      "👉 /trial pour l'essai gratuit de 3 jours, /marche pour l'état du marché en direct, /subscribe pour les offres.",
    { markdown: true }
  );
}
