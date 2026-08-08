import { describe, it, expect } from "vitest";

// Les pourcentages sont formatés à la française depuis le 04/08/2026 : virgule
// décimale et espace insécable. Un même message affichait auparavant "+10.0%"
// et "84,2 %" à deux lignes d'écart.
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
    // Ce signal de test ne porte AUCUN moteur. Le contexte annonçait alors
    // « Signal Haute Confiance : EMA + RSI + ADX alignés » — la stratégie
    // mesurée perdante et désactivée le 03/08/2026. Un signal dont on ignore
    // le moteur ne doit plus être expliqué par celle-là, ni par aucune autre.
    expect(text).not.toMatch(/EMA \+ RSI \+ ADX/i);
    expect(text).toMatch(/Position (haussière|baissière)/i);
    expect(text).toContain("Pas un conseil financier");
  });

  it("affiche le take profit et le stop loss avec leur pourcentage", () => {
    const text = buildSignalMessage(buySignal);
    expect(text).toContain("+10,0 %"); // (110-100)/100
    expect(text).toContain("-5,0 %"); // (95-100)/100
  });

  it("inclut une ligne de risque conseillé à 2% avec la taille de position calculée", () => {
    const text = buildSignalMessage(buySignal);
    expect(text).toContain(`${SUGGESTED_RISK_PCT} %`);
    expect(text).toContain("Risque conseillé");
    // Format français dans toute la ligne : elle écrivait "10.0%" à deux lignes
    // d'un "-10,0 %".
    expect(text).not.toMatch(/\d\.\d\s?%/);
    // stop a 5 % de distance -> position conseillee = 2/5*100 = 40 %
    expect(text).toContain("40 %");
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

  it("affiche le badge du moteur d'origine, et un badge NEUTRE quand il n'y en a pas", () => {
    // Le badge par défaut était « 🎯 Haute Confiance ». Ce n'est pas un repli
    // mais une affirmation de qualité, apposée précisément sur le signal dont
    // on ne sait rien — et « high_confidence » désigne en base l'ancien moteur
    // EMA/RSI, mesuré perdant et désactivé.
    const defaultText = buildSignalMessage(buySignal);
    expect(defaultText).not.toContain("Haute Confiance");
    expect(defaultText).toContain("📊 Signal");

    const squeezeText = buildSignalMessage({ ...buySignal, engine: "squeeze_15m" });
    expect(squeezeText).toContain("⚡ Squeeze 15M");
    expect(squeezeText).toContain("Signal Squeeze 15M");
  });

  it("étiquette les anciens signaux high_confidence comme provenant d'un moteur retiré", () => {
    // Dix signaux portent cette valeur en base (26/07 – 03/08). /history peut
    // les réafficher : republier « Haute Confiance » à leur sujet reviendrait
    // à réaffirmer aujourd'hui la qualité du moteur que ce projet a désavoué.
    const text = buildSignalMessage({ ...buySignal, engine: "high_confidence" });
    expect(text).toContain("Moteur retiré");
    expect(text).not.toContain("Haute Confiance");
  });

  it("gère correctement un signal SELL (contexte baissier, signes inversés)", () => {
    const sellSignal = { ...buySignal, type: "SELL" as const, entry_price: 100, stop_loss: 105, take_profit: 90 };
    const text = buildSignalMessage(sellSignal);
    expect(text).toContain("🔴");
    expect(text).toContain("VENTE XRP/USDT");
    expect(text).toContain("baissière");
    expect(text).toContain("+10,0 %"); // (100-90)/100 pour le take profit
    expect(text).toContain("-5,0 %"); // (100-105)/100 pour le stop loss
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

describe("buildSignalMessage — la sortie temporelle est ANNONCÉE", () => {
  // Deux des trois moteurs ferment à l'échéance quoi qu'il arrive : les
  // objectifs ne déclenchent que 2 % des sorties. Un message qui n'affiche
  // qu'un stop et trois objectifs laisse l'abonné jouer une autre stratégie
  // que celle qui a été mesurée.
  const rsSignal = {
    ...buySignal,
    engine: "relative_strength",
    created_at: "2026-01-01T00:00:00Z",
    hold_until: "2026-01-08T00:00:00Z",
  };

  it("affiche la durée de détention prévue quand le signal en porte une", () => {
    const text = buildSignalMessage(rsSignal);
    expect(text).toContain("Durée prévue : 7 jours");
    expect(text).toContain("se ferme à l'échéance");
  });

  it("n'affiche aucune durée pour un signal qui n'en porte pas", () => {
    expect(buildSignalMessage(buySignal)).not.toContain("Durée prévue");
  });

  it("décrit la force relative pour ce qu'elle est, et non comme l'ancien moteur EMA/RSI", () => {
    const text = buildSignalMessage(rsSignal);
    expect(text).toContain("Force Relative");
    expect(text).toContain("plus fortes du marché");
    expect(text).not.toContain("EMA + RSI + ADX");
  });
});

describe("buildSignalMessage — le moteur en observation le dit", () => {
  const signal4h = {
    ...buySignal,
    engine: "momentum_4h",
    created_at: "2026-01-01T00:00:00Z",
    hold_until: "2026-01-04T00:00:00Z",
  };

  it("marque le momentum 4H comme en observation, dans le badge ET dans le corps", () => {
    const text = buildSignalMessage(signal4h);
    expect(text).toContain("Momentum 4H (en observation)");
    expect(text).toContain("Moteur en observation");
    // L'honnêteté porte sur le fait gênant, pas seulement sur l'étiquette.
    expect(text).toContain("en recul sur la dernière");
    expect(text).toContain("dimensionner plus petit");
  });

  it("annonce ses 3 jours de détention, la durée sur laquelle il a été mesuré", () => {
    expect(buildSignalMessage(signal4h)).toContain("Durée prévue : 3 jours");
  });

  it("ne colle l'avertissement d'observation à aucun autre moteur", () => {
    for (const engine of ["relative_strength", "squeeze_15m", "high_confidence"]) {
      expect(buildSignalMessage({ ...buySignal, engine })).not.toContain("Moteur en observation");
    }
  });
});
