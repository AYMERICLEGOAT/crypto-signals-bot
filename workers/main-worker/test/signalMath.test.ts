import { describe, it, expect } from "vitest";
import { computePnlPct, evaluateOutcome } from "../src/signalMath";

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
