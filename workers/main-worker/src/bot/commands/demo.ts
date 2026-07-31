import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getSampleBacktestTrade } from "../../db/backtestTrades";
import { getActiveStrategyParams } from "../../db/strategyParams";
import { buildSignalMessage } from "../../signalFormat";

interface StrategyParamsFull {
  win_rate: number;
  trade_count: number;
  tp_pct?: number;
  sl_pct?: number;
}

const FALLBACK_TP_PCT = 0.04;
const FALLBACK_SL_PCT = 0.02;

/**
 * Montre un exemple de signal, formaté EXACTEMENT comme un vrai (voir
 * cron/dispatchSignals.ts, formatSignalMessage), à partir d'un vrai trade
 * du backtest — jamais inventé, mais toujours clairement marqué "exemple".
 */
export async function handleDemoCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const trade = await getSampleBacktestTrade(db);

  if (!trade) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Aucun exemple disponible pour le moment (le backtest n'a pas encore tourné). Réessaie plus tard, ou utilise /trial pour un vrai essai gratuit."
    );
    return;
  }

  const params = (await getActiveStrategyParams(db)) as StrategyParamsFull | null;
  const tpPct = params?.tp_pct ?? FALLBACK_TP_PCT;
  const slPct = params?.sl_pct ?? FALLBACK_SL_PCT;

  const entry = Number(trade.entry_price);
  const stopLoss = trade.side === "BUY" ? entry * (1 - slPct) : entry * (1 + slPct);
  const takeProfit = trade.side === "BUY" ? entry * (1 + tpPct) : entry * (1 - tpPct);
  const tp1 = trade.side === "BUY" ? entry * (1 + tpPct * 0.5) : entry * (1 - tpPct * 0.5);
  const tp3 = trade.side === "BUY" ? entry * (1 + tpPct * 1.5) : entry * (1 - tpPct * 1.5);

  const outcomeNote =
    trade.outcome === "WIN"
      ? "Dans le backtest, ce trade a atteint son take profit."
      : trade.outcome === "LOSS"
        ? "Dans le backtest, ce trade a touché son stop loss (la gestion du risque limite la perte à un niveau connu à l'avance)."
        : "Dans le backtest, ce trade a été clôturé au marché après expiration du délai.";

  const exampleMessage = buildSignalMessage({
    type: trade.side,
    pair: trade.pair,
    entry_price: entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    tp1_price: tp1,
    tp2_price: takeProfit,
    tp3_price: tp3,
    created_at: trade.entered_at,
  });

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🎭 *EXEMPLE — voici ce que vous recevrez*\n\n" +
      `${exampleMessage}\n\n` +
      `📎 ${outcomeNote}\n\n` +
      "Ceci est un exemple basé sur un trade réel du backtest (performance passée ne garantit pas les " +
      "performances futures). Utilise /trial pour recevoir de vrais signaux en direct.",
    { markdown: true }
  );
}
