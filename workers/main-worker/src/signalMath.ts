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
/**
 * UX — trailing stop optionnel (préférence /prefs, opt-in). Règle simple en
 * multiples de R (R = distance initiale entre l'entrée et le stop loss,
 * déjà calibrée sur l'ATR à la création du signal — voir signals/strategy.py) :
 *   +1R de progression favorable -> stop remonté au point mort (entrée)
 *   +2R -> stop à +1R, +3R -> stop à +2R, etc. (ne recule jamais)
 * Purement indicatif : ne modifie jamais stop_loss/take_profit officiels
 * (voir note section 31 d'init.sql). Retourne le nouveau niveau UNIQUEMENT
 * s'il progresse par rapport au niveau actuel (currentTrailingStop, ou le
 * stop_loss d'origine si aucun trail n'a encore eu lieu) ; sinon null.
 */
export function computeTrailingStop(
  type: SignalSide,
  entryPrice: number,
  initialStopLoss: number,
  currentTrailingStop: number | null,
  currentPrice: number
): number | null {
  const risk = Math.abs(entryPrice - initialStopLoss);
  if (risk <= 0) return null;
  const baseline = currentTrailingStop ?? initialStopLoss;

  if (type === "BUY") {
    const levels = Math.floor((currentPrice - entryPrice) / risk);
    if (levels < 1) return null;
    const candidate = entryPrice + (levels - 1) * risk;
    return candidate > baseline ? candidate : null;
  } else {
    const levels = Math.floor((entryPrice - currentPrice) / risk);
    if (levels < 1) return null;
    const candidate = entryPrice - (levels - 1) * risk;
    return candidate < baseline ? candidate : null;
  }
}

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
