/** Calculs partagés entre /history (db/history.ts) et le suivi post-trade (cron/trackSignalOutcomes.ts). */

/**
 * Un signal de CARRY n'est ni un achat ni une vente : c'est une position neutre
 * au marché, en deux jambes simultanées (achat du spot, vente du perpétuel).
 * Il est inclus ici parce que le type circule dans tout le formatage, mais tout
 * calcul de risque/rendement basé sur un prix doit l'exclure explicitement —
 * un carry n'a ni stop ni objectif, il se ferme sur une durée.
 */
export type SignalSide = "BUY" | "SELL" | "CARRY";
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

/**
 * Mission "grille d'excellence" — gestion Multi-TP avec sécurisation
 * Break-Even (voir signals/strategy.py::_build_signal, signals/config.py::
 * ENABLE_MULTI_TP_EXITS). Un signal Multi-TP a tp1_price/tp2_price/tp3_price
 * renseignés (null pour les anciens signaux générés avant ce changement,
 * ou si ENABLE_MULTI_TP_EXITS venait à être désactivé côté Python — ces
 * signaux continuent de suivre evaluateOutcome ci-dessus, inchangé).
 *
 * close_reason garde EXACTEMENT sa sémantique d'origine ("tp_hit" pour
 * toute sortie gagnante, "sl_hit" pour une perte réelle, "expired" pour un
 * timeout sans TP1 sécurisé) : /myperformance, le récap hebdo et la page
 * transparence n'ont donc RIEN à changer pour continuer à fonctionner. Le
 * détail TP1/TP2/TP3 (win rate "perçu" vs "final") vit uniquement dans les
 * colonnes tp1_hit_at/tp2_hit_at/tp3_hit_at, consommées séparément.
 */
export interface MultiTpState {
  type: SignalSide;
  entryPrice: number;
  stopLoss: number;
  tp1Price: number | null;
  tp2Price: number | null;
  tp3Price: number | null;
  tp1HitAt: string | null;
  tp2HitAt: string | null;
  tp3HitAt: string | null;
  breakevenActive: boolean;
}

export type MultiTpEvent =
  | { kind: "tp1_hit" }
  | { kind: "tp2_hit" }
  | { kind: "closed"; outcome: "WIN" | "LOSS"; closeReason: CloseReason; exitPrice: number }
  | { kind: "none" };

export function evaluateMultiTpProgress(state: MultiTpState, currentPrice: number): MultiTpEvent {
  const isBuy = state.type === "BUY";
  const effectiveStop = state.breakevenActive ? state.entryPrice : state.stopLoss;
  const stopHit = isBuy ? currentPrice <= effectiveStop : currentPrice >= effectiveStop;
  if (stopHit) {
    // Break-even déjà actif (TP1 sécurisé) -> le trade reste gagnant même si
    // le reste de la position se referme sans progresser davantage.
    return state.breakevenActive
      ? { kind: "closed", outcome: "WIN", closeReason: "tp_hit", exitPrice: effectiveStop }
      : { kind: "closed", outcome: "LOSS", closeReason: "sl_hit", exitPrice: effectiveStop };
  }

  if (!state.tp1HitAt && state.tp1Price != null) {
    const reached = isBuy ? currentPrice >= state.tp1Price : currentPrice <= state.tp1Price;
    if (reached) return { kind: "tp1_hit" };
  } else if (state.tp1HitAt && !state.tp2HitAt && state.tp2Price != null) {
    const reached = isBuy ? currentPrice >= state.tp2Price : currentPrice <= state.tp2Price;
    if (reached) return { kind: "tp2_hit" };
  } else if (state.tp2HitAt && !state.tp3HitAt && state.tp3Price != null) {
    const reached = isBuy ? currentPrice >= state.tp3Price : currentPrice <= state.tp3Price;
    if (reached) return { kind: "closed", outcome: "WIN", closeReason: "tp_hit", exitPrice: state.tp3Price };
  }
  return { kind: "none" };
}


/** Ce dont pnlEffectif a besoin : un sous-ensemble volontairement minimal de SignalRecord. */
export interface PositionMultiTp {
  type: SignalSide;
  entry_price: number;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp1_hit_at?: string | null;
  tp2_hit_at?: string | null;
}

/**
 * Poids des sorties partielles Multi-TP, copiés de signals/config.py
 * (MULTI_TP_TP1_WEIGHT = 0.3, TP2 = 0.3, TP3 = 0.4). Ils vivent en double,
 * dans deux langages : toute modification côté Python doit être reportée ici,
 * sans quoi le chiffre publié cesse de décrire la stratégie exécutée.
 */
const POIDS_TP1 = 0.3;
const POIDS_TP2 = 0.3;

/**
 * LE RENDEMENT RÉELLEMENT OBTENU, sorties partielles comprises.
 *
 * La stratégie vend 30 % de la position à TP1, 30 % à TP2 et laisse courir le
 * reste — c'est l'argument central du format Multi-TP, écrit dans chaque
 * message de signal. Le message de clôture, lui, calculait le rendement sur le
 * SEUL prix de sortie final, comme si rien n'avait été vendu en route.
 *
 * ICP a donc été publié à « +1,7 % » le 12/08/2026. Le trade avait touché TP1
 * à 2,3356 (+6,16 %) avant de revenir à 2,238 (+1,73 %) : le rendement réel
 * était 0,3 × 6,16 + 0,7 × 1,73 = +3,06 %. Le canal publiait donc un chiffre
 * DEUX FOIS plus bas que le résultat de sa propre stratégie — et incohérent
 * avec le backtest qui, lui, mélange bien les sorties (voir
 * signals/backtest.py::_simulate_multi_tp_exit, variable pnl_pct).
 *
 * Sous-déclarer ses gains n'est pas une faute morale, c'est une faute de
 * mesure : le relevé public ne décrit plus le produit vendu.
 */
export function pnlEffectif(signal: PositionMultiTp, prixSortie: number | null): number {
  if (prixSortie === null) return 0;
  const rendement = (niveau: number) => computePnlPct(signal.type, signal.entry_price, niveau);

  let poidsSortis = 0;
  let cumul = 0;
  if (signal.tp1_hit_at && signal.tp1_price != null) {
    poidsSortis += POIDS_TP1;
    cumul += POIDS_TP1 * rendement(signal.tp1_price);
  }
  if (signal.tp2_hit_at && signal.tp2_price != null) {
    poidsSortis += POIDS_TP2;
    cumul += POIDS_TP2 * rendement(signal.tp2_price);
  }
  // Le reliquat sort au prix de clôture, quel qu'il soit.
  return cumul + (1 - poidsSortis) * rendement(prixSortie);
}
