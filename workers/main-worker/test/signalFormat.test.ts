import { describe, it, expect } from "vitest";
import { buildSignalMessage, SUGGESTED_RISK_PCT } from "../src/signalFormat";

const buySignal = {
  type: "BUY" as const,
  pair: "XRP/USDT",
  entry_price: 100,
  stop_loss: 95,
  take_profit: 110,
  created_at: "2026-01-01T00:00:00Z",
  confidence_score: 65,
};

describe("buildSignalMessage (UX — format de signal plus clair)", () => {
  it("inclut un emoji directionnel, le contexte, et le disclaimer", () => {
    const text = buildSignalMessage(buySignal);
    expect(text).toContain("🟢");
    expect(text).toContain("ACHAT XRP/USDT");
    expect(text).toContain("Signal Haute Confiance");
    expect(text).toContain("Pas un conseil financier");
  });

  it("affiche le take profit et le stop loss avec leur pourcentage", () => {
    const text = buildSignalMessage(buySignal);
    expect(text).toContain("+10.0%"); // (110-100)/100
    expect(text).toContain("-5.0%"); // (95-100)/100
  });

  it("inclut une ligne de risque conseillé à 2% avec la taille de position calculée", () => {
    const text = buildSignalMessage(buySignal);
    expect(text).toContain(`${SUGGESTED_RISK_PCT}%`);
    expect(text).toContain("Risque conseillé");
    // stop a 5% de distance -> position conseillee = 2/5*100 = 40%
    expect(text).toContain("40%");
  });

  it("n'affiche la ligne trailing stop que si explicitement activé", () => {
    const withoutTrailing = buildSignalMessage(buySignal);
    const withTrailing = buildSignalMessage(buySignal, { trailingEnabled: true });
    expect(withoutTrailing).not.toContain("Trailing stop activé");
    expect(withTrailing).toContain("Trailing stop activé");
  });

  it("affiche le score de confiance comme purement indicatif", () => {
    const text = buildSignalMessage(buySignal);
    expect(text).toContain("Confiance : 65/100");
    expect(text).toContain("indicatif");
  });

  it("omet le score de confiance si absent", () => {
    const text = buildSignalMessage({ ...buySignal, confidence_score: undefined });
    expect(text).not.toContain("/100");
  });

  it("ajoute la note de délai et le CTA quand fournis (canal public)", () => {
    const text = buildSignalMessage(buySignal, { delayNote: "signal différé de 30 min", ctaUsername: "ProVIPSignals_bot" });
    expect(text).toContain("signal différé de 30 min");
    expect(text).toContain("rejoins @ProVIPSignals\\_bot");
  });

  it("gère correctement un signal SELL (contexte baissier, signes inversés)", () => {
    const sellSignal = { ...buySignal, type: "SELL" as const, entry_price: 100, stop_loss: 105, take_profit: 90 };
    const text = buildSignalMessage(sellSignal);
    expect(text).toContain("🔴");
    expect(text).toContain("VENTE XRP/USDT");
    expect(text).toContain("baissière");
    expect(text).toContain("+10.0%"); // (100-90)/100 pour le take profit
    expect(text).toContain("-5.0%"); // (100-105)/100 pour le stop loss
  });
});
