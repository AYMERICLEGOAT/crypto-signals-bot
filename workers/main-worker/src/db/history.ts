import { SupabaseConfig, selectRows } from "../supabaseRest";

export interface SignalDeliveryWithSignal {
  delivered_at: string;
  tier: "pro" | "standard";
  signals: {
    pair: string;
    type: "BUY" | "SELL";
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    outcome: "WIN" | "LOSS" | null;
    outcome_price: number | null;
    close_reason: "tp_hit" | "sl_hit" | "expired" | null;
    tp1_hit_at: string | null;
    /** Moteur d'origine. Cinq cohabitent : sans lui, /history ne peut pas relier un résultat à ce qui l'a produit. */
    engine: string | null;
  } | null;
}

/**
 * Les `limit` derniers signaux effectivement reçus par cet utilisateur (via
 * signal_deliveries, voir Bloc 2 — Effet Sniper), avec le détail du signal
 * embarqué via la relation de clé étrangère (PostgREST "embedding").
 */
export async function getUserSignalHistory(
  db: SupabaseConfig,
  telegramId: number,
  limit = 5
): Promise<SignalDeliveryWithSignal[]> {
  return selectRows<SignalDeliveryWithSignal>(db, "signal_deliveries", {
    telegram_id: `eq.${telegramId}`,
    select: "delivered_at,tier,signals(pair,type,entry_price,stop_loss,take_profit,outcome,outcome_price,close_reason,tp1_hit_at,engine)",
    order: "delivered_at.desc",
    limit: String(limit),
  });
}
