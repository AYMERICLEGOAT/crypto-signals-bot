import { Env, dbConfig } from "../../env";
import { sendMessage, InlineKeyboard } from "../../telegram";
import { getLatestSignal, SignalRecord } from "../../db/signals";
import { buildSignalMessage, SUGGESTED_RISK_PCT } from "../../signalFormat";

/**
 * /guide — comment suivre un signal.
 *
 * RÉÉCRIT LE 08/08/2026, et c'est une correction, pas une amélioration de
 * confort. L'ancienne version donnait six étapes dont celle-ci :
 *
 *   « 5. Place un ordre take profit (ou surveille manuellement) au niveau
 *     indiqué pour sécuriser le gain si l'objectif est atteint. »
 *
 * C'est exactement ce que la stratégie ne supporte pas. La sortie de ce
 * moteur est TEMPORELLE : c'est la date qui ferme la position — 7 jours pour
 * la force relative, la cassure et l'expansion, 3 pour le momentum 4 h, 21
 * pour le carry. Le signal médian PERD 0,69 % et toute la rentabilité vient
 * d'une minorité de gros gagnants : quelqu'un qui coupe au premier jalon
 * conserve intégralement les perdants et se prive des seules positions qui
 * paient. Le produit répète ce point partout — /help, /demo, /subscribe, le
 * site — et /guide disait le contraire, dans le seul texte qui explique quels
 * ordres passer.
 *
 * Les jalons ne sont donc PAS des objectifs de sortie. Ce sont des repères de
 * progression, et les messages de suivi les annoncent comme tels.
 *
 * Deuxième absence : le carry n'apparaissait nulle part, alors qu'il s'exécute
 * différemment de tout le reste (deux jambes ouvertes en même temps, aucun
 * stop de prix). Un abonné qui recevait son premier carry avec ce guide en
 * tête cherchait un stop loss qui n'existe pas.
 *
 * Trois étapes au lieu de six : passer l'ordre, poser le stop, ne rien faire
 * jusqu'à la date. La troisième est celle qui demande le plus de discipline et
 * elle occupait auparavant une demi-ligne.
 */

const FALLBACK_EXAMPLE: Pick<
  SignalRecord,
  "type" | "pair" | "entry_price" | "stop_loss" | "take_profit" | "created_at" | "tp1_price" | "tp2_price" | "tp3_price"
> = {
  type: "BUY",
  pair: "BTC/USDT",
  entry_price: 60000,
  stop_loss: 58800,
  take_profit: 62640,
  tp1_price: 60800,
  tp2_price: 62640,
  tp3_price: 64000,
  created_at: new Date().toISOString(),
};

export async function handleGuideCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const latest = await getLatestSignal(db).catch(() => null);
  const example = latest ?? FALLBACK_EXAMPLE;
  const exampleNote = latest ? "" : " (exemple, aucun signal réel émis pour l'instant)";

  const keyboard: InlineKeyboard = [
    [{ text: "📈 Voir les deux formes de signal", callback_data: "start:demo" }],
  ];

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📘 *Suivre un signal — 3 étapes*\n\n" +
      "*1. Passe l'ordre*\n" +
      "Sur ton exchange, choisis la paire exacte du signal. Ordre au marché si le prix est proche de " +
      "l'entrée indiquée, ordre limite sinon.\n\n" +
      "*2. Pose le stop, tout de suite*\n" +
      "Au niveau indiqué dans le signal, et jamais plus loin. Il est volontairement large — c'est une " +
      "protection contre l'accident, pas un outil de gestion fine.\n\n" +
      "*3. Ne touche plus à rien jusqu'à la date de sortie*\n" +
      "C'est l'étape difficile, et c'est celle qui décide du résultat. La position se ferme sur une " +
      "DATE, pas sur un objectif de prix : 7 jours pour la force relative, la cassure de canal et " +
      "l'expansion de volatilité, 3 jours pour le momentum 4 h. Chaque signal porte la sienne.\n\n" +
      "⚠️ *Les jalons ne sont pas des sorties*\n" +
      "Les niveaux 🥇 🥈 🥉 servent à suivre la progression, rien de plus. Vendre au premier revient à " +
      "garder tous les perdants et à couper les seuls gagnants qui paient : le signal médian PERD " +
      "0,69 %, et toute la rentabilité vient d'une minorité de très gros gagnants. C'est la façon la " +
      "plus rapide de rendre cette stratégie perdante.\n\n" +
      "💰 *La taille de position*\n" +
      `Ne risque jamais plus de ${SUGGESTED_RISK_PCT} % de ton capital total sur un seul trade. Chaque ` +
      "signal indique la taille correspondante.\n\n" +
      "━━━━━━━━━━\n" +
      "🔁 *Le carry, c'est différent*\n" +
      "Un carry de financement n'a NI stop loss NI take profit, et ce n'est pas un oubli : tu ouvres " +
      "deux jambes en même temps et pour le même montant — achat au comptant, vente à découvert du " +
      "perpétuel. Elles s'annulent, donc le prix n'entre pas dans l'équation. Tu clôtures les deux " +
      "ensemble à la date indiquée, 21 jours plus tard.\n\n" +
      `📎 *Exemple concret*${exampleNote}\n\n` +
      buildSignalMessage(example) +
      "\n\n💡 /prefs active un rappel quand une position progresse assez pour remonter ton stop. " +
      "Purement indicatif : ça ne change jamais le stop officiel du signal, ni la date de sortie.",
    { markdown: true, keyboard }
  );
}
