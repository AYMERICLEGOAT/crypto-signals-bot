import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getLatestSignal, SignalRecord } from "../../db/signals";

const FALLBACK_EXAMPLE: Pick<SignalRecord, "type" | "pair" | "entry_price" | "stop_loss" | "take_profit"> = {
  type: "BUY",
  pair: "BTC/USDT",
  entry_price: 60000,
  stop_loss: 58800,
  take_profit: 62400,
};

/** BLOC 21 — tutoriel pas à pas pour placer un ordre en suivant un signal, exemple avec le dernier signal réel émis. */
export async function handleGuideCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const latest = await getLatestSignal(db).catch(() => null);
  const example = latest ?? FALLBACK_EXAMPLE;
  const side = example.type === "BUY" ? "ACHAT" : "VENTE";
  const exampleNote = latest ? "" : " (exemple, aucun signal réel émis pour l'instant)";

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📘 Guide : comment suivre un signal\n\n" +
      "Chaque signal donne 3 informations : le prix d'entrée, le stop loss (limite de perte) et le take profit (objectif de gain). Voici comment les utiliser sur Binance (la méthode est similaire sur la plupart des exchanges) :\n\n" +
      "1. Connecte-toi à ton compte Binance (ou un autre exchange), section Trading.\n" +
      "2. Choisis la paire exacte du signal (ex: BTC/USDT).\n" +
      `3. Passe un ordre ${side === "ACHAT" ? "d'ACHAT" : "de VENTE"} au prix d'entrée indiqué (ordre au marché si le prix est déjà proche, ou ordre limite au prix exact).\n` +
      "4. Place IMMÉDIATEMENT un ordre stop loss au niveau indiqué — c'est ce qui limite ta perte si le marché va contre toi.\n" +
      "5. Place un ordre take profit (ou surveille manuellement) au niveau indiqué pour sécuriser le gain si l'objectif est atteint.\n" +
      "6. N'investis jamais plus que ce que tu es prêt à perdre sur un seul trade.\n\n" +
      `📎 Exemple concret${exampleNote} :\n` +
      `${side} ${example.pair}\n` +
      `Entrée : ${example.entry_price}\n` +
      `Stop loss : ${example.stop_loss}\n` +
      `Take profit : ${example.take_profit}\n\n` +
      "⚠️ Ceci est un guide pédagogique, pas un conseil en investissement. Le trading de cryptomonnaies comporte un risque de perte en capital."
  );
}
