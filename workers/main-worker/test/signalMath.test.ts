import { describe, it, expect } from "vitest";
import { computePnlPct, evaluateOutcome, computeTrailingStop, evaluateMultiTpProgress, MultiTpState } from "../src/signalMath";

// entrée 100, stop 97 (SL 1.5x ATR avec ATR=2 -> risk=3, mais on utilise des
// niveaux ronds ici) : TP1=103, TP2=106, TP3=110.
const baseState: MultiTpState = {
  type: "BUY",
  entryPrice: 100,
  stopLoss: 97,
  tp1Price: 103,
  tp2Price: 106,
  tp3Price: 110,
  tp1HitAt: null,
  tp2HitAt: null,
  tp3HitAt: null,
  breakevenActive: false,
};

describe("computePnlPct", () => {
  it("calcule le P&L pour un BUY (gain quand le prix monte)", () => {
    expect(computePnlPct("BUY", 100, 104)).toBeCloseTo(4);
    expect(computePnlPct("BUY", 100, 96)).toBeCloseTo(-4);
  });

  it("calcule le P&L pour un SELL (gain quand le prix descend)", () => {
    expect(computePnlPct("SELL", 100, 96)).toBeCloseTo(4);
    expect(computePnlPct("SELL", 100, 104)).toBeCloseTo(-4);
  });
});

describe("evaluateOutcome", () => {
  it("BUY : WIN si le prix atteint le take profit", () => {
    expect(evaluateOutcome("BUY", 95, 110, 110)).toEqual({ outcome: "WIN", closeReason: "tp_hit" });
    expect(evaluateOutcome("BUY", 95, 110, 115)).toEqual({ outcome: "WIN", closeReason: "tp_hit" });
  });

  it("BUY : LOSS si le prix touche le stop loss", () => {
    expect(evaluateOutcome("BUY", 95, 110, 95)).toEqual({ outcome: "LOSS", closeReason: "sl_hit" });
    expect(evaluateOutcome("BUY", 95, 110, 90)).toEqual({ outcome: "LOSS", closeReason: "sl_hit" });
  });

  it("BUY : null si le prix reste entre le stop loss et le take profit", () => {
    expect(evaluateOutcome("BUY", 95, 110, 103)).toBeNull();
  });

  it("SELL : WIN si le prix descend jusqu'au take profit, LOSS s'il monte jusqu'au stop loss", () => {
    expect(evaluateOutcome("SELL", 110, 95, 95)).toEqual({ outcome: "WIN", closeReason: "tp_hit" });
    expect(evaluateOutcome("SELL", 110, 95, 110)).toEqual({ outcome: "LOSS", closeReason: "sl_hit" });
    expect(evaluateOutcome("SELL", 110, 95, 103)).toBeNull();
  });
});

describe("computeTrailingStop (UX — trailing stop optionnel, /prefs)", () => {
  // entrée 100, stop 95 -> R = 5
  it("BUY : pas de trail avant +1R de progression", () => {
    expect(computeTrailingStop("BUY", 100, 95, null, 104)).toBeNull();
  });

  it("BUY : +1R -> stop remonté au point mort (entrée)", () => {
    expect(computeTrailingStop("BUY", 100, 95, null, 105)).toBe(100);
  });

  it("BUY : +2R -> stop remonté à +1R (105)", () => {
    expect(computeTrailingStop("BUY", 100, 95, null, 110)).toBe(105);
  });

  it("BUY : ne recule jamais si le niveau actuel est déjà plus favorable", () => {
    expect(computeTrailingStop("BUY", 100, 95, 105, 106)).toBeNull();
  });

  it("BUY : progresse encore si le prix avance suffisamment au-delà du niveau déjà atteint", () => {
    expect(computeTrailingStop("BUY", 100, 95, 100, 110)).toBe(105);
  });

  // entrée 100, stop 105 (SELL) -> R = 5
  it("SELL : +1R (prix à 95) -> stop baissé au point mort (entrée)", () => {
    expect(computeTrailingStop("SELL", 100, 105, null, 95)).toBe(100);
  });

  it("SELL : +2R (prix à 90) -> stop baissé à +1R (95)", () => {
    expect(computeTrailingStop("SELL", 100, 105, null, 90)).toBe(95);
  });

  it("ne modifie jamais stop_loss/take_profit — purement un calcul indépendant", () => {
    // computeTrailingStop ne prend que des nombres en entrée/sortie, aucun effet de bord possible.
    const result = computeTrailingStop("BUY", 100, 95, null, 105);
    expect(typeof result).toBe("number");
  });
});

describe("evaluateMultiTpProgress (mission grille d'excellence — TP1/TP2/TP3 + break-even)", () => {
  it("BUY : LOSS si le stop original est touché avant TP1", () => {
    expect(evaluateMultiTpProgress(baseState, 97)).toEqual({ outcome: "LOSS", closeReason: "sl_hit", exitPrice: 97, kind: "closed" });
  });

  it("BUY : rien si le prix reste entre le stop et TP1", () => {
    expect(evaluateMultiTpProgress(baseState, 100).kind).toBe("none");
  });

  it("BUY : signale tp1_hit quand TP1 est atteint (ne clôture pas)", () => {
    expect(evaluateMultiTpProgress(baseState, 103)).toEqual({ kind: "tp1_hit" });
  });

  it("BUY : après TP1, le stop au break-even (entrée) clôture en WIN", () => {
    const afterTp1: MultiTpState = { ...baseState, tp1HitAt: "2026-01-01T00:00:00Z", breakevenActive: true };
    expect(evaluateMultiTpProgress(afterTp1, 100)).toEqual({ outcome: "WIN", closeReason: "tp_hit", exitPrice: 100, kind: "closed" });
  });

  it("BUY : après TP1, signale tp2_hit quand TP2 est atteint (ne clôture pas)", () => {
    const afterTp1: MultiTpState = { ...baseState, tp1HitAt: "2026-01-01T00:00:00Z", breakevenActive: true };
    expect(evaluateMultiTpProgress(afterTp1, 106)).toEqual({ kind: "tp2_hit" });
  });

  it("BUY : après TP1+TP2, TP3 atteint clôture en WIN au prix de TP3", () => {
    const afterTp2: MultiTpState = {
      ...baseState,
      tp1HitAt: "2026-01-01T00:00:00Z",
      tp2HitAt: "2026-01-02T00:00:00Z",
      breakevenActive: true,
    };
    expect(evaluateMultiTpProgress(afterTp2, 110)).toEqual({ outcome: "WIN", closeReason: "tp_hit", exitPrice: 110, kind: "closed" });
  });

  it("SELL : symétrique (stop au-dessus, TP en-dessous)", () => {
    const sellState: MultiTpState = { ...baseState, type: "SELL", entryPrice: 100, stopLoss: 103, tp1Price: 97, tp2Price: 94, tp3Price: 90 };
    expect(evaluateMultiTpProgress(sellState, 103)).toEqual({ outcome: "LOSS", closeReason: "sl_hit", exitPrice: 103, kind: "closed" });
    expect(evaluateMultiTpProgress(sellState, 97)).toEqual({ kind: "tp1_hit" });
  });
});
