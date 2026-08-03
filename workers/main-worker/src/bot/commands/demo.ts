import { Env } from "../../env";
import { sendMessage } from "../../telegram";

/**
 * Montre la FORME réelle d'un signal du moteur Force Relative (voir
 * signals/relative_strength.py), activé le 03/08/2026.
 *
 * Pourquoi cette commande ne tire plus d'exemple de backtest_trades : cette
 * table est remplie par signals/backtest.py, c'est-à-dire par l'ANCIEN moteur
 * (achat sur RSI bas, objectif de prix serré, ventes à découvert), désactivé
 * le 03/08/2026 après avoir été mesuré comme la jambe PERDANTE de la
 * stratégie. Afficher un de ces trades sous le titre « voici ce que vous
 * recevrez » montrerait la mauvaise géométrie — un objectif serré et un sens
 * de position que le nouveau moteur n'émet jamais.
 *
 * Pourquoi aucun prix chiffré non plus : les niveaux d'un vrai signal se
 * déduisent de l'ATR de la paire au moment de l'émission, et ils changent donc
 * à chaque signal. Inventer une entrée et un ATR pour faire joli produirait
 * des pourcentages qui se liraient comme une promesse de gain. On montre la
 * géométrie réellement utilisée (les multiples d'ATR mesurés par
 * backtest_stop_impact) et les statistiques mesurées, rien de plus.
 */
export async function handleDemoCommand(env: Env, telegramId: number): Promise<void> {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🎭 *EXEMPLE — la forme d'un signal*\n\n" +
      "🟢 *ACHAT* sur une paire parmi les 12 plus fortes du moment\n" +
      "📈 Les 40 paires suivies sont classées par force relative, sur des bougies journalières. " +
      "On achète les 12 premières. C'est du momentum, pas un indicateur secret.\n\n" +
      "💵 Entrée : le cours à la clôture du jour\n" +
      "🛑 Stop : 4 x ATR sous l'entrée\n" +
      "🥇 Jalon 1 : 4 x ATR au-dessus de l'entrée\n" +
      "🥈 Jalon 2 : 8 x ATR\n" +
      "🥉 Jalon 3 : 12 x ATR\n" +
      "⏳ Sortie : *au bout de 7 jours*, au prix du marché\n\n" +
      "L'ATR mesure l'amplitude habituelle des variations de la paire : chaque signal a donc ses propres " +
      "niveaux, à l'échelle de sa volatilité. Les prix exacts figurent dans chaque signal envoyé.\n\n" +
      "*Deux choses à comprendre avant de t'abonner.*\n\n" +
      "1. La sortie est TEMPORELLE. Ce sont les 7 jours qui ferment la position, pas un objectif de prix. " +
      "Les jalons servent à suivre la progression. Un objectif serré a été testé : il détruit l'essentiel " +
      "du résultat, parce que les gains viennent de quelques très gros mouvements qu'il faut laisser courir.\n\n" +
      "2. Le stop est volontairement très large. Ce n'est pas un outil de gestion fine, c'est une " +
      "protection catastrophe : il ne se déclenche que dans 5 % des cas.\n\n" +
      "📊 Ce que ça a donné sur 6 ans, net de frais :\n" +
      "• 47,7 % de signaux gagnants — donc une majorité de perdants\n" +
      "• gagnant moyen +16,88 %, perdant moyen -9,24 %\n" +
      "• soit +3,22 % en moyenne par signal\n" +
      "• 8,0 signaux par semaine quand le filtre de tendance est ouvert\n" +
      "• et aucun signal quand il est fermé, ce qui arrive 41 % du temps (jusqu'à 381 jours d'affilée)\n\n" +
      "⚠️ Performances passées, pas une promesse : elles ne garantissent rien pour la suite. Ce ne sont " +
      "pas des conseils en investissement, c'est toi qui décides, et il y a un risque de perte en capital.\n\n" +
      "Pour recevoir les vrais signaux : /trial pour l'essai gratuit, /subscribe pour les offres.",
    { markdown: true }
  );
}
