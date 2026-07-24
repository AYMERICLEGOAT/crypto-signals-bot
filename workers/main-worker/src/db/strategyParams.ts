import { SupabaseConfig, selectRows } from "../supabaseRest";

export interface StrategyParamsRow {
  win_rate: number;
  trade_count: number;
}

/** La ligne is_active=true la plus récente de strategy_params (backtest.py), ou null si aucune. */
export async function getActiveStrategyParams(db: SupabaseConfig): Promise<StrategyParamsRow | null> {
  const rows = await selectRows<StrategyParamsRow>(db, "strategy_params", {
    is_active: "eq.true",
    order: "last_tested.desc",
    limit: "1",
  });
  return rows[0] ?? null;
}
