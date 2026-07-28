import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getLatestSignal, SignalRecord } from "../../db/signals";
import { buildSignalMessage, SUGGESTED_RISK_PCT } from "../../signalFormat";

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
      `6. Ne risque jamais plus de ${SUGGESTED_RISK_PCT}% de ton capital total sur un seul trade — chaque signal indique la taille de position correspondante (voir "Risque conseillé" ci-dessous).\n\n` +
      `📎 Exemple concret${exampleNote} :\n\n` +
      buildSignalMessage(example) +
      "\n\n💡 Astuce : active le trailing stop dans /prefs pour recevoir un rappel dès qu'un trade progresse suffisamment pour sécuriser une partie du gain.",
    { markdown: true }
  );
}
