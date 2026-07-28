import { describe, it, expect } from "vitest";
import { computePnlPct, evaluateOutcome, computeTrailingStop } from "../src/signalMath";

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
