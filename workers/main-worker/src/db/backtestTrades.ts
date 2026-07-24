import { SupabaseConfig, selectRows } from "../supabaseRest";

export interface BacktestTrade {
  id: number;
  pair: string;
  side: "BUY" | "SELL";
  entry_price: number;
  exit_price: number;
  outcome: "WIN" | "LOSS" | "TIMEOUT";
  pnl_pct: number;
  entered_at: string;
  exited_at: string;
}

/** Un exemple de trade issu du backtest (le plus récent), pour /demo. */
export async function getSampleBacktestTrade(db: SupabaseConfig): Promise<BacktestTrade | null> {
  const rows = await selectRows<BacktestTrade>(db, "backtest_trades", {
    order: "entered_at.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}
