/** Calculs partagés entre /history (db/history.ts) et le suivi post-trade (cron/trackSignalOutcomes.ts). */

export type SignalSide = "BUY" | "SELL";
export type CloseReason = "tp_hit" | "sl_hit" | "expired";

export function computePnlPct(type: SignalSide, entryPrice: number, exitPrice: number): number {
  return type === "BUY" ? ((exitPrice - entryPrice) / entryPrice) * 100 : ((entryPrice - exitPrice) / entryPrice) * 100;
}

/**
 * Même logique que website/outcome_evaluator.py::_evaluate_against_price,
 * dupliquée ici volontairement : les deux évaluateurs tournent sur des
 * cadences différentes (Worker toutes les 5 min, site quotidien) et doivent
 * arriver à la même conclusion indépendamment, pas partager un import
 * cross-langage impossible.
 */
export function evaluateOutcome(
  type: SignalSide,
  stopLoss: number,
  takeProfit: number,
  currentPrice: number
): { outcome: "WIN" | "LOSS"; closeReason: "tp_hit" | "sl_hit" } | null {
  if (type === "BUY") {
    if (currentPrice >= takeProfit) return { outcome: "WIN", closeReason: "tp_hit" };
    if (currentPrice <= stopLoss) return { outcome: "LOSS", closeReason: "sl_hit" };
  } else {
    if (currentPrice <= takeProfit) return { outcome: "WIN", closeReason: "tp_hit" };
    if (currentPrice >= stopLoss) return { outcome: "LOSS", closeReason: "sl_hit" };
  }
  return null;
}
