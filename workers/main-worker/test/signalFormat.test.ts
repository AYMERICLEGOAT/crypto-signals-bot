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

  it("affiche le badge du moteur d'origine (🎯 par défaut, ⚡ pour le moteur Squeeze 15M)", () => {
    const defaultText = buildSignalMessage(buySignal);
    expect(defaultText).toContain("🎯 Haute Confiance");

    const squeezeText = buildSignalMessage({ ...buySignal, engine: "squeeze_15m" });
    expect(squeezeText).toContain("⚡ Squeeze 15M");
    expect(squeezeText).toContain("Signal Squeeze 15M");
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

describe("buildSignalMessage — Multi-TP (mission grille d'excellence)", () => {
  const multiTpSignal = {
    ...buySignal,
    stop_loss: 97,
    tp1_price: 103,
    tp2_price: 106.3,
    tp3_price: 110,
  };

  it("affiche les 3 niveaux TP avec leurs labels et ratios (calculés dynamiquement) quand tp1_price est présent", () => {
    const text = buildSignalMessage(multiTpSignal);
    expect(text).toContain("🥇 TP1");
    expect(text).toContain("Sécurisation rapide");
    expect(text).toContain("Break-Even");
    expect(text).toContain("🥈 TP2");
    // stop à 3 de distance (100-97), TP2 à 6.3 de distance -> ratio 1:2.1
    expect(text).toContain("ratio 1:2.1");
    expect(text).toContain("Objectif principal");
    expect(text).toContain("🥉 TP3");
    // TP3 à 10 de distance -> ratio 1:3.3
    expect(text).toContain("ratio 1:3.3");
    expect(text).toContain("Runner");
  });

  it("calcule le ratio dynamiquement (pas de multiplicateur ATR codé en dur) -- valable pour n'importe quel moteur", () => {
    // Moteur Squeeze 15M (multiplicateurs différents de Haute Confiance, voir signals/config.py) :
    // stop à 1.5 de distance, TP1 à 1.0 -> ratio 1:0.7
    const squeezeSignal = { ...buySignal, engine: "squeeze_15m", stop_loss: 98.5, tp1_price: 101, tp2_price: 102, tp3_price: 103 };
    const text = buildSignalMessage(squeezeSignal);
    expect(text).toContain("ratio 1:0.7");
    expect(text).not.toContain("ATR");
  });

  it("revient à l'ancien format simple (take profit / stop loss uniques) si tp1_price est absent", () => {
    const text = buildSignalMessage(buySignal);
    expect(text).not.toContain("TP1");
    expect(text).toContain("🎯 Take profit");
  });
});
